// src/telegram.js
import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';
import { renderVehicleHeader, renderCategoriesList, renderUnitsList } from './helpers/renderCategories.js';
import { saveCategoriesSession, getCategorySsd, setUserVehicle, getUserVehicle } from './cache.js';

export default class Bot {
  constructor(token) {
    this.bot = new TelegramBot(token, { polling: false, webHook: false });
    this.name = 'LaximoBot';
  }

  async setMenuCommands() {
    await this.bot.setMyCommands([
      { command: 'start', description: 'Начало' },
      { command: 'vin',   description: 'Подбор по VIN' },
      { command: 'gpt',   description: 'GPT-чат' },
      { command: 'reset', description: 'Сброс контекста GPT' },
    ]);
  }

  async startPolling() {
    await this.bot.startPolling({ interval: 800, params: { timeout: 30 } });
    this._wireHandlers();
  }

  processUpdate(update) {
    this.bot.processUpdate(update);
  }

  _wireHandlers() {
    this.bot.onText(/^\/start\b/, async (msg) => {
      const chatId = msg.chat.id;
      const text = [
        '<b>Привет!</b> Я помогу с подбором деталей по VIN и покажу дерево узлов.',
        '• Подбор по VIN — <code>/vin WAUZZZ... [locale]</code>',
        '• GPT-чат — <code>/gpt &lt;вопрос&gt;</code>',
        '• Сброс контекста GPT — <code>/reset</code>',
        '',
        'Подсказка: просто пришлите VIN — я сам пойму 😉'
      ].join('\n');
      await this.bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    });

    // /vin WAUZZZ... [locale]
    this.bot.onText(/^\/vin\s+([A-Za-z0-9]{5,})\s*([A-Za-z_]{2,5}_[A-Za-z]{2})?/, async (msg, m) => {
      const chatId = msg.chat.id;
      const vin = (m[1] || '').trim();
      const locale = (m[2] || process.env.DEFAULT_LOCALE || 'ru_RU').trim();
      await this._handleVin(chatId, msg.from.id, vin, locale);
    });

    // Просто VIN без команды
    this.bot.on('message', async (msg) => {
      if (!msg.text) return;
      const chatId = msg.chat.id;
      const t = msg.text.trim();
      if (/^[A-Za-z0-9]{10,}$/.test(t) && !/^\/(vin|gpt|reset|start)/.test(t)) {
        const locale = process.env.DEFAULT_LOCALE || 'ru_RU';
        await this._handleVin(chatId, msg.from.id, t, locale);
      }
    });

    // Callback: выбор категории
    this.bot.on('callback_query', async (q) => {
      const data = q.data || '';
      if (data.startsWith('cat:')) {
        const categoryId = data.split(':')[1];
        await this._handleCategory(q, categoryId);
        return;
      }
      if (data.startsWith('noop:')) {
        // просто скрыть лоадер
        await this.bot.answerCallbackQuery(q.id);
      }
    });
  }

  async _handleVin(chatId, userId, vin, locale) {
    const base = (process.env.LAXIMO_BASE_URL || '').replace(/\/+$/, '');
    if (!base) {
      await this.bot.sendMessage(chatId, 'Не настроен LAXIMO_BASE_URL', { parse_mode: 'HTML' });
      return;
    }

    const url = new URL(base + '/vin');
    url.searchParams.set('vin', vin);
    url.searchParams.set('locale', locale);

    try {
      await this.bot.sendChatAction(chatId, 'typing');
      const r = await fetch(url.toString());
      const j = await r.json();

      if (!j.ok) {
        throw new Error(j.error || 'VIN не найден');
      }

      const vehicle = j.data?.[0]?.vehicles?.[0];
      if (!vehicle) {
        throw new Error('В ответе нет данных автомобиля');
      }

      // Шапка
      const header = renderVehicleHeader(vehicle);
      await this.bot.sendMessage(chatId, header, { parse_mode: 'HTML' });

      // Контекст пользователя (для следующих шагов)
      const catalog = vehicle.catalog;
      const vehicleId = vehicle.vehicleId || '0';
      await setUserVehicle(userId, { catalog, vehicleId });

      // Категории
      const cUrl = new URL(base + '/categories');
      cUrl.searchParams.set('catalog', catalog);
      cUrl.searchParams.set('vehicleId', vehicleId);
      cUrl.searchParams.set('ssd', vehicle.ssd);

      const cRes = await fetch(cUrl.toString());
      const cJson = await cRes.json();
      if (!cJson.ok) throw new Error(cJson.error || 'Не удалось получить категории');

      const categoriesRoot = cJson.data;
      const root = Array.isArray(categoriesRoot?.[0]?.root) ? categoriesRoot[0].root : [];
      await saveCategoriesSession(userId, catalog, vehicleId, root);

      const msg = renderCategoriesList(categoriesRoot);
      await this.bot.sendMessage(chatId, msg.text, {
        parse_mode: msg.parse_mode,
        reply_markup: msg.reply_markup,
        disable_web_page_preview: msg.disable_web_page_preview,
      });
    } catch (e) {
      await this.bot.sendMessage(chatId,
        `Не удалось получить данные по VIN: <code>${escapeHtml(String(e?.message || e))}</code>`,
        { parse_mode: 'HTML' }
      );
    }
  }

  async _handleCategory(q, categoryId) {
    const chatId = q.message?.chat?.id;
    const userId = q.from?.id;
    if (!chatId || !userId) {
      await this.bot.answerCallbackQuery(q.id);
      return;
    }

    try {
      await this.bot.answerCallbackQuery(q.id, { text: 'Загружаю узлы…' });

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
      const uJson = await uRes.json();
      if (!uJson.ok) throw new Error(uJson.error || 'Не удалось получить узлы');

      // Ответ от /units у разных каталогов может иметь разную вложенность.
      // Наиболее типичный: data: [{ units: [ {unitId, name, ...}, ... ] }]
      const data0 = Array.isArray(uJson.data) ? uJson.data[0] : uJson.data || {};
      const units = data0.units || data0?.saaUnits || data0?.unit || [];

      const msg = renderUnitsList(units);
      await this.bot.sendMessage(chatId, msg.text, {
        parse_mode: msg.parse_mode,
        reply_markup: msg.reply_markup,
        disable_web_page_preview: msg.disable_web_page_preview,
      });
    } catch (e) {
      await this.bot.sendMessage(chatId,
        `Не удалось получить узлы: <code>${escapeHtml(String(e?.message || e))}</code>`,
        { parse_mode: 'HTML' }
      );
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
