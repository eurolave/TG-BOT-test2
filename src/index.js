import 'dotenv/config';
import { createServer } from 'http';
import Bot from './telegram.js';
import { ensure } from './utils.js';

const token = ensure(process.env.TELEGRAM_TOKEN, 'TELEGRAM_TOKEN is required');
const publicUrl = ensure(process.env.WEBHOOK_PUBLIC_URL, 'WEBHOOK_PUBLIC_URL is required');
const port = Number(process.env.PORT || 3000);

const bot = new Bot(token);

const masked = t => t ? t.slice(0, 9) + '...' + t.slice(-4) : '(empty)';

(async () => {
  // На всякий случай — стопаем polling, если он вдруг включён где-то
  try { await bot.bot.stopPolling(); } catch {}

  await bot.setMenuCommands();

  const hookUrl = `${publicUrl.replace(/\/+$/, '')}/bot-webhook`;
  // Сбрасываем возможные старые апдейты и ставим один webhook
  await bot.bot.setWebHook(hookUrl, { drop_pending_updates: true });
  console.log('[bot] webhook set to:', hookUrl);

  // Небольшая проверка токена (не обязательно)
  try {
    const me = await bot.bot.getMe();
    console.log('[bot] token OK →', masked(token), 'bot:', me.username);
  } catch (e) {
    console.error('[bot] INVALID TOKEN →', masked(token), e?.message || e);
    process.exit(1);
  }

  // HTTP сервер — точка приёма апдейтов
  createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/bot-webhook') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try {
          bot.processUpdate(JSON.parse(body));
          res.writeHead(200).end('OK');
        } catch (err) {
          console.error('[webhook] parse error', err);
          res.writeHead(500).end('ERR');
        }
      });
      return;
    }
    res.writeHead(200).end('OK');
  }).listen(port, () => console.log(`[bot] webhook listening :${port}`));

  // На вебхуке polling не нужен — на всякий случай повесим логгер,
  // но запускать startPolling() НЕЛЬЗЯ.
  bot.bot.on('polling_error', (e) => {
    console.warn('[polling_error while in webhook mode]', e?.message || e);
  });

  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, async () => { try { await bot.bot.stopPolling(); } catch {} process.exit(0); });
  }
})();
