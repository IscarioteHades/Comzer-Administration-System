import crypto from 'node:crypto';
import fetch from 'node-fetch';

const BASE   = process.env.CZR_BASE || 'https://comzer-gov.net';
const KEY    = process.env.CZR_KEY  || 'casbot';
const SECRET = process.env.CZR_SECRET; // ← WP側のComzer API Bridgeで生成したSecret

function sign(body) {
  const ts = Math.floor(Date.now() / 1000);
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const h = crypto.createHmac('sha256', SECRET);
  h.update(`${ts}\n${raw}`);
  const sig = h.digest('base64');
  return { ts, sig };
}

export async function upsertMember(payload) {
  const body = JSON.stringify(payload);
  const { ts, sig } = sign(body);
  const res = await fetch(`${BASE}/wp-json/czr-bridge/v1/ledger/member`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-CZR-Key': KEY,
      'X-CZR-Ts': String(ts),
      'X-CZR-Sign': sig,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(()=>'');
    throw new Error(`Upsert failed ${res.status}: ${text}`);
  }
  return res.json();
}
