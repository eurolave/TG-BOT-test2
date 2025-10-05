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
  getCategoryRecord,
  setUserVehicle,
  getUserVehicle,
  setCategoriesRoot,
  getCategoriesRoot,
  // новые:
  saveUnitsSession,
  getUnitRecord,
  setLastCategory,
  getLastCategory
} from './cache.js';

// ─────────────────────── UI: Reply keyboard ───────────────────────
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

// Безопасное извлечение числа из callback_data вида unit:<id>[:<categoryId>]
function parseUnitCbData(data) {
  // допускаем unit:123 или node:123, и необязательный :<categoryId>
  const m = data.match(/^(?:unit|node):([^:]+)(?::([^:]+))?$/);
  if (!m) return null;
  return { unitId: String(m[1]), categoryId: m[2] ? String(m[2]) : undefined };
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

    // ReplyKeyboard кнопки и простые сообщения
    this.bot.on('message', async (msg) => {
      if (!msg.text) return;
      const chatId = msg.chat.id;
      const t = msg.text.trim();

      // Команды — не дублируем
      if (/^\/(start|vin|gpt|reset|ping)\b/i.test(t)) return;

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

      if (t === BTN_GPT) {
        const hint = [
          '<b>GPT-чат</b>',
          'Задайте вопрос командой:',
          '<code>/gpt Какой интервал ТО у Audi Q7?</code>'
        ].join('\n');
        await this._safeSendMessage(chatId, hint, { parse_mode: 'HTML', reply_markup: replyMenu() });
        return;
      }

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

      // Остальное игнорируем
    });

    // ───────────── callback_query ─────────────
    this.bot.on('callback_query', async (q) => {
      const data = q.data || '';
      // снимем «часики»
      await this.bot.answerCallbackQuery(q.id).catch(() => {});

      // 1) «Категории» — загрузка с API
      if (data === 'cats') {
        await this._handleLoadCategories(q);
        return;
      }

      // 1.1) «Обновить» — из кэша
      if (data === 'cats_cache') {
        const chatId = q.message?.chat?.id;
        const userId = q.from?.id;
        if (!chatId || !userId) return;

        const ctx = await getUserVehicle(userId);
        const catsRoot = ctx ? await getCategoriesRoot(userId, ctx.catalog, ctx.vehicleId || '0') : null;
        if (!catsRoot) {
          await this._safeSendMessage(chatId, 'Кэш пуст. Нажмите «Перезагрузить».');
          return;
        }

        const msg = renderCategoriesList(catsRoot, 0);
        await this._editOrSend(chatId, q.message?.message_id, msg.text, {
          parse_mode: msg.parse_mode,
          reply_markup: addCatsFooter(msg.reply_markup),
          disable_web_page_preview: msg.disable_web_page_preview,
        });
        return;
      }

      // 2) Выбор категории
      if (data.startsWith('cat:')) {
        const categoryId = data.split(':')[1];
        await this._handleCategory(q, categoryId);
        return;
      }

      // 2.1) Выбор узла (поддержка unit: и node:)
      if (/^(unit|node):/.test(data)) {
        const parsed = parseUnitCbData(data);
        if (!parsed?.unitId) {
          await this._safeSendMessage(q.message?.chat?.id, `Не удалось распарсить кнопку: ${data}`);
          return;
        }
        await this._handleUnit(q, parsed.unitId, parsed.categoryId);
        return;
      }

      // 3) Пагинация категорий (из кэша)
      if (data.startsWith('noop:page:')) {
        const chatId = q.message?.chat?.id;
        const userId = q.from?.id;
        if (!chatId || !userId) return;

        const ctx = await getUserVehicle(userId);
        const catsRoot = ctx ? await getCategoriesRoot(userId, ctx.catalog, ctx.vehicleId || '0') : null;
        if (!catsRoot) {
          await this._safeSendMessage(chatId, 'Список категорий устарел. Нажмите «Перезагрузить».');
          return;
        }

        const pageStr = data.split(':')[2] || '0';
        const page = Number(pageStr) || 0;
        const msg = renderCategoriesList(catsRoot, page);

        await this._editOrSend(chatId, q.message?.message_id, msg.text, {
          parse_mode: msg.parse_mode,
          reply_markup: addCatsFooter(msg.reply_markup),
          disable_web_page_preview: msg.disable_web_page_preview,
        });
        return;
      }

      // 4) Прочие noop
      if (data.startsWith('noop:')) return;

      // 5) Неизвестно
      const chatId = q.message?.chat?.id;
      if (chatId) await this._safeSendMessage(chatId, `Неизвестная кнопка: ${data}`);
    });
  }

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

      const header = renderVehicleHeader(vehicle);
      await this._safeSendMessage(chatId, header, { parse_mode: 'HTML', reply_markup: replyMenu() });

      const catalog = vehicle.catalog;
      const vehicleId = vehicle.vehicleId || '0';
      const rootSsd = vehicle.ssd;
      await setUserVehicle(userId, { catalog, vehicleId, rootSsd });

      await this._safeSendMessage(chatId, '&nbsp;', {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: '📂 Перейти в каталог', callback_data: 'cats' }]]
        }
      });

    } catch (e) {
      await this._safeSendMessage(
        chatId,
        `Не удалось получить данные по VIN: <code>${escapeHtml(String(e?.message || e))}</code>`,
        { parse_mode: 'HTML', reply_markup: replyMenu() }
      );
    }
  }

  /** Шаг 2: Загрузка категорий по кнопке (API → кэш → вывод) */
  async _handleLoadCategories(q) {
    const chatId = q.message?.chat?.id;
    const userId = q.from?.id;
    if (!chatId || !userId) return;

    try {
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
      const root = extractRoot(categoriesRoot);

      await saveCategoriesSession(userId, catalog, vehicleId || '0', root);
      await setCategoriesRoot(userId, catalog, vehicleId || '0', categoriesRoot);

      const msg = renderCategoriesList(categoriesRoot);
      await this._safeSendMessage(chatId, msg.text, {
        parse_mode: msg.parse_mode,
        reply_markup: addCatsFooter(msg.reply_markup),
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
    if (!chatId || !userId) return;

    try {
      const ctx = await getUserVehicle(userId);
      if (!ctx?.catalog) throw new Error('Контекст автомобиля не найден. Повтори VIN.');
      const { catalog, vehicleId } = ctx;

      const category = await getCategoryRecord(userId, catalog, vehicleId || '0', categoryId);
      const ssd = category?.ssd;
      const canonicalCategoryId = category?.categoryId ?? categoryId;

      if (!ssd) throw new Error('Сессия категорий устарела. Повтори VIN.');

      const base = (process.env.LAXIMO_BASE_URL || '').replace(/\/+$/, '');
      const uUrl = new URL(base + '/units');
      uUrl.searchParams.set('catalog', catalog);
      uUrl.searchParams.set('vehicleId', vehicleId || '0');
      uUrl.searchParams.set('ssd', ssd);
      uUrl.searchParams.set('categoryId', String(canonicalCategoryId));

      const uRes = await fetch(uUrl.toString());
      const uJson = await uRes.json().catch(() => ({}));
      if (!uJson?.ok) throw new Error(uJson?.error || 'Не удалось получить узлы');

      const data0 = Array.isArray(uJson.data) ? uJson.data[0] : (uJson.data || {});
      const units = data0.units || data0?.saaUnits || data0?.unit || [];

      // Сохраним узлы по категории (unitId -> {ssd, ...})
      await saveUnitsSession(userId, catalog, vehicleId || '0', String(canonicalCategoryId), units);
      await setLastCategory(userId, catalog, vehicleId || '0', String(canonicalCategoryId));

      // Рендер списка узлов
      const msg = renderUnitsList(units);

      // Гарантируем, что в callback_data у кнопок узлов есть categoryId (unit:<id>:<catId>)
      const patchedMarkup = ensureCategoryInUnitCallbacks(msg.reply_markup, String(canonicalCategoryId));

      await this._safeSendMessage(chatId, msg.text, {
        parse_mode: msg.parse_mode,
        reply_markup: patchedMarkup,
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

  /** Шаг 4: Детали/состав по узлу */
  async _handleUnit(q, unitId, categoryIdFromCb) {
    const chatId = q.message?.chat?.id;
    const userId = q.from?.id;
    if (!chatId || !userId) return;

    try {
      await this.bot.sendChatAction(chatId, 'typing').catch(() => {});
      const ctx = await getUserVehicle(userId);
      if (!ctx?.catalog) throw new Error('Контекст автомобиля не найден. Повтори VIN.');

      const { catalog, vehicleId } = ctx;

      // Определим categoryId: либо из callback_data, либо «последняя выбранная»
      let categoryId = categoryIdFromCb;
      if (!categoryId) {
        categoryId = await getLastCategory(userId, catalog, vehicleId || '0');
      }
      if (!categoryId) throw new Error('Не удалось определить категорию. Откройте категории заново.');

      // Достанем узел из кэша и возьмём ssd
      const rec = await getUnitRecord(userId, catalog, vehicleId || '0', String(categoryId), String(unitId));
      const ssd = rec?.ssd;
      if (!ssd) throw new Error('Не найден ssd узла в сессии. Перезагрузите категории.');

      const base = (process.env.LAXIMO_BASE_URL || '').replace(/\/+$/, '');
      if (!base) throw new Error('Не настроен LAXIMO_BASE_URL');

      // Правильный вызов: по ssd узла
      const uUrl = new URL(base + '/unit');
      uUrl.searchParams.set('catalog', catalog);
      uUrl.searchParams.set('vehicleId', vehicleId || '0');
      uUrl.searchParams.set('ssd', String(ssd));

      const uRes = await fetch(uUrl.toString());
      const uJson = await uRes.json().catch(() => ({}));
      if (!uJson?.ok) throw new Error(uJson?.error || 'Не удалось получить состав узла');

      const partsArr = Array.isArray(uJson.data) ? uJson.data
        : (uJson.data?.parts || uJson.data?.Units || uJson.data?.unitParts || []);
      if (!partsArr?.length) {
        await this._safeSendMessage(chatId, `По узлу ${unitId} детали не найдены (ssd: ${ssd}).`);
        return;
      }

      const lines = partsArr.slice(0, 30).map((p, i) => {
        const name = p.name || p.partName || p.PartName || p.article || p.oem || '—';
        const art  = p.article || p.oem || p.Oem || '';
        return `${i + 1}. ${name}${art ? ` (${art})` : ''}`;
      });

      await this._safeSendMessage(chatId, [
        `🔩 Узел: ${unitId}`,
        '',
        lines.join('\n'),
        partsArr.length > 30 ? `… и ещё ${partsArr.length - 30}` : ''
      ].join('\n'), { disable_web_page_preview: true });

    } catch (e) {
      await this._safeSendMessage(
        chatId,
        `Не удалось получить состав узла: <code>${escapeHtml(String(e?.message || e))}</code>`,
        { parse_mode: 'HTML' }
      );
    }
  }

  async _editOrSend(chatId, messageId, text, opts) {
    try {
      await this.bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
    } catch {
      await this._safeSendMessage(chatId, text, opts);
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

// ─────────────────────── helpers ───────────────────────

/** Добавить в конец клавиатуры кнопки «Обновить/Перезагрузить» */
function addCatsFooter(reply_markup) {
  const rm = reply_markup || {};
  const kb = Array.isArray(rm.inline_keyboard) ? rm.inline_keyboard.slice() : [];
  kb.push([
    { text: '🔁 Обновить', callback_data: 'cats_cache' },
    { text: '🔄 Перезагрузить', callback_data: 'cats' },
  ]);
  return { inline_keyboard: kb };
}

/** Убедиться, что у кнопок узлов есть categoryId в callback_data: unit:<uid>:<catId> */
function ensureCategoryInUnitCallbacks(reply_markup, categoryId) {
  if (!reply_markup?.inline_keyboard) return reply_markup;
  const kb = reply_markup.inline_keyboard.map(row =>
    row.map(btn => {
      if (!btn?.callback_data) return btn;
      const m = btn.callback_data.match(/^(unit|node):([^:]+)(?::([^:]+))?$/);
      if (!m) return btn;
      if (m[3]) return btn; // уже есть categoryId
      const prefix = m[1];
      const uid = m[2];
      return { ...btn, callback_data: `${prefix}:${uid}:${categoryId}` };
    })
  );
  return { inline_keyboard: kb };
}

function extractRoot(categoriesRoot) {
  // Поддержка разных форматов:
  // 1) [{ root: [...] }]
  // 2) { root: [...] }
  // 3) [ ... ]
  // 4) { data: ... } — на всякий случай
  if (Array.isArray(categoriesRoot?.[0]?.root)) return categoriesRoot[0].root;
  if (Array.isArray(categoriesRoot?.root)) return categoriesRoot.root;
  if (Array.isArray(categoriesRoot)) return categoriesRoot;

  const d = categoriesRoot?.data;
  if (Array.isArray(d?.[0]?.root)) return d[0].root;
  if (Array.isArray(d?.root)) return d.root;
  if (Array.isArray(d)) return d;

  return [];
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
