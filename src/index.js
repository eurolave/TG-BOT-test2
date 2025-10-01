import 'dotenv/config';
import minimist from 'minimist';
import { createServer } from 'http';
import Bot from './telegram.js';
import { ensure } from './utils.js';

const argv = minimist(process.argv.slice(2));
const token = ensure(process.env.TELEGRAM_TOKEN, 'TELEGRAM_TOKEN is required');
const publicUrl = process.env.WEBHOOK_PUBLIC_URL || ''; // если есть — работаем в вебхуке
const port = Number(process.env.PORT || 3000);

const bot = new Bot(token);

(async () => {
  await bot.setMenuCommands();

  // Fail-safe: сначала снимаем «противоположный» режим
  if (publicUrl) {
    // Мы хотим webhook → снимаем polling (если был)
    try { await bot.bot.stopPolling(); } catch {}
    // Ставим webhook
    const hookUrl = `${publicUrl.replace(/\/+$/,'')}/bot-webhook`;
    await bot.bot.setWebHook(hookUrl, { drop_pending_updates: true });
    console.log('[bot] webhook set to:', hookUrl);

    // Простой HTTP-сервер для приёма апдейтов
    createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/bot-webhook') {
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
          try {
            bot.processUpdate(JSON.parse(body));
            res.writeHead(200).end('OK');
          } catch (e) {
            console.error('[webhook] parse error', e);
            res.writeHead(500).end('ERR');
          }
        });
        return;
      }
      res.writeHead(200).end('OK');
    }).listen(port, () => console.log(`[bot] webhook listening :${port}`));
  } else {
    // Мы хотим polling → снимаем webhook
    try {
      await bot.bot.deleteWebHook({ drop_pending_updates: true });
      console.log('[bot] webhook deleted');
    } catch (e) {
      console.warn('[bot] deleteWebHook warn:', e?.message || e);
    }
    await bot.startPolling();
    console.log('[bot] long polling started');
  }
})().catch(err => {
  console.error('[bot] fatal start error:', err);
  process.exit(1);
});
