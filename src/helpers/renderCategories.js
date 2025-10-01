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
// ОСТАВЬ renderVehicleHeader и renderUnitsList как есть.
// ЗАМЕНИ только эту функцию ↓↓↓

export function renderCategoriesList(categoriesRoot, page = 0, perPage = 40) {
  // Поддерживаем оба формата:
  // 1) data: [{ root: [ {id,name,children?}, ... ] }]
  // 2) data: [ {id,name,children?}, ... ]   (иногда сервис сразу отдаёт корень)

  // Достаём массив верхнего уровня
  let root =
    Array.isArray(categoriesRoot?.[0]?.root) ? categoriesRoot[0].root
  : Array.isArray(categoriesRoot?.root)       ? categoriesRoot.root
  : Array.isArray(categoriesRoot)             ? categoriesRoot
  : [];

  // Если неожиданная обёртка
  if (!Array.isArray(root) && categoriesRoot?.data) {
    const d = categoriesRoot.data;
    root =
      Array.isArray(d?.[0]?.root) ? d[0].root
    : Array.isArray(d?.root)      ? d.root
    : Array.isArray(d)            ? d
    : [];
  }

  // Фолбэк: если вообще пусто — текст без клавиатуры
  if (!Array.isArray(root) || root.length === 0) {
    return {
      text: '🗂️ <b>Категории</b>\nКатегории не найдены.',
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
  }

  // Нормализуем элементы (на всякий)
  const items = root
    .map(x => ({
      id: x?.id ?? x?.categoryId ?? x?.code ?? '',
      name: String(x?.name ?? x?.title ?? 'Без названия'),
    }))
    .filter(x => String(x.id).length > 0);

  // Пагинация (Telegram иногда ругается на ОГРОМНЫЕ клавиатуры → режем)
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const cur = Math.min(Math.max(0, page), pages - 1);
  const start = cur * perPage;
  const end = Math.min(total, start + perPage);
  const slice = items.slice(start, end);

  // Кнопки по 2 в ряд
  const rowCap = 2;
  const rows = [];
  for (let i = 0; i < slice.length; i += rowCap) {
    rows.push(
      slice.slice(i, i + rowCap).map(it => ({
        text: truncate(it.name, 48),
        callback_data: `cat:${it.id}`,
      }))
    );
  }

  // Низ клавиатуры — пагинация (если нужна)
  if (pages > 1) {
    const nav = [];
    if (cur > 0) nav.push({ text: '« Назад', callback_data: `noop:page:${cur - 1}` });
    nav.push({ text: `Стр. ${cur + 1}/${pages}`, callback_data: 'noop:page:stay' });
    if (cur < pages - 1) nav.push({ text: 'Вперёд »', callback_data: `noop:page:${cur + 1}` });
    rows.push(nav);
  }

  return {
    text: '🗂️ <b>Категории</b>\nВыберите раздел:',
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: rows },
  };
}

function truncate(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
