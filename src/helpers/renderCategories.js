// src/helpers/renderCategories.js

/* ───────────────── Vehicle header (без тех.инфы) ───────────────── */

export function renderVehicleHeader(vehicle = {}) {
  const { brand = '', name = '', attributes = {} } = vehicle || {};
  const A = (k) => attributes?.[k]?.value || '';
  const H = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const line = (label, value, emoji = '') => {
    if (!value) return '';
    return `${emoji ? emoji + ' ' : ''}<b>${H(label)}:</b> ${H(value)}\n`;
  };

  const title = (brand || name)
    ? `🚗 <b>${H(brand)} ${H(name)}</b>`
    : '🚗 <b>Автомобиль</b>';

  const info =
    line('Рынок', A('market'), '🌍') +
    line('Период производства', A('prodrange'), '📅') +
    line('Дата выпуска', A('date'), '📆') +
    line('Выпущено', A('manufactured'), '🏷️') +
    line(
      'Двигатель',
      [A('engine_info') || '', A('engine') ? `(${A('engine')})` : ''].filter(Boolean).join(' '),
      '🛠️'
    ) +
    line('№ двигателя', A('engineno'), '🔢') +
    line('КПП', A('transmission'), '⚙️') +
    line('Цвет кузова', A('framecolor'), '🎨') +
    line('Цвет салона', A('trimcolor'), '🧵');

  return [title, info ? '\n' + info.trim() : ''].filter(Boolean).join('\n').trim();
}

/* ───────────────── Categories list (как пришли от API) ─────────────────
   Поддерживает форматы:
   1) data: [{ root: [ {id,name,...}, ... ] }]
   2) data: [ {id,name,...}, ... ]
   3) { root: [...] }
   4) [ ... ]
   Порядок элементов сохраняем как в исходном ответе.
*/

export function renderCategoriesList(categoriesRoot, page = 0, perPage = 40) {
  const root = extractRoot(categoriesRoot);

  const items = (Array.isArray(root) ? root : [])
    .map((x) => {
      const canonicalId = x?.categoryId ?? x?.CategoryId ?? x?.categoryID ?? null;
      const fallbackId = x?.id ?? x?.code ?? null;
      const resolvedId = canonicalId ?? fallbackId ?? '';

      return {
        id: resolvedId,
        canonicalId,
        name: String(x?.name ?? x?.title ?? 'Без названия'),
      };
    })
    .filter(x => String(x.id).length > 0);

  if (!items.length) {
    return {
      text: '🗂️ <b>Категории</b>\nКатегории не найдены.',
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
  }

  // Пагинация (если категорий очень много)
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const cur   = Math.min(Math.max(0, page), pages - 1);
  const start = cur * perPage;
  const end   = Math.min(total, start + perPage);
  const slice = items.slice(start, end);

  // Кнопки по 2 в ряд
  const rows = [];
  for (let i = 0; i < slice.length; i += 2) {
    rows.push(
      slice.slice(i, i + 2).map(it => ({
        text: truncate(it.name, 48),
        callback_data: `cat:${it.canonicalId ?? it.id}`,
      }))
    );
  }

  // Навигация по страницам
  if (pages > 1) {
    const nav = [];
    if (cur > 0) nav.push({ text: '« Назад',   callback_data: `noop:page:${cur - 1}` });
    nav.push({       text: `Стр. ${cur + 1}/${pages}`, callback_data: 'noop:page:stay' });
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

/* ───────────────── Units list ───────────────── */

export function renderUnitsList(units = []) {
  const buttons = units.map(u => {
    const text = truncate(u?.name || 'Без названия', 48);
    const id   = String(u?.unitId ?? '');
    return { text, callback_data: id ? `unit:${id}` : 'noop:unit' };
  });

  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }

  return {
    text: '🔧 <b>Узлы</b>\nВыберите узел для деталей/схем:',
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: rows.length ? rows : [[{ text: 'Назад', callback_data: 'noop:back' }]] },
  };
}

/* ───────────────── helpers ───────────────── */

export function extractRoot(categoriesRoot) {
  if (Array.isArray(categoriesRoot?.[0]?.root)) return categoriesRoot[0].root;
  if (Array.isArray(categoriesRoot?.root))      return categoriesRoot.root;
  if (Array.isArray(categoriesRoot))            return categoriesRoot;

  const d = categoriesRoot?.data;
  if (Array.isArray(d?.[0]?.root)) return d[0].root;
  if (Array.isArray(d?.root))      return d.root;
  if (Array.isArray(d))            return d;

  return [];
}

function truncate(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
