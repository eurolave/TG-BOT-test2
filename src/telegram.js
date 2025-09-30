import TelegramBot from 'node-telegram-bot-api';
import { getByVin } from './laximoClient.js';
import { formatVinCardHtml } from './formatters.js';
import { chunk, maskVin, escapeHtml } from './utils.js';
import { chat as gptChat, reset as gptReset } from './gpt.js';

const VIN_RE = /\b([A-HJ-NPR-Z0-9]{8,})\b/i;

export default class Bot {
  constructor(token) {
    this.bot = new TelegramBot(token, { polling: false });

    // Команды
    this.bot.onText(/^\/start\b/i, (m) => this.onStart(m));
    this.bot.onText(/^\/help\b/i,  (m) => this.onHelp(m));
    this.bot.onText(/^\/vin(?:@[\w_]+)?\s+([A-HJ-NPR-Z0-9]{8,})(?:\s+(\S+))?/i,
      (m, mm) => this.handleVin(m, mm[1], mm[2] || process.env.DEFAULT_LOCALE || 'ru_RU'));
    this.bot.onText(/^\/gpt(?:@[\w_]+)?\s*(.*)$/is, (m, mm) => this.handleGpt(m, mm[1]));
    this.bot.onText(/^\/reset\b/i, (m) => this.onReset(m));

    // Свободные сообщения — VIN или GPT-чат
    this.bot.on('message', (m) => this.onMessage(m));

    // Callback от inline-кнопок
    this.bot.on('callback_query', (q) => this.onCallback(q));

    this.bot.on('polling_error', (e) => console.error('[polling_error]', e));
    this.bot.on('webhook_error',  (e) => console.error('[webhook_error]', e));
  }

  async setMenuCommands() {
    await this.bot.setMyCommands([
      { command: 'vin',   description: 'Подбор по VIN' },
      { command: 'gpt',   description: 'GPT-чат: спросить ИИ' },
      { command: 'reset', description: 'Сбросить контекст GPT' },
      { command: 'help',  description: 'Как пользоваться' }
    ]);
  }

  async startPolling() {
    this.bot.options.polling = { interval: 800, params: { timeout: 30 } };
    await this.bot.startPolling();
  }
  async setWebhook(url) { await this.bot.setWebHook(url); }
  processUpdate(update) { this.bot.processUpdate(update); }

  async onStart(msg) {
    const text = [
      'Привет! Я умею:',
      '• <b>Подбор по VIN</b> — команда: <code>/vin WAUZZZ... [locale]</code>',
      '• <b>GPT-чат</b> — команда: <code>/gpt &lt;вопрос&gt;</code> или просто напишите сообщение',
      '• Сброс контекста GPT: <code>/reset</code>',
      '',
      'Подсказка: просто пришлите VIN — я сам пойму.'
    ].join('\n');
    await this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  }
  async onHelp(msg) { return this.onStart(msg); }

  async onReset(msg) {
    gptReset(msg.chat.id);
    await this.bot.sendMessage(msg.chat.id, 'Контекст GPT очищен.');
  }

  async onMessage(msg) {
    const text = (msg.text || '').trim();
    if (!text || text.startsWith('/')) return;

    const vinMatch = text.match(VIN_RE);
    if (vinMatch) return this.handleVin(msg, vinMatch[1], process.env.DEFAULT_LOCALE || 'ru_RU');

    return this.handleGpt(msg, text);
  }

  // ───────────────────────── VIN ─────────────────────────
  async handleVin(msg, vin, locale = 'ru_RU') {
    const chatId = msg.chat.id;
    const typing = this.bot.sendChatAction(chatId, 'typing').catch(() => {});
    try {
      const json = await getByVin(vin, locale);

      const header = `Запрос по VIN <b>${escapeHtml(maskVin(vin))}</b> — locale: <b>${escapeHtml(locale)}</b>`;
      const { html, tech } = formatVinCardHtml(json);

      // кнопки (пока показывают подсказку, чтобы подключить эндпоинты позже)
      const keyboard = {
        inline_keyboard: [[
          { text: '🔩 Узлы', callback_data: `units|${vin}|${locale}|${tech.catalog}|${encodeURIComponent(tech.ssd || '')}` },
          { text: '🧩 Детали', callback_data: `details|${vin}|${locale}|${tech.catalog}|${encodeURIComponent(tech.ssd || '')}` },
          { text: '🔁 Обновить', callback_data: `refresh|${vin}|${locale}` }
        ]]
      };

      await this.bot.sendMessage(chatId, header, { parse_mode: 'HTML', disable_web_page_preview: true });
      for (const part of chunk(html, 3500)) {
        await this.bot.sendMessage(chatId, part, { parse_mode: 'HTML', reply_markup: keyboard, disable_web_page_preview: true });
      }

      // ⚠️ Убрано: отправка полного JSON файлом

    } catch (e) {
      await this.bot.sendMessage(chatId, `Не удалось получить данные по VIN: ${escapeHtml(e.message || String(e))}`, { parse_mode: 'HTML' });
    } finally {
      await typing;
    }
  }

  // ──────────────────────── CALLBACKS ────────────────────────
  async onCallback(q) {
    try {
      const chatId = q.message.chat.id;
      const data = String(q.data || '');
      const [action, vin, locale, catalog, ssdEnc] = data.split('|');
      const ssd = ssdEnc ? decodeURIComponent(ssdEnc) : '';

      if (action === 'refresh') {
        await this.handleVin(q.message, vin, locale);
        return this.safeAnswerCallback(q.id);
      }

      if (action === 'units' || action === 'details') {
        // Подсказка до подключения эндпоинтов
        const txt = action === 'units'
          ? 'Функция «Узлы» станет активной после подключения REST-эндпоинта /units в вашем Laximo-Connect.'
          : 'Функция «Детали» станет активной после подключения REST-эндпоинта /details в вашем Laximo-Connect.';
        const tech = [
          catalog ? `catalog: <code>${escapeHtml(catalog)}</code>` : null,
          ssd ? `ssd: <code>${escapeHtml(ssd.slice(0, 12))}…</code>` : null
        ].filter(Boolean).join(' • ');
        await this.bot.sendMessage(chatId, [txt, tech ? `\n${tech}` : ''].join('\n'), { parse_mode: 'HTML' });
        return this.safeAnswerCallback(q.id);
      }

      // дефолт
      await this.safeAnswerCallback(q.id);
    } catch (e) {
      console.error('[callback_error]', e);
      try { await this.safeAnswerCallback(q.id); } catch {}
    }
  }

  safeAnswerCallback(id) {
    return this.bot.answerCallbackQuery(id).catch(() => {});
  }

  // ───────────────────────── GPT ─────────────────────────
  async handleGpt(msg, promptText) {
    const chatId = msg.chat.id;
    const typing = this.bot.sendChatAction(chatId, 'typing').catch(() => {});
    try {
      const answer = await gptChat(chatId, promptText || 'Привет!');
      for (const part of chunk(answer)) {
        await this.bot.sendMessage(chatId, part, { parse_mode: 'HTML', disable_web_page_preview: true });
      }
    } catch (e) {
      await this.bot.sendMessage(chatId, `GPT ошибка: ${escapeHtml(e.message || String(e))}`, { parse_mode: 'HTML' });
    } finally {
      await typing;
    }
  }
}
