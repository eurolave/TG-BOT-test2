import { Markup } from 'telegraf';

export function mainMenu() {
  return Markup.keyboard([
    ['🔎 Подбор по VIN', '🧩 Поиск по OEM'],
    ['🤖 Вопрос к GPT', '🛒 Корзина'],
    ['ℹ️ Помощь', '⬅️ В меню']
  ]).resize();
}
export function backMenu() {
  return Markup.keyboard([['⬅️ В меню']]).resize();
}
