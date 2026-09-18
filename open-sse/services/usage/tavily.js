/**
 * Tavily usage — GET https://api.tavily.com/usage
 * Auth: Bearer <apiKey>
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getTavilyUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "Tavily API key not available." };
  }

  try {
    const res = await proxyAwareFetch(
      "https://api.tavily.com/usage",
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
      return { plan: "Tavily", message: "Tavily API key invalid or unauthorized." };
    }

    if (!res.ok) {
      return { plan: "Tavily", message: `Tavily API error (${res.status}).` };
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return { plan: "Tavily", message: "Tavily response was not JSON." };
    }

    const account = data.account || {};
    const keyInfo = data.key || {};

    const planLimit = Number(account.plan_limit) || 0;
    const planUsage = Number(account.plan_usage) || Number(keyInfo.usage) || 0;
    const isUnlimited = planLimit <= 0;

    const remaining = Math.max(0, planLimit - planUsage);
    const remainingPct = !isUnlimited ? Math.min(100, Math.max(0, (remaining / planLimit) * 100)) : 100;

    const quotas = {
      "Monthly Searches": {
        used: planUsage,
        total: planLimit,
        remainingPercentage: Math.round(remainingPct * 10) / 10,
        resetAt: null,
        unlimited: isUnlimited,
      },
    };

    const planName = account.current_plan ? `Tavily (${account.current_plan})` : "Tavily";

    return {
      plan: planName,
      quotas,
    };
  } catch (err) {
    return { plan: "Tavily", message: `Failed to fetch Tavily usage: ${err.message}` };
  }
}
