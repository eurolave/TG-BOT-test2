// src/telegram.js
import TelegramBot from 'node-telegram-bot-api';
import { getByVin, getUnits } from './laximoClient.js';
import { formatVinCardHtml, formatUnitsPage } from './formatters.js';
import { chunk, maskVin, escapeHtml, fmtMoney } from './utils.js';
import { chat as gptChat, reset as gptReset } from './gpt.js';
import { getBalance, setBalance, addBalance, chargeBalance } from './userStore.js';

const VIN_RE = /\b([A-HJ-NPR-Z0-9]{8,})\b/i;

/** ReplyKeyboard под полем ввода */
function homeKeyboard() {
  return {
    keyboard: [
      [{ text: '🔎 Подбор по VIN' }, { text: '🤖 GPT-чат' }],
      [{ text: '💳 Баланс' }, { text: '♻️ Сброс GPT контекста' }]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

/** ── компактный callback store (токены ≤64B) ── */
const cbStore = new Map(); // token -> { action, data, ts }
const CB_TTL_MS = 10 * 60 * 1000;
const CB_MAX = 5000;
function gcCbStore() {
  const now = Date.now();
  for (const [k, v] of cbStore) if (now - v.ts > CB_TTL_MS) cbStore.delete(k);
  if (cbStore.size > CB_MAX) {
    const arr = [...cbStore.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (const [k] of arr.slice(0, cbStore.size - CB_MAX)) cbStore.delete(k);
  }
}
function makeToken() { return Math.random().toString(36).slice(2, 14); }
function packCb(action, data) { gcCbStore(); const t = makeToken(); cbStore.set(t, { action, data, ts: Date.now() }); return `x:${t}`; }
function unpackCb(s) { const m = /^x:([a-z0-9]+)$/i.exec(String(s||'')); return m ? cbStore.get(m[1]) || null : null; }

/** Inline-клава карточки VIN */
function vinInlineKeyboard(payload) {
  const btnUnits   = packCb('units',   { ...payload, page: 0 });
  const btnRefresh = packCb('refresh', { vin: payload.vin, locale: payload.locale });
  return {
    inline_keyboard: [[
      { text: '🔩 Узлы',     callback_data: btnUnits },
      { text: '🔁 Обновить', callback_data: btnRefresh }
    ]]
  };
}

/** Inline-клава списка узлов c пагинацией */
function unitsInlineKeyboard(payload) {
  // payload: { vin, locale, catalog, ssd, page, perPage, total }
  const prev = Math.max(0, (payload.page || 0) - 1);
  const next = Math.min(Math.ceil((payload.total || 0) / (payload.perPage || 10)) - 1, (payload.page || 0) + 1);

  const prevBtn = packCb('units_page', { ...payload, page: prev });
  const nextBtn = packCb('units_page', { ...payload, page: next });
  const backBtn = packCb('vin_back',   { vin: payload.vin, locale: payload.locale });

  return {
    inline_keyboard: [[
      { text: '⬅️ Назад', callback_data: prevBtn },
      { text: '➡️ Далее', callback_data: nextBtn },
    ], [
      { text: '🔙 К VIN', callback_data: backBtn }
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

    // Баланс
    this.bot.onText(/^\/balance\b/i, (m) => this.onBalance(m));
    this.bot.onText(/^\/topup\s+(-?\d+(?:\.\d+)?)$/i, (m, mm) => this.onTopUp(m, mm[1]));
    this.bot.onText(/^\/charge\s+(-?\d+(?:\.\d+)?)$/i, (m, mm) => this.onCharge(m, mm[1]));

    // Сообщения
    this.bot.on('message', (m) => this.onMessage(m));

    // Callback
    this.bot.on('callback_query', (q) => this.onCallback(q));

    this.bot.on('polling_error', (e) => console.error('[polling_error]', e));
    this.bot.on('webhook_error',  (e) => console.error('[webhook_error]', e));
  }

  async setMenuCommands() {
    await this.bot.setMyCommands(
      [
        { command: 'vin',     description: 'Подбор по VIN' },
        { command: 'gpt',     description: 'GPT-чат: спросить ИИ' },
        { command: 'balance', description: 'Показать баланс' },
        { command: 'reset',   description: 'Сбросить контекст GPT' },
        { command: 'help',    description: 'Как пользоваться' },
        { command: 'menu',    description: 'Показать кнопки меню' }
      ],
      { scope: { type: 'default' }, language_code: '' }
    );
  }

  async startPolling() { this.bot.options.polling = { interval: 800, params: { timeout: 30 } }; await this.bot.startPolling(); }
  async setWebhook(url) { await this.bot.setWebHook(url); }
  processUpdate(update) { this.bot.processUpdate(update); }

  // UI
  async onStart(msg) {
    const userId = msg.from?.id;
    const balance = fmtMoney(await getBalance(userId));
    const text = [
      '👋 <b>Привет!</b> Я помогу тебе работать с VIN и общаться с GPT-5.',
      '',
      `🧑‍💻 <b>ID:</b> <code>${escapeHtml(String(userId))}</code>`,
      `💳 <b>Баланс:</b> <code>${escapeHtml(balance)}</code>`,
      '',
      '✨ Вот что я умею:',
      '• 🔎 <b>Подбор по VIN</b> — <code>/vin WAUZZZ...</code> или кнопка ниже.',
      '• 🤖 <b>GPT-чат</b> — <code>/gpt &lt;вопрос&gt;</code> или кнопка ниже.',
      '• ♻️ <b>Сбросить контекст</b> — <code>/reset</code>.',
      '',
      '💡 Просто пришли VIN в чат — я сам его распознаю.'
    ].join('\n');
    await this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', reply_markup: homeKeyboard() });
  }
  async onHelp(msg) { return this.onStart(msg); }
  async onMenu(msg) {
    const userId = msg.from?.id;
    const balance = fmtMoney(await getBalance(userId));
    await this.bot.sendMessage(
      msg.chat.id,
      `Кнопки меню показаны ✅\n<b>ID:</b> <code>${escapeHtml(String(userId))}</code>\n<b>Баланс:</b> <code>${escapeHtml(balance)}</code>`,
      { parse_mode: 'HTML', reply_markup: homeKeyboard() }
    );
  }

  // Баланс
  async onBalance(msg) {
    const userId = msg.from?.id;
    const balance = fmtMoney(await getBalance(userId));
    await this.bot.sendMessage(
      msg.chat.id,
      `💳 <b>Ваш баланс:</b> <code>${escapeHtml(balance)}</code>\n🧑‍💻 <b>ID:</b> <code>${escapeHtml(String(userId))}</code>`,
      { parse_mode: 'HTML', reply_markup: homeKeyboard() }
    );
  }
  async onTopUp(msg, amountStr) {
    const userId = msg.from?.id;
    const amount = parseFloat(amountStr);
    if (!Number.isFinite(amount)) {
      return this.bot.sendMessage(msg.chat.id, 'Введите сумму: <code>/topup 100</code>', { parse_mode: 'HTML' });
    }
    await addBalance(userId, amount);
    const balance = fmtMoney(await getBalance(userId));
    await this.bot.sendMessage(msg.chat.id, `✅ Пополнено на <code>${escapeHtml(balance)}</code>`, { parse_mode: 'HTML', reply_markup: homeKeyboard() });
  }
  async onCharge(msg, amountStr) {
    const userId = msg.from?.id;
    const amount = parseFloat(amountStr);
    if (!Number.isFinite(amount)) {
      return this.bot.sendMessage(msg.chat.id, 'Введите сумму: <code>/charge 50</code>', { parse_mode: 'HTML' });
    }
    await chargeBalance(userId, amount);
    const balance = fmtMoney(await getBalance(userId));
    await this.bot.sendMessage(msg.chat.id, `✅ Списано. Баланс: <code>${escapeHtml(balance)}</code>`, { parse_mode: 'HTML', reply_markup: homeKeyboard() });
  }

  // Сообщения
  async onMessage(msg) {
    const text = (msg.text || '').trim();
    if (!text) return;

    if (text === '🔎 Подбор по VIN') {
      return this.bot.sendMessage(msg.chat.id, 'Пришлите VIN или используйте команду:\n<code>/vin WAUZZZ... [locale]</code>', { parse_mode: 'HTML' });
    }
    if (text === '🤖 GPT-чат') {
      return this.bot.sendMessage(msg.chat.id, 'Спросите что-нибудь: <code>/gpt Чем GPT-5 отличается?</code>', { parse_mode: 'HTML' });
    }
    if (text === '💳 Баланс')  return this.onBalance(msg);
    if (text === '♻️ Сброс GPT контекста') return this.onReset(msg);

    const vinMatch = text.match(VIN_RE);
    if (vinMatch && !text.startsWith('/')) {
      return this.handleVin(msg, vinMatch[1], process.env.DEFAULT_LOCALE || 'ru_RU');
    }
    if (!text.startsWith('/')) return this.handleGpt(msg, text);
  }

  // VIN
  async handleVin(msg, vin, locale = 'ru_RU', opts = {}) {
    const chatId = msg.chat.id;
    const typing = this.bot.sendChatAction(chatId, 'typing').catch(() => {});
    try {
      const json = await getByVin(vin, locale, opts);
      const userId = msg.from?.id;
      const balance = fmtMoney(await getBalance(userId));

      const header = [
        `Запрос по VIN <b>${escapeHtml(maskVin(vin))}</b> — locale: <b>${escapeHtml(locale)}</b>`,
        `🧑‍💻 ID: <code>${escapeHtml(String(userId))}</code> • 💳 Баланс: <code>${escapeHtml(balance)}</code>`
      ].join('\n');

      const { html, tech } = formatVinCardHtml(json);
      const payload = { vin, locale, catalog: tech.catalog || '', ssd: tech.ssd || '' };
      const inline = vinInlineKeyboard(payload);

      await this.bot.sendMessage(chatId, header, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: homeKeyboard() });

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
      await this.bot.sendMessage(chatId, `Не удалось получить данные по VIN: ${escapeHtml(e.message || String(e))}`, { parse_mode: 'HTML', reply_markup: homeKeyboard() });
    } finally { await typing; }
  }

  // CALLBACKS
  async onCallback(q) {
    try {
      const chatId = q.message.chat.id;
      const rec = unpackCb(q.data);
      if (!rec) {
        await this.bot.sendMessage(chatId, '⛔ Данные для кнопки устарели. Повторите запрос VIN.', { parse_mode: 'HTML' });
        return this.safeAnswerCallback(q.id);
      }

      const { action, data } = rec;

      if (action === 'refresh') {
        await this.handleVin(q.message, data.vin, data.locale, { force: true });
        return this.safeAnswerCallback(q.id);
      }

      if (action === 'vin_back') {
        await this.handleVin(q.message, data.vin, data.locale);
        return this.safeAnswerCallback(q.id);
      }

      if (action === 'units' || action === 'units_page') {
        const { vin, locale, catalog, ssd } = data;
        const page = Math.max(0, data.page || 0);
        const perPage = 10;

        // грузим список узлов (из кэша/REST)
        let unitsResp;
        try {
          unitsResp = await getUnits(catalog, ssd, locale);
        } catch (e) {
          await this.bot.sendMessage(chatId, `Не удалось получить узлы: ${escapeHtml(e.message || String(e))}`, { parse_mode: 'HTML' });
          return this.safeAnswerCallback(q.id);
        }

        const units = Array.isArray(unitsResp?.data) ? unitsResp.data : [];
        const total = units.length;

        if (total === 0) {
          await this.bot.sendMessage(chatId, 'Узлы не найдены для данного VIN.', { parse_mode: 'HTML' });
          return this.safeAnswerCallback(q.id);
        }

        const html = formatUnitsPage(units, page, perPage, locale);
        const kb = unitsInlineKeyboard({ vin, locale, catalog, ssd, page, perPage, total });

        await this.bot.sendMessage(chatId, html, { parse_mode: 'HTML', reply_markup: kb });
        return this.safeAnswerCallback(q.id);
      }

      // по умолчанию
      await this.safeAnswerCallback(q.id);
    } catch (e) {
      console.error('[callback_error]', e);
      try { await this.safeAnswerCallback(q.id); } catch {}
    }
  }

  safeAnswerCallback(id) { return this.bot.answerCallbackQuery(id).catch(() => {}); }

  // GPT
  async handleGpt(msg, promptText) {
    const chatId = msg.chat.id;
    const typing = this.bot.sendChatAction(chatId, 'typing').catch(() => {});
    try {
      const answer = await gptChat(chatId, promptText || 'Привет!');
      for (const part of chunk(answer)) {
        await this.bot.sendMessage(chatId, part, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: homeKeyboard() });
      }
    } catch (e) {
      await this.bot.sendMessage(chatId, `GPT ошибка: ${escapeHtml(e.message || String(e))}`, { parse_mode: 'HTML', reply_markup: homeKeyboard() });
    } finally { await typing; }
  }

  // RESET
  async onReset(msg) {
    try {
      gptReset(msg.chat.id);
      await this.bot.sendMessage(msg.chat.id, 'Контекст GPT очищен ✅', { reply_markup: homeKeyboard() });
    } catch (e) {
      await this.bot.sendMessage(msg.chat.id, `Ошибка при сбросе: ${escapeHtml(e.message || String(e))}`, { parse_mode: 'HTML', reply_markup: homeKeyboard() });
    }
  }
}
