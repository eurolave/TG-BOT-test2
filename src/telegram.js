// src/telegram.js
import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';
import {
  renderVehicleHeader,
  renderCategoriesList,
  renderUnitsList
} from './helpers/renderCategories.js';
import {
  saveCategoriesSession,
  getCategorySsd,
  setUserVehicle,
  getUserVehicle
} from './cache.js';

// Тексты кнопок меню (reply keyboard)
const BTN_VIN   = '🔎 Подбор по VIN';
const BTN_GPT   = '🤖 GPT-чат';
const BTN_RESET = '♻️ Сброс контекста';

function replyMenu() {
  return {
    resize_keyboard: true,
    keyboard: [
      [{ text: BTN_VIN }, { text: BTN_GPT }],
      [{ text: BTN_RESET }],
    ],
  };
}

export default class Bot {
  constructor(token) {
    this.bot = new TelegramBot(token, { polling: false, webHook: false });
    this.name = 'LaximoBot';

    this._wireHandlers();

    this.bot.on('error', (e) => console.error('[tg:error]', e?.message || e));
    this.bot.on('webhook_error', (e) => console.error('[tg:webhook_error]', e?.message || e));
  }

  async setMenuCommands() {
    await this.bot.setMyCommands([
      { command: 'start', description: 'Начало' },
      { command: 'vin',   description: 'Подбор по VIN' },
      { command: 'gpt',   description: 'GPT-чат' },
      { command: 'reset', description: 'Сброс контекста GPT' },
      { command: 'ping',  description: 'Проверка связи' },
    ]);
  }

  async startPolling() {
    await this.bot.startPolling({ interval: 800, params: { timeout: 30 } });
  }

  processUpdate(update) {
    this.bot.processUpdate(update);
  }

