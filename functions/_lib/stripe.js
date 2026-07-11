/**
 * functions/_lib/stripe.js
 *
 * Helpers para Stripe (pago único, sin suscripciones).
 * - Configuración de planes (Pro y Business).
 * - Creación de Checkout Sessions vía Stripe REST API.
 * - Verificación de firma HMAC-SHA256 de webhooks con Web Crypto
 *   (Cloudflare Workers no tiene Node's crypto.createHmac).
 *
 * Env vars requeridas:
 *   STRIPE_SECRET_KEY       — sk_live_... o sk_test_...
 *   STRIPE_WEBHOOK_SECRET   — whsec_... (del panel de Stripe → Webhooks)
 *   PUBLIC_URL              — https://nubifly.com (para redirects de checkout)
 */

// ── Catálogo de planes ─────────────────────────────────────────────────────
// Precios en centavos (USD). Ajusta valores/beneficios cuando quieras.
// IDs deben coincidir con data-plan="..." en index.html
export const PLANS = {
  gratis: {
    id: 'gratis',
    name: 'Gratis',
    priceCents: 0,
    limits: {
      maxApiKeys:      2,
      monthlyRequests: 1_000,
      maxFileSizeMB:   50,
      storageGB:       650
    }
  },
  basico: {
    id: 'basico',
    name: 'Básico',
    priceCents: 25000,    // $250.00 USD
    limits: {
      maxApiKeys:      10,
      monthlyRequests: 100_000,
      maxFileSizeMB:   500,
      storageGB:       1024        // 1 TB
    }
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceCents: 45000,    // $450.00 USD
    limits: {
      maxApiKeys:      50,
      monthlyRequests: 1_000_000,
      maxFileSizeMB:   2048,       // 2 GB
      storageGB:       2048        // 2 TB
    }
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    priceCents: 95000,    // $950.00 USD
    limits: {
      maxApiKeys:      500,
      monthlyRequests: 999_999_999,
      maxFileSizeMB:   10240,      // 10 GB
      storageGB:       3072        // 3 TB
    }
  }
};

export function getPlan(planId) {
  return PLANS[planId] || null;
}

// ── Stripe REST call (form-encoded, sin SDK) ───────────────────────────────
async function stripeReq(env, method, path, body) {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY no configurado');
  }
  const headers = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Stripe-Version': '2024-06-20'
  };
  let payload;
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(flattenForm(body)).toString();
  }
  const res  = await fetch(`https://api.stripe.com/v1${path}`, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.error?.code || `Stripe ${res.status}`;
    throw new Error(`Stripe API: ${msg}`);
  }
  return data;
}

// Stripe form-encoding: { foo: { bar: 'x' } } → foo[bar]=x
function flattenForm(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') Object.assign(out, flattenForm(item, `${key}[${i}]`));
        else out[`${key}[${i}]`] = String(item);
      });
    } else if (typeof v === 'object') {
      Object.assign(out, flattenForm(v, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

// ── Crear una Checkout Session de pago único ──────────────────────────────
// uid opcional: si viene, se guarda como client_reference_id.
// Si no viene (invitado sin login), Stripe pedirá el email en su checkout
// y el webhook activará el plan por email después del pago.
export async function createOneTimeCheckout(env, { uid = '', email = '', plan }) {
  const cfg = getPlan(plan);
  if (!cfg || cfg.id === 'gratis') throw new Error('Plan inválido para checkout.');

  const publicUrl = (env.PUBLIC_URL || '').replace(/\/$/, '') || 'https://nubifly.com';

  const params = {
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: cfg.priceCents,
        product_data: {
          name: `Nubifly ${cfg.name}`,
          description: `Upgrade permanente al plan ${cfg.name}. Sin renovaciones.`
        }
      }
    }],
    metadata: { uid: uid || '', plan: cfg.id },
    payment_intent_data: {
      metadata: { uid: uid || '', plan: cfg.id }
    },
    success_url: `${publicUrl}/pago-completado?plan=${cfg.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${publicUrl}/#precios`
  };
  if (uid)   params.client_reference_id = uid;
  if (email) params.customer_email      = email;

  return stripeReq(env, 'POST', '/checkout/sessions', params);
}

// ── Verificar firma HMAC-SHA256 de webhook (Web Crypto) ────────────────────
// Stripe firma con: HMAC-SHA256(secret, `${timestamp}.${payload}`)
// Header: Stripe-Signature: t=1492774577,v1=abc123...,v1=...
export async function verifyStripeSignature(rawBody, sigHeader, secret, toleranceSeconds = 300) {
  if (!sigHeader || !secret) return false;

  const parts = sigHeader.split(',').reduce((acc, p) => {
    const idx = p.indexOf('=');
    if (idx > 0) acc[p.slice(0, idx)] = p.slice(idx + 1);
    return acc;
  }, {});

  const timestamp = parseInt(parts.t, 10);
  const provided  = parts.v1;
  if (!timestamp || !provided) return false;

  // Tolerancia contra replay: rechazar timestamps muy viejos
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`)
  );
  const computed = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Comparación tiempo-constante
  if (computed.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}
