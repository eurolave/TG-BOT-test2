// src/formatters.js
import { escapeHtml, detectLangFromLocale, brandEmoji } from './utils.js';

/**
 * HTML-карточка VIN (локализация ru/en, эмодзи брендов)
 * Ожидаемый вход: { ok, data: [ { vehicles:[{ brand, name, attributes, catalog, ssd }] } ], vin, locale }
 */
export function formatVinCardHtml(json) {
  const root = json?.data ?? json;
  const vin  = json?.vin || '';
  const locale = json?.locale || 'ru_RU';
  const lang = detectLangFromLocale(locale);

  const vehicles = Array.isArray(root) ? root[0]?.vehicles : root?.vehicles;
  const v = Array.isArray(vehicles) ? vehicles[0] : null;

  const A = v?.attributes || {};
  const getV = (k) => A?.[k]?.value ?? '';
  const brand = v?.brand || '';
  const model = v?.name  || '';
  const emoji = brandEmoji(brand);

  const labels = {
    ru: {
      date: 'Дата выпуска', manufactured: 'Выпущено', prodrange: 'Период производства',
      engine: 'Двигатель', engine_info: 'Двигатель', transmission: 'КПП',
      framecolor: 'Цвет кузова', trimcolor: 'Цвет салона'
    },
    en: {
      date: 'Production date', manufactured: 'Manufactured', prodrange: 'Production range',
      engine: 'Engine', engine_info: 'Engine', transmission: 'Transmission',
      framecolor: 'Body color', trimcolor: 'Interior color'
    }
  }[lang];

  const items = [
    ['📅', labels.date,         getV('date')],
    ['🏭', labels.manufactured, getV('manufactured')],
    ['⏳', labels.prodrange,    getV('prodrange')],
    ['⚙️', labels.engine,       getV('engine')],
    ['🚗', labels.engine_info,  getV('engine_info')],
    ['🔧', labels.transmission, getV('transmission')],
    ['🎨', labels.framecolor,   getV('framecolor')],
    ['🪑', labels.trimcolor,    getV('trimcolor')]
  ].filter(([, , val]) => !!val);

  const title = `${emoji} <b>${escapeHtml(brand || '')} ${escapeHtml(model || '')}</b>`;
  const localeLabel = lang === 'ru' ? 'locale' : 'locale';
  const subtitle = `VIN: <b>${escapeHtml(vin)}</b> &nbsp;•&nbsp; ${escapeHtml(localeLabel)}: <b>${escapeHtml(locale)}</b>`;
  const lines = items.map(([e, name, val]) => `${e} <b>${escapeHtml(name)}:</b> ${escapeHtml(String(val))}`);

  const tech = { catalog: v?.catalog || '', ssd: v?.ssd || '' };

  return { html: [title, subtitle, '', ...lines].join('\n'), tech };
}

/**
 * Рендер страницы списка узлов (HTML)
 * units: массив объектов с { id, name } (минимум), page: 0-based, perPage
 */
export function formatUnitsPage(units = [], page = 0, perPage = 10, locale = 'ru_RU') {
  const total = units.length;
  const from = page * perPage;
  const to = Math.min(from + perPage, total);
  const slice = units.slice(from, to);

  const title = locale.startsWith('ru') ? '🔩 Узлы автомобиля' : '🔩 Vehicle units';
  const sub = `${from + 1}–${to} / ${total}`;
  const lines = slice.map((u, i) => {
    const idx = from + i + 1;
    const name = u?.name ?? u?.text ?? u?.title ?? `#${u?.id ?? ''}`;
    return `• <b>${idx}.</b> ${escapeHtml(String(name))}`;
  });

  return [`<b>${title}</b> <i>(${escapeHtml(sub)})</i>`, '', ...lines].join('\n');
}
