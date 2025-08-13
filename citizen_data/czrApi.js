import crypto from 'node:crypto';
import fetch from 'node-fetch';
import https from 'node:https';

const BASE   = process.env.CZR_BASE || 'https://comzer-gov.net';
const KEY    = process.env.CZR_KEY  || 'casbot';
const SECRET = process.env.CZR_SECRET;
const TIMEOUT_MS  = Number(process.env.CZR_FETCH_TIMEOUT_MS || 15000);
const MAX_RETRY   = Number(process.env.CZR_MAX_RETRY || 4);

// Keep-Alive agent（同一ホストにコネクションを使い回す）
const agent = new https.Agent({ keepAlive: true, maxSockets: 4, timeout: 30000 });

function sign(body) {
  const ts = Math.floor(Date.now() / 1000);
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const h = crypto.createHmac('sha256', SECRET);
  h.update(`${ts}\n${raw}`);
  const sig = h.digest('base64');
  return { ts, sig };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function backoff(attempt) { // 300ms, 600ms, 1200ms, 2400ms ... + jitter
  const base = 300 * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 200);
  return base + jitter;
}

function isRetryable(err, status) {
  if (err && (err.name === 'AbortError' || err.code === 'ECONNRESET' || err.code === 'EPIPE')) return true;
  if (!status) return true; // ネットワーク系
  return status >= 500 && status < 600; // 5xx は再試行
}

export async function upsertMember(payload) {
  const url  = `${BASE}/wp-json/czr-bridge/v1/ledger/member`;
  const body = JSON.stringify(payload);
  let method = 'PUT';

  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    const { ts, sig } = sign(body);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const headers = {
        'Content-Type': 'application/json',
        'X-CZR-Key': KEY,
        'X-CZR-Ts': String(ts),
        'X-CZR-Sign': sig,
      };
      if (method === 'POST') headers['X-HTTP-Method-Override'] = 'PUT';

      const res = await fetch(url, { method, headers, body, agent, signal: ctrl.signal });
      clearTimeout(t);

      if (res.ok) return res.json();
      const text = await res.text().catch(() => '');

      // 404はメソッド不一致の可能性があるので、1度だけPOSTに切替
      if (res.status === 404 && method === 'PUT') { method = 'POST'; continue; }
      // 401/403 は認証ミス等。即時エラー
      if (res.status === 401 || res.status === 403) throw new Error(`Auth ${res.status}: ${text}`);

      if (attempt === MAX_RETRY || !isRetryable(null, res.status)) {
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      await sleep(backoff(attempt));
    } catch (e) {
      clearTimeout(t);
      if (attempt === MAX_RETRY || !isRetryable(e, 0)) throw e;
      await sleep(backoff(attempt));
    }
  }
  throw new Error('retry_exhausted');
}
