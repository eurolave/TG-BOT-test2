import TelegramBot from 'node-telegram-bot-api';
import { getByVin } from './laximoClient.js';
import { summarizeVinResponse } from './formatters.js';
import { chunk, maskVin, escapeMd } from './utils.js';
import { chat as gptChat, reset as gptReset } from './gpt.js';

const VIN_RE = /\b([A-HJ-NPR-Z0-9]{8,})\b/i;

export default class Bot {
  constructor(token) {
    this.bot = new TelegramBot(token, { polling: false });

    this.bot.onText(/^\/start\b/i, (m) => this.onStart(m));
    this.bot.onText(/^\/help\b/i,  (m) => this.onHelp(m));
    this.bot.onText(/^\/vin(?:@[\w_]+)?\s+([A-HJ-NPR-Z0-9]{8,})(?:\s+(\S+))?/i,
      (m, mm) => this.handleVin(m, mm[1], mm[2] || process.env.DEFAULT_LOCALE || 'ru_RU'));
    this.bot.onText(/^\/gpt(?:@[\w_]+)?\s*(.*)$/is, (m, mm) => this.handleGpt(m, mm[1]));
    this.bot.onText(/^\/reset\b/i, (m) => this.onReset(m));

    // свободные сообщения — VIN или GPT
    this.bot.on('message', (m) => this.onMessage(m));

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
      '• *Подбор по VIN* — команда: `/vin WAUZZZ... [locale]`',
      '• *GPT-чат* — команда: `/gpt <вопрос>` или просто напишите сообщение',
      '• Сброс контекста GPT: `/reset`',
      '',
      'Подсказка: просто пришлите VIN — я сам пойму.'
    ].join('\n');
    await this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
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

  async handleVin(msg, vin, locale = 'ru_RU') {
    const chatId = msg.chat.id;
    const typing = this.bot.sendChatAction(chatId, 'typing').catch(() => {});
    try {
      const json = await getByVin(vin, locale);

      const summary = summarizeVinResponse(json);
      const header = `Запрос по VIN *${escapeMd(maskVin(vin))}* (locale: \`${escapeMd(locale)}\`)`;
      const md = [header, '', summary].join('\n');

      for (const part of chunk(md)) {
        await this.bot.sendMessage(chatId, part, { parse_mode: 'MarkdownV2', disable_web_page_preview: true });
      }

      const pretty = JSON.stringify(json, null, 2);
      const fileName = `vin_${vin}_${Date.now()}.json`;
      await this.bot.sendDocument(chatId, Buffer.from(pretty, 'utf8'), {}, { filename: fileName, contentType: 'application/json' });
    } catch (e) {
      await this.bot.sendMessage(chatId, `Не удалось получить данные по VIN: ${escapeMd(e.message || String(e))}`, { parse_mode: 'MarkdownV2' });
    } finally {
      await typing;
    }
  }

  async handleGpt(msg, promptText) {
    const chatId = msg.chat.id;
    const typing = this.bot.sendChatAction(chatId, 'typing').catch(() => {});
    try {
      const answer = await (await import('./gpt.js')).chat(chatId, promptText || 'Привет!');
      for (const part of chunk(answer)) {
        await this.bot.sendMessage(chatId, part, { disable_web_page_preview: true });
      }
    } catch (e) {
      await this.bot.sendMessage(chatId, `GPT ошибка: ${escapeMd(e.message || String(e))}`, { parse_mode: 'MarkdownV2' });
    } finally {
      await typing;
    }
  }
}
