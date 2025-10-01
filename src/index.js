// file: server.js (или index.js)
import 'dotenv/config';
import { createServer } from 'node:http';
import tls from 'node:tls';
import Bot from './telegram.js';
import { ensure } from './utils.js';

/**
 * ────────────────────────────── ENV ──────────────────────────────
 */
const token = ensure(process.env.TELEGRAM_TOKEN, 'TELEGRAM_TOKEN is required');
const publicUrl = ensure(process.env.WEBHOOK_PUBLIC_URL, 'WEBHOOK_PUBLIC_URL is required');
const port = Number(process.env.PORT);
if (!port) {
  console.error('[bot] ENV PORT is not set — Railway requires binding to PORT.');
  process.exit(1);
}
const webhookSecret = process.env.WEBHOOK_SECRET || 'change-me-long-random';

/**
 * ────────────────────────────── Bot ──────────────────────────────
 */
const bot = new Bot(token);
const masked = (t) => (t ? t.slice(0, 9) + '...' + t.slice(-4) : '(empty)');

(async () => {
  // На всякий случай — стопаем polling, если он вдруг включён где-то
  try { await bot.bot.stopPolling(); } catch {}

  // Команды меню, если реализовано в твоём классе
  try { await bot.setMenuCommands?.(); } catch (e) {
    console.warn('[bot] setMenuCommands warning:', e?.message || e);
  }

  // Ставим вебхук с секретом и сбрасываем старые апдейты
  const hookUrl = `${publicUrl.replace(/\/+$/, '')}/bot-webhook`;
  await bot.bot.setWebHook(hookUrl, {
    drop_pending_updates: true,
    secret_token: webhookSecret,
    // allowed_updates: ['message','callback_query'] // при желании сузить типы апдейтов
  });
  console.log('[bot] webhook set to:', hookUrl);

  // Проверка токена / исходящих запросов
  try {
    const me = await bot.bot.getMe();
    console.log('[bot] token OK →', masked(token), 'bot:', me.username);
  } catch (e) {
    console.error('[bot] INVALID TOKEN →', masked(token), e?.message || e);
    process.exit(1);
  }

  /**
   * ─────────────────────── HTTP сервер ───────────────────────
   * Диагностические ручки + точка вебхука
   */
  const server = createServer((req, res) => {
    const { method, url: rawUrl = '/' } = req;

    // Небольшой помощник для ответов
    const sendJSON = (code, obj, headers = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
      res.end(JSON.stringify(obj));
    };
    const sendText = (code, text, headers = {}) => {
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
      res.end(text);
    };

    // /health — жив ли процесс
    if (method === 'GET' && rawUrl === '/health') {
      return sendJSON(200, {
        ok: true,
        service: 'tg-bot',
        node: process.version,
        port,
        time: new Date().toISOString(),
      });
    }

    // /_echo — вернуть путь и query
    if (method === 'GET' && rawUrl.startsWith('/_echo')) {
      const u = new URL(rawUrl, 'http://localhost');
      return sendJSON(200, { ok: true, path: u.pathname, query: Object.fromEntries(u.searchParams) });
    }

    // /_diag/creds — маскированные креды и базовая проверка
    if (method === 'GET' && rawUrl === '/_diag/creds') {
      const mask = (s) => (s ? (s.length <= 6 ? '*'.repeat(s.length) : s.slice(0, 2) + '***' + s.slice(-2)) : '');
      return sendJSON(200, {
        ok: true,
        TELEGRAM_TOKEN_len: (process.env.TELEGRAM_TOKEN || '').length,
        TELEGRAM_TOKEN_mask: mask(process.env.TELEGRAM_TOKEN || ''),
        WEBHOOK_PUBLIC_URL: (process.env.WEBHOOK_PUBLIC_URL || '').replace(/\/+$/, ''),
        WEBHOOK_SECRET_len: (process.env.WEBHOOK_SECRET || '').length,
      });
    }

    // /_diag/getme — быстрый outward check к Telegram
    if (method === 'GET' && rawUrl === '/_diag/getme') {
      bot.bot.getMe()
        .then((me) => sendJSON(200, { ok: true, me }))
        .catch((e) => sendJSON(500, { ok: false, error: e?.message || String(e) }));
      return;
    }

    // /_diag/ping-host?host=api.telegram.org — TCP TLS-пинг к 443
    if (method === 'GET' && rawUrl.startsWith('/_diag/ping-host')) {
      const u = new URL(rawUrl, 'http://localhost');
      const host = u.searchParams.get('host') || 'api.telegram.org';
      const t0 = Date.now();
      const socket = tls.connect({ host, port: 443, servername: host, timeout: 5000 }, () => {
        const ms = Date.now() - t0;
        socket.end();
        return sendJSON(200, { ok: true, host, tcp_443: true, latency_ms: ms });
      });
      socket.on('error', (e) => sendJSON(200, { ok: false, host, tcp_443: false, error: e.message }));
      socket.on('timeout', () => {
        socket.destroy();
        sendJSON(200, { ok: false, host, tcp_443: false, error: 'timeout' });
      });
      return;
    }

    // ──────────────── Вебхук ────────────────
    if (method === 'POST' && rawUrl === '/bot-webhook') {
      // Сразу отвечаем 200, чтобы Telegram не ретраил, даже если обработка долгая
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('OK');

      // Читаем тело с лимитом
      let body = '';
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1_000_000) { // 1 MB guard
          console.warn('[webhook] body too large, dropped');
          try { req.destroy(); } catch {}
          return;
        }
        body += chunk;
      });
      req.on('end', () => {
        try {
          // Проверка секретного токена (если задан)
          const need = webhookSecret;
          const got = req.headers['x-telegram-bot-api-secret-token'];
          if (need && got !== need) {
            return console.warn('[webhook] invalid secret, ignoring update');
          }

          console.log('[webhook] update:', body.slice(0, 500));
          const update = JSON.parse(body);

          // Обработка асинхронно, чтобы не блокировать цикл
          Promise.resolve(bot.processUpdate(update)).catch((e) => {
            console.error('[webhook] process error:', e?.message || e);
          });
        } catch (e) {
          console.error('[webhook] parse error:', e?.message || e, 'body=', body?.slice(0, 200));
        }
      });

      return;
    }

    // Fallback: health/info
    return sendJSON(200, { ok: true, service: 'tg-bot' });
  });

  server.listen(port, () => {
    console.log(`[bot] webhook listening :${port}`);
    console.log('[bot] env →', {
      TELEGRAM_TOKEN: masked(token),
      WEBHOOK_PUBLIC_URL: publicUrl.replace(/\/+$/, ''),
      WEBHOOK_SECRET_len: webhookSecret?.length || 0,
      PORT: port,
    });
  });

  // На вебхуке polling не нужен — на всякий случай повесим логгер,
  // но запускать startPolling() НЕЛЬЗЯ.
  bot.bot.on('polling_error', (e) => {
    console.warn('[polling_error while in webhook mode]', e?.message || e);
  });

  // Корректное завершение
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, async () => {
      try { await bot.bot.stopPolling(); } catch {}
      process.exit(0);
    });
  }
})().catch((e) => {
  console.error('[bot] fatal start error:', e?.message || e);
  process.exit(1);
});
