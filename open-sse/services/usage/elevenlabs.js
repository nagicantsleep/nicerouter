/**
 * ElevenLabs usage — GET https://api.elevenlabs.io/v1/user/subscription
 * Auth: xi-api-key: <apiKey>
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getElevenLabsUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "ElevenLabs API key not available." };
  }

  try {
    const res = await proxyAwareFetch(
      "https://api.elevenlabs.io/v1/user/subscription",
      {
        method: "GET",
        headers: {
          "xi-api-key": apiKey.trim(),
          Accept: "application/json",
        },
      },
      proxyOptions,
    );

    if (res.status === 401 || res.status === 403) {
      const err = await res.json().catch(() => null);
      if (err?.detail?.status === "missing_permissions") {
        return {
          plan: "ElevenLabs",
          message: "API key is missing 'user_read' permission to query subscription usage.",
        };
      }
      return { plan: "ElevenLabs", message: "ElevenLabs API key invalid or unauthorized." };
    }

    if (!res.ok) {
      return { plan: "ElevenLabs", message: `ElevenLabs API error (${res.status}).` };
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return { plan: "ElevenLabs", message: "ElevenLabs response was not JSON." };
    }

    const charCount = Number(data.character_count) || 0;
    const charLimit = Number(data.character_limit) || 0;
    const isUnlimited = charLimit <= 0;

    const remaining = Math.max(0, charLimit - charCount);
    const remainingPct = !isUnlimited ? Math.min(100, Math.max(0, (remaining / charLimit) * 100)) : 100;

    let resetAt = null;
    if (data.next_character_count_reset_unix) {
      try {
        resetAt = new Date(data.next_character_count_reset_unix * 1000).toISOString();
      } catch {}
    }

    const quotas = {
      Characters: {
        used: charCount,
        total: charLimit,
        remainingPercentage: Math.round(remainingPct * 10) / 10,
        resetAt,
        unlimited: isUnlimited,
      },
    };

    const tierName = typeof data.tier === "string"
      ? data.tier.charAt(0).toUpperCase() + data.tier.slice(1)
      : "Default";

    return {
      plan: `ElevenLabs (${tierName})`,
      quotas,
    };
  } catch (err) {
    return { plan: "ElevenLabs", message: `Failed to fetch ElevenLabs usage: ${err.message}` };
  }
}
