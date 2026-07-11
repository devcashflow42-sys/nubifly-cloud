/**
 * GET /api/payment/status
 *
 * Devuelve el plan actual del usuario y los beneficios/limits que le
 * corresponden. Incluye también el catálogo de planes disponibles para que
 * el frontend pueda pintar la tabla de precios sin hardcodear valores.
 */
import { requireAuth }           from '../../_lib/auth.js';
import { fbGet }                 from '../../_lib/firebase.js';
import { jsonRes, ok, fail }     from '../../_lib/response.js';
import { PLANS, getPlan }        from '../../_lib/stripe.js';

export async function onRequestGet(context) {
  const { request, env }        = context;
  const { user, errorResponse } = await requireAuth(request, env);
  if (errorResponse) return errorResponse;
  const { tok, db } = context.data;

  let control;
  try { control = await fbGet(`controlUsers/${user.uid}`, tok, db); }
  catch { return jsonRes(fail('Error de servicio. Inténtalo de nuevo.', 'DB_ERROR'), 503); }

  const currentPlanId = control?.plan?.type || 'gratis';
  const currentPlan   = getPlan(currentPlanId) || PLANS.gratis;

  return jsonRes(ok({
    plan: {
      id:          currentPlan.id,
      name:        currentPlan.name,
      isPremium:   !!control?.plan?.isPremium,
      purchasedAt: control?.plan?.purchasedAt || 0,
      limits:      currentPlan.limits
    },
    catalog: Object.values(PLANS).map(p => ({
      id:     p.id,
      name:   p.name,
      prices: {
        usd: { cents: p.prices.usd, amount: (p.prices.usd / 100).toFixed(2) },
        mxn: { cents: p.prices.mxn, amount: (p.prices.mxn / 100).toFixed(2) }
      },
      limits: p.limits
    }))
  }));
}
