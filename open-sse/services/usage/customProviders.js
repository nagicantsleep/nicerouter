import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const DEFAULT_HEADERS = {
  "User-Agent": "Cline/3.0.0",
  "Accept": "application/json",
};

/**
 * AMD Radeon AI usage — GET https://developer.amd.com.cn/radeon/api/v1/usage
 */
export async function getAmdUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "AMD API key not available." };

  try {
    const res = await proxyAwareFetch("https://developer.amd.com.cn/radeon/api/v1/usage", {
      method: "GET",
      headers: {
        ...DEFAULT_HEADERS,
        Authorization: `Bearer ${apiKey.trim()}`,
      },
    }, proxyOptions);

    if (res.status === 401 || res.status === 403) {
      return { plan: "AMD Radeon AI", message: "AMD API key invalid or unauthorized." };
    }
    if (!res.ok) {
      return { plan: "AMD Radeon AI", message: `AMD usage API error (${res.status})` };
    }

    const data = await res.json();
    const dailyLimit = Number(data.daily_cost_limit_usd) || 1;
    const dailyUsed = Number(data.daily_cost_used_usd) || 0;
    const dailyRemaining = Number(data.daily_cost_remaining_usd) || Math.max(0, dailyLimit - dailyUsed);
    const remainingPct = Math.min(100, Math.max(0, (dailyRemaining / dailyLimit) * 100));

    const quotas = {
      "Daily Budget ($)": {
        used: Math.round(dailyUsed * 10000) / 10000,
        total: dailyLimit,
        remainingPercentage: Math.round(remainingPct * 10) / 10,
        resetAt: data.daily_reset_at || null,
        unlimited: false,
      },
      "RPM Limit": {
        used: 0,
        total: Number(data.rpm_limit) || 20,
        remainingPercentage: 100,
        resetAt: null,
        unlimited: false,
      },
      "All-Time Spent ($)": {
        used: Math.round((Number(data.all_time?.cost) || 0) * 10000) / 10000,
        total: 0,
        remainingPercentage: 100,
        resetAt: null,
        unlimited: true,
      },
      "All-Time Requests": {
        used: Number(data.all_time?.requests) || 0,
        total: 0,
        remainingPercentage: 100,
        resetAt: null,
        unlimited: true,
      },
    };

    return {
      plan: `AMD Radeon AI (${data.organization_id || "Active"})`,
      quotas,
    };
  } catch (err) {
    return { plan: "AMD Radeon AI", message: `Failed to fetch AMD usage: ${err.message}` };
  }
}

/**
 * VyceAI usage — GET https://vyceai.com/v1/me
 */
export async function getVyceAiUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "VyceAI API key not available." };

  try {
    const res = await proxyAwareFetch("https://vyceai.com/v1/me", {
      method: "GET",
      headers: {
        ...DEFAULT_HEADERS,
        Authorization: `Bearer ${apiKey.trim()}`,
      },
    }, proxyOptions);

    if (res.status === 401 || res.status === 403) {
      return { plan: "VyceAI", message: "VyceAI API key invalid or unauthorized." };
    }
    if (!res.ok) {
      return { plan: "VyceAI", message: `VyceAI user API error (${res.status})` };
    }

    const data = await res.json();
    const balance = Number(data.balance) || 0;
    const spent = Number(data.totalSpent) || 0;
    const spendLimit = Number(data.spendLimit) || 0;
    const total = spendLimit > 0 ? spendLimit : (balance + spent);
    const remainingPct = spendLimit > 0
      ? Math.min(100, Math.max(0, ((spendLimit - spent) / spendLimit) * 100))
      : (balance > 0 ? 100 : 0);

    const quotas = {
      "Balance ($)": {
        used: Math.round(spent * 10000) / 10000,
        total: Math.round(total * 10000) / 10000,
        remainingPercentage: Math.round(remainingPct * 10) / 10,
        resetAt: null,
        unlimited: spendLimit === 0 && balance === 0,
      },
      "Total Requests": {
        used: Number(data.totalRequests) || 0,
        total: 0,
        remainingPercentage: 100,
        resetAt: null,
        unlimited: true,
      },
    };

    if (data.rateLimit) {
      quotas["RPM Limit"] = {
        used: 0,
        total: Number(data.rateLimit),
        remainingPercentage: 100,
        resetAt: null,
        unlimited: false,
      };
    }

    return {
      plan: `VyceAI (${data.name || "Default"})`,
      quotas,
    };
  } catch (err) {
    return { plan: "VyceAI", message: `Failed to fetch VyceAI usage: ${err.message}` };
  }
}

/**
 * Helper for OpenAI billing style providers (SeekAI, AgentRouter, Ramclouds)
 */
export async function getOpenAIBillingUsage(providerName, baseUrl, apiKey, proxyOptions = null, unit = "$") {
  if (!apiKey) return { message: `${providerName} API key not available.` };

  try {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    const [subRes, usageRes] = await Promise.all([
      proxyAwareFetch(`${cleanBase}/dashboard/billing/subscription`, {
        method: "GET",
        headers: { ...DEFAULT_HEADERS, Authorization: `Bearer ${apiKey.trim()}` },
      }, proxyOptions).catch(() => null),
      proxyAwareFetch(`${cleanBase}/dashboard/billing/usage`, {
        method: "GET",
        headers: { ...DEFAULT_HEADERS, Authorization: `Bearer ${apiKey.trim()}` },
      }, proxyOptions).catch(() => null),
    ]);

    if (!subRes && !usageRes) {
      return { plan: providerName, message: `Could not reach ${providerName} billing endpoint.` };
    }

    const subData = subRes?.ok ? await subRes.json().catch(() => null) : null;
    const usageData = usageRes?.ok ? await usageRes.json().catch(() => null) : null;

    const used = Number(usageData?.total_usage) || 0;
    const hardLimit = Number(subData?.hard_limit_usd) || 0;
    const isUnlimited = !hardLimit || hardLimit >= 1000000;

    const remainingPct = isUnlimited
      ? 100
      : Math.min(100, Math.max(0, ((hardLimit - used) / hardLimit) * 100));

    const quotas = {};
    if (isUnlimited) {
      quotas[`Total Usage (${unit})`] = {
        used: Math.round(used * 10000) / 10000,
        total: 0,
        remainingPercentage: 100,
        resetAt: null,
        unlimited: true,
      };
    } else {
      quotas[`Quota (${unit})`] = {
        used: Math.round(used * 10000) / 10000,
        total: Math.round(hardLimit * 10000) / 10000,
        remainingPercentage: Math.round(remainingPct * 10) / 10,
        resetAt: null,
        unlimited: false,
      };
    }

    return {
      plan: providerName,
      quotas,
    };
  } catch (err) {
    return { plan: providerName, message: `Failed to fetch ${providerName} quota: ${err.message}` };
  }
}
