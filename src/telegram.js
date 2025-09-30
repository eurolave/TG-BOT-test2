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

/** Inline-клавиатура для карточки VIN */
function vinInlineKeyboard(vin, locale, catalog, ssd) {
  return {
    inline_keyboard: [[
      { text: '🔩 Узлы',    callback_data: `units|${vin}|${locale}|${catalog||''}|${encodeURIComponent(ssd||'')}` },
      { text: '🧩 Детали',  callback_data: `details|${vin}|${locale}|${catalog||''}|${encodeURIComponent(ssd||'')}` },
      { text: '🔁 Обновить', callback_data: `refresh|${vin}|${locale}` }
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
        { parse_mode: 'HTML'_
