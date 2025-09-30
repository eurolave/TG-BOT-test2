// src/telegram.js
import TelegramBot from 'node-telegram-bot-api';
import { getByVin } from './laximoClient.js';
import { formatVinCardHtml } from './formatters.js';
import { chunk, maskVin, escapeHtml } from './utils.js';
import { chat as gptChat, reset as gptReset } from './gpt.js';

const VIN_RE = /\b([A-HJ-NPR-Z0-9]{8,})\b/i;

/** Постоянные «кнопки меню» под полем ввода (ReplyKeyboard) */
function homeKeyboard() {
  return {
    keyboard: [
      [{ text: '🔎 Подбор по VIN' }, { text: '🤖 GPT-чат' }],
      [{ text: '♻️ Сброс GPT контекста' }]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

/**
 * ───────────────────── Compact Callback Store ─────────────────────
 * Не кладём длинные данные в callback_data (лимит 64B).
 * Храним payload в памяти и передаём только короткий токен.
 */
const cbStore = new Map(); // token -> { action, data, ts }
const CB_TTL_MS = 10 * 60 * 1000; // 10 минут живёт токен
const CB_MAX = 5000; // ограничим рост памяти

function gcCbStore() {
  const now = Date.now();
  for (const [k, v] of cbStore) {
    if (now - v.ts > CB_TTL_MS) cbStore.delete(k);
  }
  if (cbStore.size > CB_MAX) {
    // удалить самые старые
    const arr = [...cbStore.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const toDel = arr.slice(0, cbStore.size - CB_MAX);
    for (const [k] of toDel) cbStore.delete(k);
  }
}

function makeToken() {
  // 12-символьный base36 токен
  return Math.random().toString(36).slice(2, 14);
}

/** Сохраняем payload и возвращаем короткий callback_data */
function packCb(action, data) {
  gcCbStore();
  const token = makeToken();
  cbStore.set(token, { action, data, ts: Date.now() });
  // Формат: "x:<token>" — коротко и стабильно < 64B
  return `x:${token}`;
}

function unpackCb(cbData) {
  if (!cbData || typeof cbData !== 'string') return null;
  const m = cbData.match(/^x:([a-z0-9]+)$/i);
  if (!m) return null;
  const token = m[1];
  const rec = cbStore.get(token);
  if (!rec) return null;
  return rec; // { action, data, ts }
}

/** Inline-клавиатура для карточки VIN (через токены) */
function vinInlineKeyboard(payload) {
  // payload: { vin, locale, catalog, ssd }
  const btnUnits   = packCb('units',   payload);
  const btnDetails = packCb('details', payload);
  const btnRefresh = packCb('refresh', { vin: payload.vin, locale: payload.locale });

  return {
    inline_keyboard: [[
      { text: '🔩 Узлы',     callback_data: btnUnits },
      { text: '🧩 Детали',   callback_data: btnDetails },
      { text: '🔁 Обновить', callback_data: btnRefresh }
    ]]
  };
}

export default class Bot {
  constructor(token) {
    this.bot = new TelegramBot(token, { polling: false });

    // Команды
    this.bot.onText(/^\/start\b/i, (m) => this.onStart(m));
    this.bot.onText(/^\/help\b/i,  (m) => this.onHelp(m));
    this.bot.onText(/^\/menu\b/i,  (m) => this.onMenu(m));
    this.bot.onText(
      /^\/vin(?:@[\w_]+)?\s+([A-HJ-NPR-Z0-9]{8,})(?:\s+(\S+))?/i,
      (m, mm) => this.handleVin(m, mm[1], mm[2] || process.env.DEFAULT_LOCALE || 'ru_RU')
    );
    this.bot.onText(/^\/gpt(?:@[\w_]+)?\s*(.*)$/is, (m, mm) => this.handleGpt(m, mm[1]));
    this.bot.onText(/^\/reset\b/i, (m) => this.onReset(m));

    // Свободные сообщения — сначала проверим кнопки/вин, иначе GPT
    this.bot.on('message', (m) => this.onMessage(m));

    // Обработчик inline-кнопок
    this.bot.on('callback_query', (q) => this.onCallback(q));

    this.bot.on('polling_error', (e) => console.error('[polling_error]', e));
    this.bot.on('webhook_error',  (e) => console.error('[webhook_error]', e));
  }

  async setMenuCommands() {
    await this.bot.setMyCommands(
      [
        { command: 'vin',   description: 'Подбор по VIN' },
        { command: 'gpt',   description: 'GPT-чат: спросить ИИ' },
        { command: 'reset', description: 'Сбросить контекст GPT' },
        { command: 'help',  description: 'Как пользоваться' },
        { command: 'menu',  description: 'Показать кнопки меню' }
      ],
      { scope: { type: 'default' }, language_code: '' }
    );
  }

  async startPolling() {
    this.bot.options.polling = { interval: 800, params: { timeout: 30 } };
    await this.bot.startPolling();
  }
  async setWebhook(url) { await this.bot.setWebHook(url); }
  processUpdate(update) { this.bot.processUpdate(update); }

  // ───────────────────────── UI ─────────────────────────
  async onStart(msg) {
    const text = [
      'Привет! Я умею:',
      '• <b>Подбор по VIN</b> — <code>/vin WAUZZZ... [locale]</code> или кнопка ниже',
      '• <b>GPT-чат</b> — <code>/gpt &lt;вопрос&gt;</code> или кнопка ниже',
      '• Сброс контекста GPT: <code>/reset</code>',
      '',
      'Подсказка: просто пришлите VIN — я сам пойму.'
    ].join('\n');
    await this.bot.sendMessage(msg.chat.id, text, {
      parse_mode: 'HTML',
      reply_markup: homeKeyboard()
    });
  }
  async onHelp(msg) { return this.onStart(msg); }
  async onMenu(msg) {
    await this.bot.sendMessage(msg.chat.id, 'Меню показано ✅', { reply_markup: homeKeyboard() });
  }

  // ───────────────────── Сообщения ─────────────────────
  async onMessage(msg) {
    const text = (msg.text || '').trim();
    if (!text) return;

    // Нажатия на большие кнопки ReplyKeyboard
    if (text === '🔎 Подбор по VIN') {
      return this.bot.sendMessage(
        msg.chat.id,
        'Пришлите VIN или используйте команду:\n<code>/vin WAUZZZ... [locale]</code>',
        { parse_mode: 'HTML' }
      );
    }
    if (text === '🤖 GPT-чат') {
      return this.bot.sendMessage(
        msg.chat.id,
        'Спросите что-нибудь: <code>/gpt Чем GPT-5 отличается?</code>',
        { parse_mode: 'HTML' }
      );
    }
    if (text === '♻️ Сброс GPT контекста') {
      return this.onReset(msg);
    }

    // Прямо отправили VIN?
    const vinMatch = text.match(VIN_RE);
    if (vinMatch && !text.startsWith('/')) {
      return this.handleVin(msg, vinMatch[1], process.env.DEFAULT_LOCALE || 'ru_RU');
    }

    // Иначе — GPT-чат
    if (!text.startsWith('/')) {
      return this.handleGpt(msg, text);
    }
    // Команды обрабатываются onText
  }

  // ───────────────────────── VIN ─────────────────────────
  async handleVin(msg, vin, locale = 'ru_RU') {
    const chatId = msg.chat.id;
    const typing = this.bot.sendChatAction(chatId, 'typing').catch(() => {});
    try {
      const json = await getByVin(vin, locale);

      const header = `Запрос по VIN <b>${escapeHtml(maskVin(vin))}</b> — locale: <b>${escapeHtml(locale)}</b>`;
      const { html, tech } = formatVinCardHtml(json);

      // Соберём payload для кнопок (без длинных строк в callback_data)
      const payload = {
        vin,
        locale,
        catalog: tech.catalog || '',
        ssd: tech.ssd || ''
      };
      const inline = vinInlineKeyboard(payload);

      // Шапка + карточка (HTML), без отправки JSON-файла
      await this.bot.sendMessage(chatId, header, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: homeKeyboard()
      });

      // Клавиатуру вешаем на первую часть карточки, остальным — без клавы
      let first = true;
      for (const part of chunk(html, 3500)) {
        await this.bot.sendMessage(chatId, part, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: first ? inline : undefined
        });
        first = false;
      }
    } catch (e) {
      await this.bot.sendMessage(
        chatId,
        `Не удалось получить данные по VIN: ${escapeHtml(e.message || String(e))}`,
        { parse_mode: 'HTML', reply_markup: homeKeyboard() }
      );
    } finally {
      await typing;
    }
  }

  // ─────────────────────── CALLBACKS ───────────────────────
  async onCallback(q) {
    try {
      const chatId = q.message.chat.id;
      const rec = unpackCb(q.data);
      if (!rec) {
        await this.bot.sendMessage(chatId,
          '⛔ Данные для кнопки устарели. Пожалуйста, повторите запрос VIN.',
          { parse_mode: 'HTML' });
        return this.safeAnswerCallback(q.id);
      }

      const { action, data } = rec;

      if (action === 'refresh') {
        await this.handleVin(q.message, data.vin, data.locale);
        return this.safeAnswerCallback(q.id);
      }

      if (action === 'units' || action === 'details') {
        // Подсказка до подключения реальных эндпоинтов
        const txt = action === 'units'
          ? 'Функция «Узлы» станет активной после подключения REST-эндпоинта /units в вашем Laximo-Connect.'
          : 'Функция «Детали» станет активной после подключения REST-эндпоинта /details в вашем Laximo-Connect.';
        const tech = [
          data.catalog ? `catalog: <code>${escapeHtml(data.catalog)}</code>` : null,
          data.ssd ? `ssd: <code>${escapeHtml(String(data.ssd).slice(0, 12))}…</code>` : null
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
        await this.bot.sendMessage(chatId, part, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: homeKeyboard()
        });
      }
    } catch (e) {
      await this.bot.sendMessage(
        chatId,
        `GPT ошибка: ${escapeHtml(e.message || String(e))}`,
        { parse_mode: 'HTML', reply_markup: homeKeyboard() }
      );
    } finally {
      await typing;
    }
  }
}
