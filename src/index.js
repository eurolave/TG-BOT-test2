import 'dotenv/config';
import { Telegraf } from 'telegraf';
import OpenAI from 'openai';
import { handleUserText, handleCallback, startFlow } from './core/orchestrator.js';
import { mainMenu, backMenu } from './bot/keyboards.js';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';

async function askGpt(input) {
  const r = await client.responses.create({
    model: MODEL,
    instructions: "You are GPT-5. If asked what model you are, answer exactly: 'GPT-5 Thinking'. Be concise and helpful.",
    input
  });
  return r.output_text || '';
}

console.log('[ENV] LAXIMO_BASE_URL =', process.env.LAXIMO_BASE_URL || '(empty)');

bot.start(async (ctx) => ctx.reply('Привет! Выберите, что нужно:', mainMenu()));
bot.command('menu', (ctx) => ctx.reply('Главное меню:', mainMenu()));
bot.command('help', (ctx) => ctx.reply('Подбор по VIN/OEM + GPT-ответы.', backMenu()));
bot.command('vin', startFlow('vin_flow'));
bot.command('oem', startFlow('oem_flow'));
bot.command('model', async (ctx) => {
  try {
    const test = await client.responses.create({ model: MODEL, input: 'pong' });
    await ctx.reply(`Using: ${MODEL}\nAPI responded with model: ${test.model || '(n/a)'}`);
  } catch (e) {
    await ctx.reply('Model check error: ' + (e?.message || e));
  }
});
bot.command('env', (ctx) => {
  const keys = [
    'LAXIMO_BASE_URL','LAXIMO_PATH_FINDVEHICLE','LAXIMO_PATH_LIST_UNITS','LAXIMO_PATH_LIST_PARTS',
    'LAXIMO_DEFAULT_CATEGORY','LAXIMO_DEFAULT_GROUP','OPENAI_MODEL'
  ];
  const lines = keys.map(k => `${k}=${process.env[k] || '(empty)'}`).join('\n');
  return ctx.reply('ENV:\n' + lines);
});

bot.hears('🔎 Подбор по VIN', startFlow('vin_flow'));
bot.hears('🧩 Поиск по OEM', startFlow('oem_flow'));
bot.hears('🤖 Вопрос к GPT', (ctx) => ctx.reply('Напишите вопрос для GPT:', backMenu()));
bot.hears('🛒 Корзина', (ctx) => ctx.reply('Корзина пока в разработке.'));
bot.hears('ℹ️ Помощь', (ctx) => ctx.reply('Отправьте VIN (17 символов) или OEM артикул.'));
bot.hears('⬅️ В меню', (ctx) => ctx.reply('Главное меню:', mainMenu()));

bot.on('callback_query', handleCallback);

bot.on('text', async (ctx) => {
  const handled = await handleUserText(ctx);
  if (handled) return;
  try {
    const answer = await askGpt(`Отвечай кратко и по делу. Вопрос: ${ctx.message.text}`);
    await ctx.reply(answer.slice(0, 4000), mainMenu());
  } catch (e) {
    console.error(e);
    await ctx.reply('Временная ошибка GPT. Попробуйте ещё раз.', backMenu());
  }
});

bot.launch();
console.log('✅ Bot started (long-polling), model=', MODEL);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