  _wireHandlers() {
    // /start — приветствие + меню
    this.bot.onText(/^\/start\b/, async (msg) => {
      const chatId = msg.chat.id;
      const text = [
        '<b>Привет!</b> Я помогу с подбором деталей по VIN и подскажу по узлам каталога.',
        '',
        'Что умею:',
        '• Подбор по VIN — <code>/vin WAUZZZ... [locale]</code> или кнопка ниже',
        '• GPT-чат — <code>/gpt &lt;вопрос&gt;</code> или кнопка ниже',
        '• Сброс контекста GPT — <code>/reset</code> или кнопка ниже',
        '',
        'Подсказка: можно просто прислать VIN — я сам пойму 😉'
      ].join('\n');
      await this._safeSendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: replyMenu() });
    });

    // /ping
    this.bot.onText(/^\/ping\b/i, async (msg) => {
      await this._safeSendMessage(msg.chat.id, 'pong', { reply_markup: replyMenu() });
    });

    // /vin WAUZZZ... [locale]
    this.bot.onText(/^\/vin\s+([A-Za-z0-9]{5,})\s*([A-Za-z_]{2,5}_[A-Za-z]{2})?/i, async (msg, m) => {
      const chatId = msg.chat.id;
      const vin = (m[1] || '').trim();
      const locale = (m[2] || process.env.DEFAULT_LOCALE || 'ru_RU').trim();
      await this._handleVin(chatId, msg.from.id, vin, locale);
    });

    // ReplyKeyboard кнопки
    this.bot.on('message', async (msg) => {
      if (!msg.text) return;
      const chatId = msg.chat.id;
      const t = msg.text.trim();

      // Командные сообщения не дублируем
      if (/^\/(start|vin|gpt|reset|ping)\b/i.test(t)) return;

      // Нажатие кнопки "Подбор по VIN"
      if (t === BTN_VIN) {
        const hint = [
          '<b>Подбор по VIN</b>',
          'Пришлите VIN как есть (я пойму) или используйте команду:',
          '<code>/vin WAUZZZ4M6JD010702</code>',
          '',
          'Необязательная локаль:',
          '<code>/vin WAUZZZ4M6JD010702 ru_RU</code>'
        ].join('\n');
        await this._safeSendMessage(chatId, hint, { parse_mode: 'HTML', reply_markup: replyMenu() });
        return;
      }

      // Нажатие кнопки "GPT-чат"
      if (t === BTN_GPT) {
        const hint = [
          '<b>GPT-чат</b>',
          'Задайте вопрос командой:',
          '<code>/gpt Какой интервал ТО у Audi Q7?</code>'
        ].join('\n');
        await this._safeSendMessage(chatId, hint, { parse_mode: 'HTML', reply_markup: replyMenu() });
        return;
      }

      // Нажатие кнопки "Сброс контекста"
      if (t === BTN_RESET) {
        const hint = 'Чтобы сбросить контекст GPT, используйте команду: <code>/reset</code>';
        await this._safeSendMessage(chatId, hint, { parse_mode: 'HTML', reply_markup: replyMenu() });
        return;
      }

      // Просто VIN без команды
      if (/^[A-Za-z0-9]{10,}$/.test(t)) {
        const locale = process.env.DEFAULT_LOCALE || 'ru_RU';
        await this._handleVin(chatId, msg.from.id, t, locale);
        return;
      }

      // Остальное игнорируем без эхо, чтобы не раздражать
    });

    this.bot.on('callback_query', async (q) => {
  const data = q.data || '';
  if (data.startsWith('cat:')) {
    const categoryId = data.split(':')[1];
    await this._handleCategory(q, categoryId);
    return;
  }
  if (data.startsWith('noop:page:')) {
    await this.bot.answerCallbackQuery(q.id).catch(() => {});
    const chatId = q.message?.chat?.id;
    const userId = q.from?.id;
    if (!chatId || !userId) return;

    // достаём контекст и корень категорий из кеша
    const ctx = await getUserVehicle(userId);
    if (!ctx?.catalog) {
      return this._safeSendMessage(chatId, 'Контекст автомобиля не найден. Повтори VIN.');
    }

    // у тебя уже сохраняется root через saveCategoriesSession(userId, catalog, vehicleId, root)
    // добавим лёгкий helper в cache.js, если его нет:
    // export async function getCategoriesRoot(userId, catalog, vehicleId) { ... }
    const root = await getCategorySsd(userId, ctx.catalog, ctx.vehicleId || '0', '__root__'); // <-- если так не делал ранее,
    // лучше сделай отдельную функцию getCategoriesRoot; здесь покажу через предположение:
    // const root = await getCategoriesRoot(userId, ctx.catalog, ctx.vehicleId || '0');

    // если в твоём кеше не предусмотрено хранить root под спец-ключом,
    // можно быстро держать «последний categoriesRoot» в памяти процесса.
    // Но правильнее — добавить getCategoriesRoot в cache.js.

    const pageStr = data.split(':')[2] || '0';
    const page = Number(pageStr) || 0;

    const msg = renderCategoriesList(root, page);
    // Перерисуем вместо отправки нового сообщения:
    await this.bot.editMessageText(msg.text, {
      chat_id: chatId,
      message_id: q.message.message_id,
      parse_mode: msg.parse_mode,
      reply_markup: msg.reply_markup,
      disable_web_page_preview: msg.disable_web_page_preview,
    }).catch(async () => {
      // если не получилось отредактировать — просто отправим новое
      await this._safeSendMessage(chatId, msg.text, {
        parse_mode: msg.parse_mode,
        reply_markup: msg.reply_markup,
        disable_web_page_preview: msg.disable_web_page_preview,
      });
    });
    return;
  }
  if (data.startsWith('noop:')) {
    await this.bot.answerCallbackQuery(q.id).catch(() => {});
  }
});


  /** Шаг 1: VIN → карточка авто + кнопка «Категории» */
  async _handleVin(chatId, userId, vin, locale) {
    const base = (process.env.LAXIMO_BASE_URL || '').replace(/\/+$/, '');
    if (!base) {
      await this._safeSendMessage(chatId, 'Не настроен LAXIMO_BASE_URL', { parse_mode: 'HTML', reply_markup: replyMenu() });
      return;
    }

    const url = new URL(base + '/vin');
    url.searchParams.set('vin', vin);
    url.searchParams.set('locale', locale);

    try {
      await this.bot.sendChatAction(chatId, 'typing').catch(() => {});
      const r = await fetch(url.toString());
      const j = await r.json().catch(() => ({}));
      if (!j?.ok) throw new Error(j?.error || 'VIN не найден');

      const vehicle = j.data?.[0]?.vehicles?.[0];
      if (!vehicle) throw new Error('В ответе нет данных автомобиля');

      // Шапка
      const header = renderVehicleHeader(vehicle);
      await this._safeSendMessage(chatId, header, { parse_mode: 'HTML', reply_markup: replyMenu() });

      // Сохраняем контекст (catalog, vehicleId, rootSsd)
      const catalog = vehicle.catalog;
      const vehicleId = vehicle.vehicleId || '0';
      const rootSsd = vehicle.ssd;
      await setUserVehicle(userId, { catalog, vehicleId, rootSsd });

      // Кнопка «Категории»
      await this._safeSendMessage(
        chatId,
        'Что дальше?',
        {
          reply_markup: {
            inline_keyboard: [[{ text: '📂 Категории', callback_data: 'cats' }]]
          }
        }
      );
    } catch (e) {
      await this._safeSendMessage(
        chatId,
        `Не удалось получить данные по VIN: <code>${escapeHtml(String(e?.message || e))}</code>`,
        { parse_mode: 'HTML', reply_markup: replyMenu() }
      );
    }
  }

  /** Шаг 2: Загрузка категорий по кнопке */
  async _handleLoadCategories(q) {
    const chatId = q.message?.chat?.id;
    const userId = q.from?.id;
    if (!chatId || !userId) {
      await this.bot.answerCallbackQuery(q.id).catch(() => {});
      return;
    }

    try {
      await this.bot.answerCallbackQuery(q.id, { text: 'Загружаю категории…' }).catch(() => {});
      const ctx = await getUserVehicle(userId);
      if (!ctx?.catalog || !ctx?.rootSsd) throw new Error('Контекст VIN устарел. Повтори VIN.');

      const { catalog, vehicleId, rootSsd } = ctx;
      const base = (process.env.LAXIMO_BASE_URL || '').replace(/\/+$/, '');

      const cUrl = new URL(base + '/categories');
      cUrl.searchParams.set('catalog', catalog);
      cUrl.searchParams.set('vehicleId', vehicleId || '0');
      cUrl.searchParams.set('ssd', rootSsd);

      const cRes = await fetch(cUrl.toString());
      const cJson = await cRes.json().catch(() => ({}));
      if (!cJson?.ok) throw new Error(cJson?.error || 'Не удалось получить категории');

      const categoriesRoot = cJson.data;
      const root = Array.isArray(categoriesRoot?.[0]?.root) ? categoriesRoot[0].root : [];

      await saveCategoriesSession(userId, catalog, vehicleId || '0', root);

      const msg = renderCategoriesList(categoriesRoot);
      await this._safeSendMessage(chatId, msg.text, {
        parse_mode: msg.parse_mode,
        reply_markup: msg.reply_markup,
        disable_web_page_preview: msg.disable_web_page_preview,
      });
    } catch (e) {
      await this._safeSendMessage(
        chatId,
        `Не удалось получить категории: <code>${escapeHtml(String(e?.message || e))}</code>`,
        { parse_mode: 'HTML', reply_markup: replyMenu() }
      );
    }
  }

  /** Шаг 3: Узлы по категории */
  async _handleCategory(q, categoryId) {
    const chatId = q.message?.chat?.id;
    const userId = q.from?.id;
    if (!chatId || !userId) {
      await this.bot.answerCallbackQuery(q.id).catch(() => {});
      return;
    }

    try {
      await this.bot.answerCallbackQuery(q.id, { text: 'Загружаю узлы…' }).catch(() => {});

      const ctx = await getUserVehicle(userId);
      if (!ctx?.catalog) throw new Error('Контекст автомобиля не найден. Повтори VIN.');
      const { catalog, vehicleId } = ctx;

      const ssd = await getCategorySsd(userId, catalog, vehicleId || '0', categoryId);
      if (!ssd) throw new Error('Сессия категорий устарела. Повтори VIN.');

      const base = (process.env.LAXIMO_BASE_URL || '').replace(/\/+$/, '');
      const uUrl = new URL(base + '/units');
      uUrl.searchParams.set('catalog', catalog);
      uUrl.searchParams.set('vehicleId', vehicleId || '0');
      uUrl.searchParams.set('ssd', ssd);
      uUrl.searchParams.set('categoryId', String(categoryId));

      const uRes = await fetch(uUrl.toString());
      const uJson = await uRes.json().catch(() => ({}));
      if (!uJson?.ok) throw new Error(uJson?.error || 'Не удалось получить узлы');

      const data0 = Array.isArray(uJson.data) ? uJson.data[0] : (uJson.data || {});
      const units = data0.units || data0?.saaUnits || data0?.unit || [];

      const msg = renderUnitsList(units);
      await this._safeSendMessage(chatId, msg.text, {
        parse_mode: msg.parse_mode,
        reply_markup: msg.reply_markup,
        disable_web_page_preview: msg.disable_web_page_preview,
      });
    } catch (e) {
      await this._safeSendMessage(
        chatId,
        `Не удалось получить узлы: <code>${escapeHtml(String(e?.message || e))}</code>`,
        { parse_mode: 'HTML', reply_markup: replyMenu() }
      );
    }
  }

  async _safeSendMessage(chatId, text, opts = undefined) {
    try {
      await this.bot.sendMessage(chatId, text, opts);
    } catch (e) {
      const resp = e?.response;
      if (resp?.statusCode || resp?.body) {
        console.error('[sendMessage error]', resp.statusCode, resp.body || resp);
      } else {
        console.error('[sendMessage error]', e?.message || e);
      }
    }
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
