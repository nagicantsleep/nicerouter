/**
 * OpenRouter usage — GET https://openrouter.ai/api/v1/credits & /auth/key
 * Auth: Bearer <apiKey>
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";

function getNextMidnightUtc() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getOpenRouterUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "OpenRouter API key not available." };
  }

  const cleanKey = apiKey.trim();
  const headers = {
    Authorization: `Bearer ${cleanKey}`,
    Accept: "application/json",
  };

  try {
    const [credRes, keyRes] = await Promise.all([
      proxyAwareFetch("https://openrouter.ai/api/v1/credits", { method: "GET", headers }, proxyOptions).catch(() => null),
      proxyAwareFetch("https://openrouter.ai/api/v1/auth/key", { method: "GET", headers }, proxyOptions).catch(() => null),
    ]);

    if (!credRes && !keyRes) {
      return { plan: "OpenRouter", message: "Could not reach OpenRouter API." };
    }

    if (credRes?.status === 401 || keyRes?.status === 401) {
      return { plan: "OpenRouter", message: "OpenRouter API key invalid or expired." };
    }

    const credData = credRes?.ok ? await credRes.json().catch(() => null) : null;
    const keyData = keyRes?.ok ? await keyRes.json().catch(() => null) : null;

    const quotas = {};
    const keyInfo = keyData?.data || {};

    // 1. Credit Balance
    if (credData?.data) {
      const totalCredits = Number(credData.data.total_credits) || 0;
      const totalUsage = Number(credData.data.total_usage) || 0;
      const remainingCredits = Math.max(0, totalCredits - totalUsage);
      const remainingPct = totalCredits > 0
        ? Math.min(100, Math.max(0, (remainingCredits / totalCredits) * 100))
        : 0;

      quotas["Credit Balance ($)"] = {
        used: Math.round(totalUsage * 10000) / 10000,
        total: Math.round(totalCredits * 10000) / 10000,
        remainingPercentage: Math.round(remainingPct * 10) / 10,
        resetAt: null,
        unlimited: false,
        isCreditBalance: totalCredits <= 0 && remainingCredits > 0,
        currency: "USD",
      };
    }

    // 2. Free Model Daily Requests
    if (keyInfo.free_model_daily_requests) {
      const free = keyInfo.free_model_daily_requests;
      const limit = Number(free.limit) || 0;
      const used = Number(free.used) || 0;
      const remaining = Number(free.remaining) ?? (limit - used);
      const remainingPct = limit > 0 ? Math.min(100, Math.max(0, (remaining / limit) * 100)) : 100;

      quotas["Free Daily Requests"] = {
        used,
        total: limit,
        remainingPercentage: Math.round(remainingPct * 10) / 10,
        resetAt: getNextMidnightUtc(),
        unlimited: limit <= 0,
      };
    }

    // 3. Key Spend Limit (if configured)
    const keyLimit = Number(keyInfo.limit) || 0;
    if (keyLimit > 0) {
      const keyUsage = Number(keyInfo.usage) || 0;
      const remaining = Math.max(0, keyLimit - keyUsage);
      const remainingPct = Math.min(100, Math.max(0, (remaining / keyLimit) * 100));

      quotas["Key Spend Limit ($)"] = {
        used: Math.round(keyUsage * 10000) / 10000,
        total: Math.round(keyLimit * 10000) / 10000,
        remainingPercentage: Math.round(remainingPct * 10) / 10,
        resetAt: keyInfo.limit_reset ? new Date(keyInfo.limit_reset).toISOString() : null,
        unlimited: false,
      };
    }

    const planLabel = keyInfo.label ? `OpenRouter (${keyInfo.label})` : "OpenRouter";

    return {
      plan: planLabel,
      quotas,
    };
  } catch (err) {
    return { plan: "OpenRouter", message: `Failed to fetch OpenRouter quota: ${err.message}` };
  }
}
