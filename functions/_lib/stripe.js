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
// Monedas soportadas. 'usd' = dólares, 'mxn' = pesos mexicanos.
export const SUPPORTED_CURRENCIES = ['usd', 'mxn'];

// Precios en la unidad mínima de cada moneda (centavos USD / centavos MXN).
//   usd: 25000  = $250.00 USD
//   mxn: 499900 = $4,999.00 MXN
// ⚠️ Los montos en MXN son un punto de partida — AJÚSTALOS al precio real
//    que quieras cobrar en pesos (no es una conversión automática).
// IDs deben coincidir con data-plan="..." en index.html
export const PLANS = {
  gratis: {
    id: 'gratis',
    name: 'Gratis',
    prices: { usd: 0, mxn: 0 },
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
    prices:       { usd: 25000, mxn: 499900 },   // $250 USD  ·  $4,999 MXN
    launchPrices: { usd: 3800,  mxn: 74900  },   // 85% OFF → $38 USD · $749 MXN
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
    prices:       { usd: 45000, mxn: 899900  },  // $450 USD  ·  $8,999 MXN
    launchPrices: { usd: 6800,  mxn: 134900  },  // 85% OFF → $68 USD · $1,349 MXN
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
    prices:       { usd: 95000, mxn: 1899900 },  // $950 USD  ·  $18,999 MXN
    launchPrices: { usd: 14300, mxn: 284900  },  // 85% OFF → $143 USD · $2,849 MXN
    limits: {
      maxApiKeys:      500,
      monthlyRequests: 999_999_999,
      maxFileSizeMB:   10240,      // 10 GB
      storageGB:       3072        // 3 TB
    }
  }
};

// ── Oferta de lanzamiento (85% OFF) ───────────────────────────────────────
// Mientras Date.now() < endsAt se cobra launchPrices; después, el precio normal.
// ⚠️ Debe coincidir con data-end del tablero en index.html.
export const LAUNCH = {
  percentOff: 85,
  endsAt: Date.parse('2026-08-25T23:59:59')   // fecha/hora local del navegador del contador
};
export function launchActive() {
  return Number.isFinite(LAUNCH.endsAt) && Date.now() < LAUNCH.endsAt;
}

// Normaliza la moneda a una soportada (por defecto usd).
export function normalizeCurrency(currency) {
  const c = String(currency || '').trim().toLowerCase();
  return SUPPORTED_CURRENCIES.includes(c) ? c : 'usd';
}

// Precio de un plan en la moneda pedida, en centavos.
// useLaunch=true devuelve el precio de lanzamiento (85% OFF) si el plan lo tiene.
export function planPrice(plan, currency, useLaunch = false) {
  if (!plan) return 0;
  const c = normalizeCurrency(currency);
  if (useLaunch && plan.launchPrices) {
    const lp = plan.launchPrices[c] ?? plan.launchPrices.usd;
    if (lp != null) return lp;
  }
  if (plan.prices) return plan.prices[c] ?? plan.prices.usd ?? 0;
  return plan.priceCents || 0; // compatibilidad con formato antiguo
}

export function getPlan(planId) {
  return PLANS[planId] || null;
}

// ── Stripe REST call (form-encoded, sin SDK) ───────────────────────────────
async function stripeReq(env, method, path, body) {
  // .trim() defensivo: un salto de línea o espacio al pegar la clave en el
  // panel de variables rompe la cabecera Authorization y Stripe responde 401.
  const secretKey = (env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY no configurado');
  }
  if (!secretKey.startsWith('sk_')) {
    // pk_live / pk_test / rk_… no sirven para crear sesiones de checkout
    throw new Error('La clave de Stripe debe ser una clave SECRETA (empieza con "sk_"), no una publicable.');
  }
  const headers = {
    Authorization: `Bearer ${secretKey}`,
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
    if (res.status === 401) {
      throw new Error('Clave secreta de Stripe inválida o revocada (401). Genera una nueva "sk_live_…" en Stripe → API keys, pégala en Cloudflare sin espacios y vuelve a desplegar.');
    }
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
export async function createOneTimeCheckout(env, { uid = '', email = '', plan, currency = 'usd' }) {
  const cfg = getPlan(plan);
  if (!cfg || cfg.id === 'gratis') throw new Error('Plan inválido para checkout.');

  const cur      = normalizeCurrency(currency);
  const onLaunch = launchActive();
  const amount   = planPrice(cfg, cur, onLaunch);
  if (!amount || amount <= 0) throw new Error(`El plan ${cfg.id} no tiene precio en ${cur.toUpperCase()}.`);

  const publicUrl = (env.PUBLIC_URL || '').replace(/\/$/, '') || 'https://nubifly.com';
  const prodName  = onLaunch ? `Nubifly ${cfg.name} — Lanzamiento (${LAUNCH.percentOff}% OFF)` : `Nubifly ${cfg.name}`;

  const params = {
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: cur,
        unit_amount: amount,
        product_data: {
          name: prodName,
          description: `Upgrade permanente al plan ${cfg.name}. Sin renovaciones.`
        }
      }
    }],
    metadata: { uid: uid || '', plan: cfg.id, currency: cur, launch: onLaunch ? '1' : '0' },
    payment_intent_data: {
      metadata: { uid: uid || '', plan: cfg.id, currency: cur, launch: onLaunch ? '1' : '0' }
    },
    success_url: `${publicUrl}/pago-completado?plan=${cfg.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${publicUrl}/#precios`
  };
  if (uid)   params.client_reference_id = uid;
  if (email) params.customer_email      = email;

  return stripeReq(env, 'POST', '/checkout/sessions', params);
}

// ── Recuperar una Checkout Session por ID ─────────────────────────────────
// Usado por /api/payment/session y por register.js para verificar un pago
// de invitado directamente contra Stripe (sin depender del webhook).
export async function retrieveCheckoutSession(env, sessionId) {
  if (!sessionId) throw new Error('sessionId requerido');
  return stripeReq(env, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

// Extrae el email del comprador de una Checkout Session (varias ubicaciones).
export function sessionEmail(session) {
  return (
    session?.customer_email ||
    session?.customer_details?.email ||
    ''
  ).trim().toLowerCase();
}

// ── Construir el registro de plan (compartido webhook + register) ─────────
// Devuelve { plan, limits, now } listos para escribir en controlUsers/{uid}.
export function buildPlanRecord(plan, {
  amountTotal, currency, customerId, sessionId, paymentIntentId, customerEmail
} = {}) {
  const now = Date.now();
  return {
    plan: {
      type:        plan.id,
      isPremium:   true,
      purchasedAt: now,
      amountPaid:  amountTotal ?? planPrice(plan, currency),
      currency:    normalizeCurrency(currency),
      stripe: {
        customerId:        customerId || null,
        checkoutSessionId: sessionId || null,
        paymentIntentId:   paymentIntentId || null,
        customerEmail:     customerEmail || ''
      }
    },
    limits: {
      maxApiKeys:      plan.limits.maxApiKeys,
      monthlyRequests: plan.limits.monthlyRequests,
      maxFileSizeMB:   plan.limits.maxFileSizeMB
    },
    now
  };
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
