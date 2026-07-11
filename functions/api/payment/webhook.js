/**
 * POST /api/payment/webhook
 *
 * Recibe eventos de Stripe. Solo procesa 'checkout.session.completed' para
 * marcar al usuario con su plan permanente en controlUsers/{uid}/plan.
 *
 * Este endpoint está exento de HMAC signing (Capa 6) porque Stripe usa su
 * propia firma HMAC-SHA256 vía el header Stripe-Signature.
 *
 * En Stripe → Developers → Webhooks, agrega el endpoint apuntando a:
 *   https://TU_DOMINIO/api/payment/webhook
 * Suscribe SOLO al evento: checkout.session.completed
 * Copia el "Signing secret" (whsec_...) a env.STRIPE_WEBHOOK_SECRET.
 */
import { fbGet, fbUpdate }           from '../../_lib/firebase.js';
import { verifyStripeSignature,
         getPlan }                    from '../../_lib/stripe.js';
import { crearAvisoSistema }         from '../../_lib/notifications.js';

// Respuestas planas (sin envolver en fail/ok) para no confundir a Stripe.
function txt(body, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { tok, db }      = context.data;

  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET no configurado');
    return txt('webhook secret missing', 503);
  }

  // Leer el body RAW (sin parsear) — necesario para verificar la firma
  const raw = await request.text();
  const sig = request.headers.get('Stripe-Signature') || '';

  const valid = await verifyStripeSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    console.warn('[stripe/webhook] firma inválida');
    return txt('invalid signature', 400);
  }

  let event;
  try { event = JSON.parse(raw); }
  catch { return txt('bad json', 400); }

  // Solo nos interesa el evento de pago completado
  if (event.type !== 'checkout.session.completed') {
    return txt('ignored', 200);
  }

  const session = event.data?.object || {};

  // Idempotencia: si ya procesamos este event.id, salir OK
  const dedupPath = `stripeProcessed/${event.id}`;
  const already   = await fbGet(dedupPath, tok, db).catch(() => null);
  if (already) return txt('duplicate', 200);

  const uid       = session.client_reference_id || session.metadata?.uid;
  const planId    = String(session.metadata?.plan || '').toLowerCase();
  const plan      = getPlan(planId);
  const paymentOk = session.payment_status === 'paid';

  if (!uid || !plan || plan.id === 'gratis' || !paymentOk) {
    console.warn('[stripe/webhook] evento inválido', { uid, planId, paymentOk });
    await fbUpdate({ [dedupPath]: { ts: Date.now(), ignored: true } }, tok, db).catch(() => {});
    return txt('missing data', 200);
  }

  const now = Date.now();
  const planData = {
    type:        plan.id,
    isPremium:   true,
    purchasedAt: now,
    amountPaid:  session.amount_total ?? plan.priceCents,
    currency:    session.currency || 'usd',
    stripe: {
      customerId:        session.customer || null,
      checkoutSessionId: session.id,
      paymentIntentId:   session.payment_intent || null
    }
  };
  const limits = {
    maxApiKeys:       plan.limits.maxApiKeys,
    monthlyRequests:  plan.limits.monthlyRequests,
    maxFileSizeMB:    plan.limits.maxFileSizeMB
  };

  try {
    await fbUpdate({
      [`controlUsers/${uid}/plan`]:      planData,
      [`controlUsers/${uid}/limits`]:    limits,
      [`controlUsers/${uid}/updatedAt`]: now,
      [dedupPath]:                       { ts: now, uid, plan: plan.id, sessionId: session.id }
    }, tok, db);
  } catch (e) {
    console.error('[stripe/webhook] fbUpdate:', e.message);
    return txt('db error', 500);
  }

  // Aviso profesional al usuario (fire-and-forget)
  context.waitUntil(
    crearAvisoSistema(
      uid, 'info',
      `¡Bienvenido a ${plan.name}!`,
      `Tu pago se procesó correctamente. Ahora tienes ${plan.limits.maxApiKeys} API keys y archivos de hasta ${plan.limits.maxFileSizeMB} MB.`,
      0, tok, db
    ).catch(e => console.warn('[stripe/webhook] aviso:', e.message))
  );

  return txt('ok', 200);
}
