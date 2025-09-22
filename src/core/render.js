import { Markup } from 'telegraf';

export async function renderByName(name, ctx, session) {
  switch (name) {
    case 'assembliesList': return assembliesList(ctx, session);
    case 'partsPaged': return partsPaged(ctx, session);
    case 'crossesList': return crossesList(ctx, session);
    case 'partCardWithButtons': return partCardWithButtons(ctx, session);
    case 'cartConfirm': return cartConfirm(ctx, session);
    default: return ctx.reply('Неизвестный рендер: ' + name);
  }
}

async function assembliesList(ctx, session) {
  const payload = session.data.getAssembliesByVIN || session.data.searchByVIN || {};
  const { assemblies = [], vehicle } = payload;
  if (vehicle?.brand || vehicle?.name) {
    await ctx.reply(`Найдено: ${vehicle?.brand || ''} ${vehicle?.name || ''}`.trim());
  }
  if (!assemblies.length) return ctx.reply('Узлы не найдены по этому VIN.');

  const buttons = assemblies.slice(0, 24).map(a => Markup.button.callback(a.name || `Узел ${a.id}`, `asm:${a.id}`));
  await ctx.reply('Выберите узел:', Markup.inlineKeyboard(chunk(buttons, 2)));
}

async function partsPaged(ctx, session) {
  const payload = session.data.getPartsByAssembly || session.data.partsByAssembly || {};
  const { items = [] } = payload;
  if (!items.length) return ctx.reply('Детали не найдены для выбранного узла.');

  const lines = items.slice(0, 10).map((p, i) => `${i + 1}. ${p.oem} — ${p.brand ? p.brand + ' • ' : ''}${p.name || ''}`).join('\n');
  const rows = items.slice(0, 10).map(p => ([
    Markup.button.callback('🔁 Аналоги', `x:${p.oem}`),
    Markup.button.callback('🛒 В корзину', `cart:${p.oem}`)
  ]));
  await ctx.reply(lines, Markup.inlineKeyboard(rows));
}

async function crossesList(ctx, session) {
  const payload = session.data.getCrossesByOEM || session.data.crossesByOEM || {};
  const { crosses = [] } = payload;
  if (!crosses.length) return ctx.reply('Аналоги не найдены.');

  const lines = crosses.slice(0, 20).map((c, i) => `${i + 1}. ${c.brand ? c.brand + ' ' : ''}${c.oem}${c.name ? ' — ' + c.name : ''}`).join('\n');
  await ctx.reply(lines);
}

async function partCardWithButtons(ctx, session) {
  const p = session.data.getPartByOEM || session.data.partByOEM;
  if (!p) return ctx.reply('Ничего не нашлось по этому номеру.');

  const text = [`OEM: ${p.oem || '—'}`, `Бренд: ${p.brand || '—'}`, `Название: ${p.name || '—'}`].join('\n');
  await ctx.reply(text, Markup.inlineKeyboard([
    [Markup.button.callback('🔁 Аналоги', 'analogs')],
    [Markup.button.callback('🛒 В корзину', `cart:${p.oem || ''}`)]
  ]));
}

async function cartConfirm(ctx, session) {
  const last = session.lastCallback || '';
  const oem = last.startsWith('cart:') ? last.slice(5) : '—';
  await ctx.reply(`Добавил в корзину: ${oem}`);
}

function chunk(arr, n) { const out = []; for (let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out; }
