'use strict';
const db       = require('../config/firebase');
const { ok, fail } = require('../utils/response');

// Plan limits config
const PLAN_LIMITS = {
  normal:  { requestsPerDay: 500,  requestsPerMonth: 10000 },
  premium: { requestsPerDay: 5000, requestsPerMonth: 100000 },
  vip:     { requestsPerDay: 50000,requestsPerMonth: 1000000 }
};

// ── POST /api/v1/request ──────────────────────────────────────────────────
// Requires: x-api-key header (validated by verifyApiKey middleware)
// Body: { action, payload }
exports.handleRequest = async (req, res) => {
  try {
    const { projectId, ownerId, project, control } = req.apiKeyData;
    const { action = 'ping', payload = {} } = req.body;

    // ── Check plan limits ───────────────────────────────────────────────────
    const planType  = control?.plan?.type || 'normal';
    const limits    = PLAN_LIMITS[planType] || PLAN_LIMITS.normal;

    const today     = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const month     = today.slice(0, 7);                     // YYYY-MM

    const usagePath = `apiUsage/${projectId}`;
    const usageSnap = await db.ref(usagePath).once('value');
    const usage     = usageSnap.val() || {};

    const dailyCount   = usage[today] || 0;
    const monthlyCount = usage[month] || 0;

    if (dailyCount >= limits.requestsPerDay) {
      return res.status(429).json(fail(
        `Límite diario alcanzado (${limits.requestsPerDay} solicitudes/día).`,
        'DAILY_LIMIT_EXCEEDED'
      ));
    }
    if (monthlyCount >= limits.requestsPerMonth) {
      return res.status(429).json(fail(
        `Límite mensual alcanzado (${limits.requestsPerMonth} solicitudes/mes).`,
        'MONTHLY_LIMIT_EXCEEDED'
      ));
    }

    // ── Increment usage counters ────────────────────────────────────────────
    await db.ref(usagePath).update({
      [today]: dailyCount + 1,
      [month]: monthlyCount + 1
    });

    // ── Process action ──────────────────────────────────────────────────────
    const result = await processAction(action, payload, { projectId, ownerId, project });

    return res.json(ok({
      action,
      result,
      usage: {
        today: dailyCount + 1,
        month: monthlyCount + 1,
        limits
      }
    }, `Acción '${action}' ejecutada correctamente.`));

  } catch (err) {
    console.error('[publicApi.handleRequest]', err);
    return res.status(500).json(fail('Error procesando la solicitud.', 'SERVER_ERROR'));
  }
};

// ── GET /api/v1/status ─────────────────────────────────────────────────────
exports.getStatus = async (req, res) => {
  try {
    const { projectId, project, control } = req.apiKeyData;
    const planType = control?.plan?.type || 'normal';
    const today    = new Date().toISOString().slice(0, 10);
    const month    = today.slice(0, 7);

    const usageSnap = await db.ref(`apiUsage/${projectId}`).once('value');
    const usage     = usageSnap.val() || {};
    const limits    = PLAN_LIMITS[planType] || PLAN_LIMITS.normal;

    return res.json(ok({
      project:  { id: projectId, name: project.name },
      plan:     planType,
      usage: {
        today: usage[today] || 0,
        month: usage[month] || 0,
        limits
      }
    }));
  } catch (err) {
    console.error('[publicApi.getStatus]', err);
    return res.status(500).json(fail('Error obteniendo estado.', 'SERVER_ERROR'));
  }
};

// ── Action dispatcher ─────────────────────────────────────────────────────
async function processAction(action, payload, ctx) {
  switch (action) {
    case 'ping':
      return { pong: true, ts: Date.now(), projectId: ctx.projectId };

    case 'echo':
      return { echoed: payload };

    case 'store': {
      // Store arbitrary JSON data under the project namespace
      if (!payload.key) throw Object.assign(new Error('payload.key is required for store action'), { statusCode: 400 });
      const safeKey = String(payload.key).replace(/[./#$[\]]/g, '_').slice(0, 100);
      await db.ref(`projectData/${ctx.projectId}/${safeKey}`).set({
        value:     payload.value ?? null,
        updatedAt: Date.now()
      });
      return { stored: true, key: safeKey };
    }

    case 'fetch': {
      if (!payload.key) throw Object.assign(new Error('payload.key is required for fetch action'), { statusCode: 400 });
      const safeKey = String(payload.key).replace(/[./#$[\]]/g, '_').slice(0, 100);
      const snap    = await db.ref(`projectData/${ctx.projectId}/${safeKey}`).once('value');
      return { found: snap.exists(), data: snap.val() };
    }

    default:
      return { message: `Action '${action}' received but not mapped to a specific handler.` };
  }
}
