import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stripe-style signature scheme: `t=<unix-seconds>,v1=<hex-hmac-sha256>`.
 * The HMAC is computed over `<t>.<payload>` so timestamp and body bind together.
 * The default 5-minute tolerance window matches Stripe's recommendation.
 */
const SIGNATURE_TOLERANCE_SECONDS = 300;

function toPayloadString(payload: string | Uint8Array): string {
  return typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
}

function hmacHex(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

export function signMockWebhook(
  payload: string | Uint8Array,
  secret: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): string {
  const body = toPayloadString(payload);
  const sig = hmacHex(secret, `${timestampSeconds}.${body}`);
  return `t=${timestampSeconds},v1=${sig}`;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  timestampSeconds?: number;
}

export function verifyMockWebhook(
  payload: string | Uint8Array,
  signature: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifyResult {
  const parts = signature.split(',');
  let t: number | undefined;
  let v1: string | undefined;
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1);
    if (k === 't') t = Number(v);
    else if (k === 'v1') v1 = v;
  }
  if (t === undefined || !Number.isFinite(t)) {
    return { ok: false, reason: 'missing or invalid timestamp' };
  }
  if (!v1) {
    return { ok: false, reason: 'missing v1 signature' };
  }
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp outside tolerance window', timestampSeconds: t };
  }
  const body = toPayloadString(payload);
  const expected = hmacHex(secret, `${t}.${body}`);
  if (expected.length !== v1.length) {
    return { ok: false, reason: 'signature length mismatch', timestampSeconds: t };
  }
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature mismatch', timestampSeconds: t };
  }
  return { ok: true, timestampSeconds: t };
}
