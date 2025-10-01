// file: server.js
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
const webhookSecret = process.env.WEBHOOK_SECRET || ''; // можно пустым

/**
 * ────────────────────────────── Bot ──────────────────────────────
 */
const bot = new Bot(token);
const masked = (t) => (t ? t.slice(0, 9) + '...' + t.slice(-4) : '(empty)');

(async () => {
  try { await bot.bot.stopPolling(); } catch {}

  try { await bot.setMenuCommands?.(); } catch (e) {
    console.warn('[bot] setMenuCommands warning:', e?.message || e);
  }

  const hookUrl = `${publicUrl.replace(/\/+$/, '')}/bot-webhook`;
  await bot.bot.setWebHook(hookUrl, {
    drop_pending_updates: true,
    ...(webhookSecret ? { secret_token: webhookSecret } : {}),
    // allowed_updates: ['message','callback_query']
  });
  console.log('[bot] webhook set to:', hookUrl);

  try {
    const me = await bot.bot.getMe();
    console.log('[bot] token OK →', masked(token), 'bot:', me.username);
  } catch (e) {
    console.error('[bot] INVALID TOKEN →', masked(token), e?.message || e);
    process.exit(1);
  }

  /**
   * ─────────────────────── HTTP сервер ───────────────────────
   */
  const server = createServer((req, res) => {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const { method } = req;
    const path = urlObj.pathname;

    let replied = false;
    const safeJSON = (code, obj, headers = {}) => {
      if (replied) return;
      replied = true;
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
      res.end(JSON.stringify(obj));
    };
    const safeText = (code, text, headers = {}) => {
      if (replied) return;
      replied = true;
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
      res.end(text);
    };

    // Health
    if (method === 'GET' && path === '/health') {
      return safeJSON(200, {
        ok: true,
        service: 'tg-bot',
        node: process.version,
        port,
        time: new Date().toISOString(),
      });
    }

    // Echo
    if (method === 'GET' && path === '/_echo') {
      return safeJSON(200, { ok: true, path, query: Object.fromEntries(urlObj.searchParams) });
    }

    // Creds (masked)
    if (method === 'GET' && path === '/_diag/creds') {
      const mask = (s) => (s ? (s.length <= 6 ? '*'.repeat(s.length) : s.slice(0, 2) + '***' + s.slice(-2)) : '');
      return safeJSON(200, {
        ok: true,
        TELEGRAM_TOKEN_len: (process.env.TELEGRAM_TOKEN || '').length,
        TELEGRAM_TOKEN_mask: mask(process.env.TELEGRAM_TOKEN || ''),
        WEBHOOK_PUBLIC_URL: (process.env.WEBHOOK_PUBLIC_URL || '').replace(/\/+$/, ''),
        WEBHOOK_SECRET_len: (process.env.WEBHOOK_SECRET || '').length,
      });
    }

    // Outbound check
    if (method === 'GET' && path === '/_diag/getme') {
      bot.bot.getMe()
        .then((me) => safeJSON(200, { ok: true, me }))
        .catch((e) => safeJSON(500, { ok: false, error: e?.message || String(e) }));
      return;
    }

    // TLS ping
    if (method === 'GET' && path === '/_diag/ping-host') {
      const host = urlObj.searchParams.get('host') || 'api.telegram.org';
      const t0 = Date.now();
      const socket = tls.connect({ host, port: 443, servername: host, timeout: 5000 }, () => {
        const ms = Date.now() - t0;
        socket.end();
        return safeJSON(200, { ok: true, host, tcp_443: true, latency_ms: ms });
      });
      socket.on('error', (e) => safeJSON(200, { ok: false, host, tcp_443: false, error: e.message }));
      socket.on('timeout', () => {
        socket.destroy();
        safeJSON(200, { ok: false, host, tcp_443: false, error: 'timeout' });
      });
      return;
    }

    // ──────────────── Webhook ────────────────
    if (method === 'POST' && path === '/bot-webhook') {
      // 1) Подписываемся на поток тела ДО ответа
      let body = '';
      let size = 0;
      const MAX = 1_000_000; // 1MB

      const onData = (chunk) => {
        size += chunk.length;
        if (size > MAX) {
          console.warn('[webhook] body too large, dropping');
          try { req.destroy(); } catch {}
        } else {
          body += chunk;
        }
      };

      const onEnd = () => {
        // 2) Отвечаем 200 сразу после чтения тела
        safeText(200, 'OK');

        try {
          // 3) Проверяем секрет (если задан)
          if (webhookSecret) {
            const got = req.headers['x-telegram-bot-api-secret-token'];
            if (got !== webhookSecret) {
              return console.warn('[webhook] invalid secret, ignoring update');
            }
          }

          // 4) Парсим и обрабатываем
          console.log('[webhook] update:', body.slice(0, 500));
          const update = JSON.parse(body);

          Promise.resolve(bot.processUpdate(update)).catch((e) => {
            console.error('[webhook] process error:', e?.message || e);
          });
        } catch (e) {
          console.error('[webhook] parse error:', e?.message || e, 'body=', body?.slice(0, 200));
        }
      };

      const onAborted = () => {
        console.warn('[webhook] request aborted by client');
        safeText(499, 'aborted'); // не стандарт, но для логики «уже ответили»
      };

      req.on('data', onData);
      req.on('end', onEnd);
      req.on('aborted', onAborted);
      return;
    }

    // Fallback
    return safeJSON(200, { ok: true, service: 'tg-bot' });
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

  bot.bot.on('polling_error', (e) => {
    console.warn('[polling_error while in webhook mode]', e?.message || e);
  });

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
