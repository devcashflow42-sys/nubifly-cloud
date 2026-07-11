/**
 * POST /api/payment/webhook
 *
 * Recibe eventos de Stripe. Solo procesa 'checkout.session.completed'.
 *
 * Comportamiento:
 *  - Si el evento trae uid (usuario logueado al pagar) → activa el plan en
 *    controlUsers/{uid}/plan directamente.
 *  - Si NO trae uid (pago de invitado) → busca al usuario por email:
 *     • Si el email ya tiene cuenta → activa el plan.
 *     • Si no → guarda en pendingUpgrades/{emailKey} con el plan pagado
 *       para activarlo automáticamente cuando el usuario se registre.
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
import { toEmailKey }                from '../../_lib/helpers.js';

function txt(body, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

function buildPlanData(plan, session) {
  const now = Date.now();
  return {
    plan: {
      type:        plan.id,
      isPremium:   true,
      purchasedAt: now,
      amountPaid:  session.amount_total ?? plan.priceCents,
      currency:    session.currency || 'usd',
      stripe: {
        customerId:        session.customer || null,
        checkoutSessionId: session.id,
        paymentIntentId:   session.payment_intent || null,
        customerEmail:     session.customer_email || session.customer_details?.email || ''
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

export async function onRequestPost(context) {
  const { request, env } = context;
  const { tok, db }      = context.data;

  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET no configurado');
    return txt('webhook secret missing', 503);
  }

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

  if (event.type !== 'checkout.session.completed') {
    return txt('ignored', 200);
  }

  const session = event.data?.object || {};

  // Idempotencia
  const dedupPath = `stripeProcessed/${event.id}`;
  const already   = await fbGet(dedupPath, tok, db).catch(() => null);
  if (already) return txt('duplicate', 200);

  const uidFromSession = session.client_reference_id || session.metadata?.uid || '';
  const emailRaw       = session.customer_email || session.customer_details?.email || '';
  const planId         = String(session.metadata?.plan || '').toLowerCase();
  const plan           = getPlan(planId);
  const paymentOk      = session.payment_status === 'paid';

  if (!plan || plan.id === 'gratis' || !paymentOk) {
    console.warn('[stripe/webhook] evento inválido', { planId, paymentOk });
    await fbUpdate({ [dedupPath]: { ts: Date.now(), ignored: true } }, tok, db).catch(() => {});
    return txt('missing data', 200);
  }

  const { plan: planData, limits, now } = buildPlanData(plan, session);

  // Resolver uid destino: primero el uid del session, si no hay, buscar por email
  let targetUid = uidFromSession;
  if (!targetUid && emailRaw) {
    const emailKey = toEmailKey(emailRaw);
    const foundUid = await fbGet(`emails/${emailKey}`, tok, db).catch(() => null);
    if (foundUid && typeof foundUid === 'string') targetUid = foundUid;
  }

  // Caso 1: tenemos un usuario existente → activar plan ya
  if (targetUid) {
    try {
      await fbUpdate({
        [`controlUsers/${targetUid}/plan`]:      planData,
        [`controlUsers/${targetUid}/limits`]:    limits,
        [`controlUsers/${targetUid}/updatedAt`]: now,
        [dedupPath]: { ts: now, uid: targetUid, plan: plan.id, sessionId: session.id }
      }, tok, db);
    } catch (e) {
      console.error('[stripe/webhook] fbUpdate:', e.message);
      return txt('db error', 500);
    }

    context.waitUntil(
      crearAvisoSistema(
        targetUid, 'info',
        `¡Bienvenido a ${plan.name}!`,
        `Tu pago se procesó correctamente. Ahora tienes ${plan.limits.maxApiKeys} API keys y archivos de hasta ${plan.limits.maxFileSizeMB} MB.`,
        0, tok, db
      ).catch(e => console.warn('[stripe/webhook] aviso:', e.message))
    );

    return txt('ok', 200);
  }

  // Caso 2: pago de invitado sin cuenta previa → guardar como pending para activar al registrarse
  if (emailRaw) {
    const emailKey = toEmailKey(emailRaw);
    try {
      await fbUpdate({
        [`pendingUpgrades/${emailKey}`]: {
          email:       emailRaw,
          plan:        plan.id,
          planData,
          limits,
          sessionId:   session.id,
          purchasedAt: now
        },
        [dedupPath]: { ts: now, plan: plan.id, sessionId: session.id, pending: true, email: emailRaw }
      }, tok, db);
    } catch (e) {
      console.error('[stripe/webhook] pendingUpgrades:', e.message);
      return txt('db error', 500);
    }
    return txt('pending', 200);
  }

  // Sin uid ni email — no se puede vincular
  console.warn('[stripe/webhook] pago sin uid ni email');
  await fbUpdate({ [dedupPath]: { ts: now, ignored: true, reason: 'no-target' } }, tok, db).catch(() => {});
  return txt('no target', 200);
}
