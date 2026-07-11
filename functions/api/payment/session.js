/**
 * GET /api/payment/session?id=cs_xxx
 *
 * Devuelve datos públicos y seguros de una Checkout Session de Stripe para
 * que la página /pago-completado pueda mostrar el email pagado y pre-rellenar
 * el registro. NO expone datos sensibles de pago.
 *
 * Exento de firma HMAC (Capa 6): lo llama una página estática sin firmar.
 *
 * Response 200:
 *   { success: true, data: {
 *       email, plan, planName, paid, hasAccount
 *   } }
 */
import { fbGet }                         from '../../_lib/firebase.js';
import { jsonRes, ok, fail }             from '../../_lib/response.js';
import { retrieveCheckoutSession,
         getPlan, sessionEmail }         from '../../_lib/stripe.js';
import { toEmailKey }                    from '../../_lib/helpers.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { tok, db }      = context.data;

  const url = new URL(request.url);
  const id  = (url.searchParams.get('id') || '').trim();

  // Validación básica del formato de session id de Stripe
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) {
    return jsonRes(fail('session id inválido.', 'BAD_SESSION_ID'), 400);
  }

  let session;
  try {
    session = await retrieveCheckoutSession(env, id);
  } catch (e) {
    console.warn('[payment/session] stripe:', e.message);
    return jsonRes(fail('No se pudo verificar la sesión de pago.', 'STRIPE_ERROR'), 502);
  }

  const email   = sessionEmail(session);
  const planId  = String(session.metadata?.plan || '').toLowerCase();
  const plan    = getPlan(planId);
  const paid    = session.payment_status === 'paid';

  // ¿El email ya tiene cuenta en Nubifly?
  let hasAccount = false;
  if (email) {
    const uid = await fbGet(`emails/${toEmailKey(email)}`, tok, db).catch(() => null);
    hasAccount = !!(uid && typeof uid === 'string');
  }

  return jsonRes(ok({
    email,
    plan:     plan ? plan.id : '',
    planName: plan ? plan.name : '',
    paid,
    hasAccount
  }));
}
