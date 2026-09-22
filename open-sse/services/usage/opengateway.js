/**
 * OpenGateway usage — GET https://opengateway.gitlawb.com/v1/credits & /v1/usage/me
 * Auth: Bearer <apiKey>
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getOpenGatewayUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "OpenGateway API key not available." };
  }

  const cleanKey = apiKey.trim();
  const headers = {
    Authorization: `Bearer ${cleanKey}`,
    Accept: "application/json",
  };

  try {
    const [credRes, usageRes] = await Promise.all([
      proxyAwareFetch("https://opengateway.gitlawb.com/v1/credits", { method: "GET", headers }, proxyOptions).catch(() => null),
      proxyAwareFetch("https://opengateway.gitlawb.com/v1/usage/me", { method: "GET", headers }, proxyOptions).catch(() => null),
    ]);

    if (!credRes && !usageRes) {
      return { plan: "OpenGateway", message: "Could not reach OpenGateway API." };
    }

    if (credRes?.status === 401 || usageRes?.status === 401) {
      return { plan: "OpenGateway", message: "OpenGateway API key invalid or expired." };
    }

    const credData = credRes?.ok ? await credRes.json().catch(() => null) : null;
    const usageData = usageRes?.ok ? await usageRes.json().catch(() => null) : null;

    const quotas = {};

    // 1. Credit Balance
    if (credData) {
      const balance = Number(credData.balance_usd ?? credData.data?.total_credits ?? credData.credits ?? credData.balance) || 0;
      const totalSpent = Number(credData.total_spent_usd ?? credData.data?.total_usage ?? credData.usage) || 0;
      const total = balance + totalSpent;
      const remainingPct = total > 0 ? Math.min(100, Math.max(0, (balance / total) * 100)) : 100;

      quotas["Credit Balance ($)"] = {
        used: Math.round(totalSpent * 10000) / 10000,
        total: Math.round(total * 10000) / 10000,
        remainingPercentage: Math.round(remainingPct * 10) / 10,
        resetAt: null,
        unlimited: false,
        isCreditBalance: true,
        currency: "USD",
      };
    }

    // 2. Free Tier indicator
    quotas["Nemotron 3 Ultra (Free)"] = {
      used: 0,
      total: 0,
      remainingPercentage: 100,
      resetAt: null,
      unlimited: true,
    };

    return {
      plan: "OpenGateway (gitlawb)",
      quotas,
    };
  } catch (err) {
    return { plan: "OpenGateway", message: `Failed to fetch OpenGateway quota: ${err.message}` };
  }
}
