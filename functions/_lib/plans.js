/**
 * functions/_lib/plans.js
 *
 * Límites de uso por plan.
 */

export const PLAN_LIMITS = {
  normal:  { requestsPerDay: 500,    requestsPerMonth: 10000   },
  premium: { requestsPerDay: 5000,   requestsPerMonth: 100000  },
  vip:     { requestsPerDay: 50000,  requestsPerMonth: 1000000 }
};
