// src/helpers/renderCategories.js

export function renderVehicleHeader(vehicle) {
  const name = vehicle?.name || 'Автомобиль';
  const brand = vehicle?.brand || '';
  const attrs = vehicle?.attributes || {};
  const date = attrs.date?.value || '';
  const engine = attrs.engine?.value || '';
  const engineInfo = attrs.engine_info?.value || '';
  const transmission = attrs.transmission?.value || '';

  return [
    `<b>${escapeHtml(name)} — ${escapeHtml(brand)}</b>`,
    date ? `Дата выпуска: <b>${escapeHtml(date)}</b>` : null,
    engine || engineInfo
      ? `Двигатель: <b>${escapeHtml(engine)}</b>${engineInfo ? ` (${escapeHtml(engineInfo)})` : ''}`
      : null,
    transmission ? `КПП: <b>${escapeHtml(transmission)}</b>` : null,
  ].filter(Boolean).join('\n');
}

export function renderCategoriesList(categoriesRoot) {
  const root = Array.isArray(categoriesRoot?.[0]?.root) ? categoriesRoot[0].root : [];
  const lines = ['\n<b>Категории:</b>'];
  const buttons = [];

  const icon = (name) => {
    const n = (name || '').toLowerCase();
    if (n.includes('двигател')) return '🔧';
    if (n.includes('коробк')) return '🔁';
    if (n.includes('тормоз') || n.includes('колёс') || n.includes('колес')) return '🛑';
    if (n.includes('электро')) return '🔌';
    if (n.includes('ось')) return '🛞';
    if (n.includes('кузов')) return '🚪';
    if (n.includes('педал') || n.includes('переключ')) return '🎛️';
    if (n.includes('питани') || n.includes('охлажден') || n.includes('выпуск')) return '⚙️';
    return '📦';
  };

  root.forEach((cat, idx) => {
    const title = `${idx + 1}) ${icon(cat.name)} ${cat.name}`;
    lines.push(escapeHtml(title));
    buttons.push({ text: `${idx + 1}`, callback_data: `cat:${cat.categoryId}` });
  });

  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 5) {
    keyboard.push(buttons.slice(i, i + 5));
  }

  return {
    text: lines.join('\n'),
    reply_markup: { inline_keyboard: keyboard },
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
}

export function renderUnitsList(units) {
  // units — массив узлов (после /units)
  const list = Array.isArray(units) ? units : [];
  const lines = ['<b>Узлы:</b>'];
  const buttons = [];

  list.forEach((u, idx) => {
    const name = u.name || `Узел ${idx + 1}`;
    const unitId = u.unitId || u.id || u.code || String(idx + 1);
    lines.push(`${idx + 1}) ${escapeHtml(name)}`);
    // Если планируешь проваливаться в детали, добавь callback_data: `unit:${unitId}`
    // пока просто выводим список, без перехода
    buttons.push({ text: `${idx + 1}`, callback_data: `noop:${unitId}` });
  });

  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 4) {
    keyboard.push(buttons.slice(i, i + 4));
  }

  return {
    text: lines.join('\n'),
    reply_markup: { inline_keyboard: keyboard },
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
