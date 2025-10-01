import 'dotenv/config';
import { createServer } from 'http';
import Bot from './telegram.js';
import { ensure } from './utils.js';

const token = ensure(process.env.TELEGRAM_TOKEN, 'TELEGRAM_TOKEN is required');
const publicUrl = ensure(process.env.WEBHOOK_PUBLIC_URL, 'WEBHOOK_PUBLIC_URL is required');
const port = Number(process.env.PORT || 3000);
const bot = new Bot(token);

(async () => {
  await bot.setMenuCommands();
  // стопаем polling на всякий
  try { await bot.bot.stopPolling(); } catch {}
  const hookUrl = `${publicUrl.replace(/\/+$/,'')}/bot-webhook`;
  await bot.bot.setWebHook(hookUrl, { drop_pending_updates: true });
  console.log('[bot] webhook set to:', hookUrl);

  createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/bot-webhook') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try { bot.processUpdate(JSON.parse(body)); res.writeHead(200).end('OK'); }
        catch (e) { console.error('[webhook] parse error', e); res.writeHead(500).end('ERR'); }
      });
      return;
    }
    res.writeHead(200).end('OK');
  }).listen(port, () => console.log(`[bot] webhook listening :${port}`));
})();
