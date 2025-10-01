// helpers/renderCategories.js

/**
 * Формат "красивой шапки" по данным из /vin
 * Ожидает структуру vehicle уровня:
 * {
 *   brand: 'AUDI',
 *   name: 'Q7',
 *   catalog: 'AU1587',
 *   vehicleId: '0',
 *   ssd: '...'
 *   attributes: {
 *     date: { name: 'Дата выпуска', value: '16.08.2017' },
 *     manufactured: { name: 'Выпущено', value: '2018' },
 *     prodrange: { name: 'Период производства', value: '2016 - 2026' },
 *     market: { name: 'Рынок', value: 'Европа' },
 *     engine: { name: 'Двигатель', value: 'CVMD' },
 *     engine_info: { name: 'Двигатель', value: '3000CC / 249hp / 183kW TDI CR' },
 *     engineno: { name: 'Номер двигателя', value: '16658' },
 *     transmission: { name: 'КПП', value: 'SUQ(8A)' },
 *     framecolor: { name: 'Цвет кузова', value: '2T2T' },
 *     trimcolor: { name: 'Цвет салона', value: 'FZ' }
 *   }
 * }
 */

export function renderVehicleHeader(vehicle = {}) {
  const { brand = '', name = '', catalog = '', vehicleId = '', ssd = '', attributes = {} } = vehicle || {};
  const A = (k) => attributes?.[k]?.value || '';
  const H = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const line = (label, value, emoji = '') => {
    if (!value) return '';
    return `${emoji ? emoji + ' ' : ''}<b>${H(label)}:</b> ${H(value)}\n`;
  };

  const title = [
    brand || name ? `🚗 <b>${H(brand || '')} ${H(name || '')}</b>` : '🚗 <b>Автомобиль</b>',
    catalog ? ` · <code>${H(catalog)}</code>` : '',
  ].join('');

  const info =
    line('Рынок', A('market'), '🌍') +
    line('Период производства', A('prodrange'), '📅') +
    line('Дата выпуска', A('date'), '📆') +
    line('Выпущено', A('manufactured'), '🏷️') +
    line('Двигатель', [A('engine_info') || '', A('engine') ? `(${A('engine')})` : ''].filter(Boolean).join(' '), '🛠️') +
    line('№ двигателя', A('engineno'), '🔢') +
    line('КПП', A('transmission'), '⚙️') +
    line('Цвет кузова', A('framecolor'), '🎨') +
    line('Цвет салона', A('trimcolor'), '🧵');

  // Техконтекст — полезно при отладке, но не мешаем пользователю
  const tech = [
    vehicleId ? `• vehicleId: <code>${H(vehicleId)}</code>` : '',
    catalog ? `• catalog: <code>${H(catalog)}</code>` : '',
    ssd ? `• ssd: <code>${H(ssd.slice(0, 16))}…</code>` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    title,
    info ? '\n' + info.trim() : '',
    tech ? '\n<code>' + tech + '</code>' : '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Рендер списка корневых категорий (инлайн-кнопки).
 * Ожидает формат, который ты отдаёшь из /categories:
 * data: [{ root: [ { id, name, children? }, ... ] }]
 */
export function renderCategoriesList(categoriesRoot) {
  const root = Array.isArray(categoriesRoot?.[0]?.root) ? categoriesRoot[0].root : [];
  const buttons = [];

  for (const cat of root) {
    const text = truncate(cat?.name || 'Без названия', 48);
    const id = String(cat?.id ?? '');
    if (!id) continue;
    buttons.push([{ text, callback_data: `cat:${id}` }]);
  }

  // группируем по 2 в ряд (если хочется по 3 — поменяй chunkSize)
  const chunkSize = 2;
  const rows = [];
  for (let i = 0; i < buttons.length; i += chunkSize) {
    const row = buttons.slice(i, i + chunkSize).map(([btn]) => btn);
    rows.push(row);
  }

  return {
    text: '🗂️ <b>Категории</b>\nВыберите раздел:',
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: rows.length ? rows : [[{ text: 'Обновить', callback_data: 'noop:refresh' }]] },
  };
}

/**
 * Рендер списка узлов в выбранной категории
 * Ожидает массив units: [ { unitId, name, ... }, ... ]
 */
export function renderUnitsList(units = []) {
  const rows = [];
  const buttons = units.map((u) => {
    const text = truncate(u?.name || 'Без названия', 48);
    const id = String(u?.unitId ?? '');
    // Если нет unitId — делаем noop кнопку, чтобы пользователь видел элемент
    const cb = id ? `unit:${id}` : 'noop:unit';
    return { text, callback_data: cb };
  });

  // по 2 в ряд
  const chunkSize = 2;
  for (let i = 0; i < buttons.length; i += chunkSize) {
    rows.push(buttons.slice(i, i + chunkSize));
  }

  return {
    text: '🔧 <b>Узлы</b>\nВыберите узел для деталей/схем:',
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: rows.length ? rows : [[{ text: 'Назад', callback_data: 'noop:back' }]] },
  };
}

/* ───────────────────────── helpers ───────────────────────── */
function truncate(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
