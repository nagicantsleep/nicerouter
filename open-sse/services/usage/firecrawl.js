/**
 * Firecrawl usage — GET https://api.firecrawl.dev/v1/team/credit-usage
 * Auth: Bearer <apiKey>
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getFirecrawlUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "Firecrawl API key not available." };
  }

  try {
    const res = await proxyAwareFetch(
      "https://api.firecrawl.dev/v1/team/credit-usage",
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
      return { plan: "Firecrawl", message: "Firecrawl API key invalid or unauthorized." };
    }

    if (!res.ok) {
      return { plan: "Firecrawl", message: `Firecrawl API error (${res.status}).` };
    }

    const json = await res.json().catch(() => null);
    const data = json?.data || json;

    const remaining = Number(data?.remaining_credits) || 0;
    const planCredits = Number(data?.plan_credits) || 0;
    const total = Math.max(planCredits, remaining);
    const used = Math.max(0, total - remaining);
    const remainingPct = total > 0 ? Math.min(100, Math.max(0, (remaining / total) * 100)) : 100;

    let resetAt = null;
    if (data?.billing_period_end) {
      try {
        resetAt = new Date(data.billing_period_end).toISOString();
      } catch {}
    }

    const quotas = {
      Credits: {
        used,
        total,
        remainingPercentage: Math.round(remainingPct * 10) / 10,
        resetAt,
        unlimited: false,
      },
    };

    return {
      plan: "Firecrawl",
      quotas,
    };
  } catch (err) {
    return { plan: "Firecrawl", message: `Failed to fetch Firecrawl quota: ${err.message}` };
  }
}
