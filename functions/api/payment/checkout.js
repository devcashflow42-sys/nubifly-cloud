/**
 * POST /api/payment/checkout
 *
 * Crea una Checkout Session de Stripe (pago único) y devuelve la URL a la
 * que el frontend debe redirigir.
 *
 * Auth OPCIONAL:
 *  - Con JWT válido → se guarda uid en client_reference_id.
 *  - Sin JWT (invitado) → Stripe pide el email en su checkout. El webhook
 *    activa el plan por email después del pago (si el email ya tiene
 *    cuenta) o lo guarda como pendingUpgrades para activarlo al registrarse.
 *
 * Body: { plan: 'basico' | 'pro' | 'enterprise' }
 *
 * Response 200:
 *   { success: true, data: { url: 'https://checkout.stripe.com/...', sessionId: 'cs_...' } }
 */
import { authenticate }              from '../../_lib/auth.js';
import { fbGet }                     from '../../_lib/firebase.js';
import { jsonRes, ok, fail }         from '../../_lib/response.js';
import { createOneTimeCheckout,
         getPlan }                   from '../../_lib/stripe.js';

export async function onRequestPost(context) {
  // Envoltura total: cualquier excepción se devuelve como JSON legible en
  // lugar de convertirse en un 502 HTML del runtime de Cloudflare.
  try {
    const { request, env } = context;
    const { tok, db }      = context.data || {};

    // Falta de configuración → mensaje claro (no 502 opaco)
    if (!env.STRIPE_SECRET_KEY) {
      return jsonRes(fail('El pago no está configurado en el servidor (falta STRIPE_SECRET_KEY).', 'STRIPE_NOT_CONFIGURED'), 503);
    }

    let body;
    try { body = await request.json(); }
    catch { return jsonRes(fail('JSON inválido.', 'BAD_REQUEST'), 400); }

    const planId = String(body?.plan || '').trim().toLowerCase();
    const cfg    = getPlan(planId);
    if (!cfg || cfg.id === 'gratis') {
      return jsonRes(fail('Plan inválido. Usa "basico", "pro" o "enterprise".', 'INVALID_PLAN'), 400);
    }

    // Auth opcional — si viene JWT válido, cargamos plan actual y evitamos cobrar de nuevo
    let uid   = '';
    let email = '';
    try {
      const user = await authenticate(request, env);
      if (user?.uid) {
        uid   = user.uid;
        email = user.email || '';
        try {
          const control     = await fbGet(`controlUsers/${uid}`, tok, db);
          const currentPlan = control?.plan?.type || 'gratis';
          const rank = { gratis: 0, basico: 1, pro: 2, enterprise: 3 };
          if ((rank[currentPlan] || 0) >= (rank[cfg.id] || 0)) {
            return jsonRes(fail(`Ya tienes el plan ${currentPlan}.`, 'PLAN_ALREADY_ACTIVE'), 409);
          }
          if (!email && control?.email) email = control.email;
        } catch { /* no bloquear si no se puede leer el plan actual */ }
      }
    } catch { /* auth opcional: seguir como invitado */ }

    let session;
    try {
      session = await createOneTimeCheckout(env, { uid, email, plan: cfg.id });
    } catch (e) {
      console.error('[payment/checkout] stripe:', e && e.message);
      // Incluir el detalle de Stripe para diagnóstico (no es dato sensible).
      return jsonRes(fail('Stripe rechazó la solicitud: ' + (e && e.message ? e.message : 'error desconocido'), 'STRIPE_ERROR'), 502);
    }

    if (!session || !session.url) {
      return jsonRes(fail('Stripe no devolvió una URL de pago.', 'STRIPE_NO_URL'), 502);
    }

    return jsonRes(ok({ url: session.url, sessionId: session.id }));

  } catch (e) {
    console.error('[payment/checkout] fatal:', e && e.message);
    return jsonRes(fail('Error interno en checkout: ' + (e && e.message ? e.message : 'desconocido'), 'CHECKOUT_FATAL'), 500);
  }
}
