/**
 * POST /api/payment/checkout
 *
 * Crea una Checkout Session de Stripe (pago único) y devuelve la URL a la
 * que el frontend debe redirigir. Solo planes 'pro' o 'business'.
 *
 * Body: { plan: 'pro' | 'business' }
 *
 * Response 200:
 *   { success: true, url: 'https://checkout.stripe.com/...', sessionId: 'cs_...' }
 */
import { requireAuth }             from '../../_lib/auth.js';
import { fbGet }                   from '../../_lib/firebase.js';
import { jsonRes, ok, fail }       from '../../_lib/response.js';
import { createOneTimeCheckout,
         getPlan }                 from '../../_lib/stripe.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const { tok, db }      = context.data;

  const { user, errorResponse } = await requireAuth(request, env);
  if (errorResponse) return errorResponse;

  let body;
  try { body = await request.json(); }
  catch { return jsonRes(fail('JSON inválido.', 'BAD_REQUEST'), 400); }

  const planId = String(body?.plan || '').trim().toLowerCase();
  const cfg    = getPlan(planId);
  if (!cfg || cfg.id === 'free') {
    return jsonRes(fail('Plan inválido. Usa "pro" o "business".', 'INVALID_PLAN'), 400);
  }

  // Si el usuario ya está en un plan pago del mismo o mayor nivel, no cobrar de nuevo
  let control;
  try { control = await fbGet(`controlUsers/${user.uid}`, tok, db); }
  catch { return jsonRes(fail('Error de servicio. Inténtalo de nuevo.', 'DB_ERROR'), 503); }

  const currentPlan = control?.plan?.type || 'free';
  const rank = { free: 0, pro: 1, business: 2 };
  if ((rank[currentPlan] || 0) >= (rank[cfg.id] || 0)) {
    return jsonRes(fail(`Ya tienes el plan ${currentPlan}.`, 'PLAN_ALREADY_ACTIVE'), 409);
  }

  let session;
  try {
    session = await createOneTimeCheckout(env, {
      uid:   user.uid,
      email: user.email || control?.email || undefined,
      plan:  cfg.id
    });
  } catch (e) {
    console.error('[payment/checkout] stripe:', e.message);
    return jsonRes(fail('Error creando la sesión de pago. Inténtalo de nuevo.', 'STRIPE_ERROR'), 502);
  }

  return jsonRes(ok({ url: session.url, sessionId: session.id }));
}
