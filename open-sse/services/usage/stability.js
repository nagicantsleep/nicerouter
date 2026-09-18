/**
 * Stability AI usage — GET https://api.stability.ai/v1/user/balance
 * Auth: Bearer <apiKey>
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getStabilityUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "Stability AI API key not available." };
  }

  try {
    const res = await proxyAwareFetch(
      "https://api.stability.ai/v1/user/balance",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );

    if (res.status === 401 || res.status === 403) {
      return { plan: "Stability AI", message: "Stability AI API key invalid or unauthorized." };
    }

    if (!res.ok) {
      return { plan: "Stability AI", message: `Stability AI balance API error (${res.status}).` };
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return { plan: "Stability AI", message: "Stability AI response was not JSON." };
    }

    const credits = Number(data.credits) || 0;
    const quotas = {
      Credits: {
        used: 0,
        total: Math.round(credits * 100) / 100,
        remainingPercentage: credits > 0 ? 100 : 0,
        resetAt: null,
        unlimited: false,
        isCreditBalance: true,
        currency: "Credits",
      },
    };

    return {
      plan: "Stability AI",
      quotas,
    };
  } catch (err) {
    return { plan: "Stability AI", message: `Failed to fetch Stability AI balance: ${err.message}` };
  }
}
