import 'dotenv/config';
import express from 'express';
import { Telegraf } from 'telegraf';
import OpenAI from 'openai';
import { handleUserText, handleCallback, startFlow } from './core/orchestrator.js';
import { mainMenu, backMenu } from './bot/keyboards.js';

const app = express();
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

bot.command('menu', (ctx) => ctx.reply('Главное меню:', mainMenu()));
bot.command('vin', startFlow('vin_flow'));
bot.command('oem', startFlow('oem_flow'));
bot.command('help', (ctx) => ctx.reply('Подбор по VIN/OEM + GPT-ответы.', backMenu()));
bot.command('model', async (ctx) => {
  try {
    const test = await client.responses.create({ model: MODEL, input: 'pong' });
    await ctx.reply(`Using: ${MODEL}\nAPI responded with model: ${test.model || '(n/a)'}`);
  } catch (e) {
    await ctx.reply('Model check error: ' + (e?.message || e));
  }
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

app.use(express.json());

app.get('/health', (_req, res) => res.send('OK'));
const secret = process.env.WEBHOOK_SECRET || 'tg';
const path = `/tg/${secret}`;
app.use(path, bot.webhookCallback(path));

const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', async () => {
  const base = process.env.WEBHOOK_URL || `http://localhost:${port}`;
  const url = `${base}${path}`;
  await bot.telegram.setWebhook(url);
  console.log('✅ Webhook set:', url, 'model=', MODEL);
});
