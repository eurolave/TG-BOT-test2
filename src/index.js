import 'dotenv/config';
import minimist from 'minimist';
import { createServer } from 'http';
import Bot from './telegram.js';
import { ensure } from './utils.js';

const argv = minimist(process.argv.slice(2));
const useWebhook = !!argv.webhook;

const token = ensure(process.env.TELEGRAM_TOKEN, 'TELEGRAM_TOKEN is required');
const bot = new Bot(token);

await bot.setMenuCommands(); // меню команд

if (useWebhook) {
  const port = Number(process.env.PORT || 3000);
  const publicUrl = ensure(process.env.WEBHOOK_PUBLIC_URL, 'WEBHOOK_PUBLIC_URL is required for webhook');

  await bot.setWebhook(`${publicUrl}/bot-webhook`);

  createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/bot-webhook') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try { bot.processUpdate(JSON.parse(body)); res.writeHead(200).end('OK'); }
        catch (e) { console.error(e); res.writeHead(500).end('ERR'); }
      });
      return;
    }
    res.writeHead(200).end('OK');
  }).listen(port, () => console.log(`[bot] webhook listening :${port}`));

  console.log(`[bot] webhook mode at ${publicUrl}/bot-webhook`);
} else {
  await bot.startPolling();
  console.log('[bot] long polling started');
}
