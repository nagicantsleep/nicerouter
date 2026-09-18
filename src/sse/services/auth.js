import { getProviderConnections, validateApiKey, updateProviderConnection, getSettings, getProxyPools } from "@/lib/localDb";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "@/lib/network/connectionProxy";
import { formatRetryAfter, checkFallbackError, isModelLockActive, buildModelLockUpdate, getEarliestModelLockUntil } from "open-sse/services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { resolveProviderId, FREE_PROVIDERS } from "@/shared/constants/providers.js";
import { getAntigravityQuotaCache } from "./antigravityQuota.js";
import * as log from "../utils/logger.js";

// Mutex to prevent race conditions during account selection
let selectionMutex = Promise.resolve();

const GITHUB_MONTHLY_USAGE_LIMIT = "you've reached your additional usage limit for your plan";

function githubMonthlyResetMs(status, errorText, provider) {
  if (resolveProviderId(provider) !== "github" || Number(status) !== 402) return null;
  if (!String(errorText || "").toLowerCase().includes(GITHUB_MONTHLY_USAGE_LIMIT)) return null;
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

/**
 * Detect daily or account-wide quota limits (e.g. AMD Cloud OneClick $1/day, billing hard limits, etc.)
 */
export function isAccountWideQuotaError(status, errorText) {
  if (!errorText) return false;
  const lower = (typeof errorText === "string" ? errorText : JSON.stringify(errorText)).toLowerCase();
  return (
    (Number(status) === 402 && (lower.includes("credit") || lower.includes("quota") || lower.includes("balance") || lower.includes("insufficient") || lower.includes("limit"))) ||
    lower.includes("daily usage limit") ||
    lower.includes("daily limit") ||
    lower.includes("per period for this") ||
    lower.includes("maximum $") ||
    lower.includes("billing_hard_limit_reached") ||
    lower.includes("insufficient_quota") ||
    lower.includes("insufficient quota") ||
    lower.includes("exceeded your current quota") ||
    lower.includes("credit balance is too low") ||
    lower.includes("account has run out of credits") ||
    lower.includes("out of credits") ||
    lower.includes("run out of credits") ||
    lower.includes("no credits") ||
    lower.includes("insufficient balance") ||
    lower.includes("balance is insufficient") ||
    lower.includes("balance insufficient") ||
    lower.includes("credit limit reached") ||
    lower.includes("usage limit reached") ||
    lower.includes("usage limit exceeded") ||
    lower.includes("free tier limit reached") ||
    lower.includes("free quota exceeded") ||
    lower.includes("plan limit exceeded") ||
    lower.includes("usage limit for your plan") ||
    lower.includes("reached your additional usage limit") ||
    lower.includes("account deactivated") ||
    lower.includes("account_deactivated") ||
    lower.includes("credit expired") ||
    ((lower.includes("quota exceeded") || lower.includes("quota_exceeded")) && (Number(status) === 429 || Number(status) === 403 || Number(status) === 503 || Number(status) === 402))
  );
}

function accountWideDailyQuotaResetMs(status, errorText) {
  if (!isAccountWideQuotaError(status, errorText)) return null;
  const now = new Date();
  const nextMidnightUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 5
  );
  // Ensure at least 1 hour cooldown, up to next midnight UTC
  const diff = nextMidnightUtc - now.getTime();
  return Date.now() + Math.max(diff, 60 * 60 * 1000);
}

/**
 * Check if a model requested on Codex is a Plus-only (expensive) model.
 * Free accounts only support Luna, GPT-5.5, GPT-5.4-mini, Spark, etc.
 * Plus accounts are required for Sol, Terra, Astra, and Image generation.
 */
export function isCodexPlusOnlyModel(model) {
  if (!model) return false;
  const m = String(model).toLowerCase();
  return m.includes("sol") || m.includes("terra") || m.includes("astra") || m.includes("image");
}

/**
 * Check if a Codex connection is a Free-tier account.
 */
export function isCodexFreeAccount(connection) {
  const plan = String(connection?.providerSpecificData?.chatgptPlanType || "").toLowerCase().trim();
  if (plan === "free") return true;
  if (plan) return false;
  const name = String(connection?.displayName || connection?.name || "").toLowerCase();
  return name.includes("free");
}

// ─── In-memory rate-limit tracking for proxy pools on no-auth providers ─────────────
const proxyRateLimits = new Map(); // `${providerId}:${proxyId}` -> expiresAt timestamp

export function recordProxyRateLimit(provider, proxyId, cooldownMs = 60000) {
  if (!provider || !proxyId) return;
  const key = `${provider}:${proxyId}`;
  const duration = Math.max(cooldownMs, 60000); // at least 1 min cooldown
  proxyRateLimits.set(key, Date.now() + duration);
  log.warn("PROXY", `[${provider}] Proxy '${proxyId}' rate limited/failed → cooldown ${Math.round(duration / 1000)}s`);
}

export function isProxyRateLimited(provider, proxyId) {
  if (!provider || !proxyId) return false;
  const key = `${provider}:${proxyId}`;
  const expiresAt = proxyRateLimits.get(key);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    proxyRateLimits.delete(key);
    return false;
  }
  return true;
}

export function resetProxyRateLimits() {
  proxyRateLimits.clear();
}

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
export async function getProviderCredentials(provider, excludeConnectionIds = null, model = null, options = {}) {
  // Normalize to Set for consistent handling
  const excludeSet = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set());
  const preferredConnectionId = options?.preferredConnectionId || null;
  // Acquire mutex to prevent race conditions
  const currentMutex = selectionMutex;
  let resolveMutex;
  selectionMutex = new Promise(resolve => { resolveMutex = resolve; });

  try {
    await currentMutex;

    // Resolve alias to provider ID (e.g., "kc" -> "kilocode")
    const providerId = resolveProviderId(provider);

    const hasNoAuthFallback = !!FREE_PROVIDERS[providerId]?.noAuth;

    // Helper to build virtual no-auth connection (with auto proxy pool failover and rotation)
    const getVirtualNoAuthConnection = async () => {
      const settings = await getSettings();
      const override = (settings.providerStrategies || {})[providerId] || {};
      const strategy = override.rotateStrategy || "none";
      const allPools = await getProxyPools({ isActive: true });
      const activePools = allPools.filter(p => p.proxyUrl);
      const activePoolIds = activePools.map(p => p.id);

      // Build candidate list in prioritized order:
      let candidates = [];
      if (strategy !== "none" && activePoolIds.length > 0) {
        if (strategy === "round-robin") {
          const picked = pickProxyPoolId(activePoolIds, "round-robin", providerId);
          candidates = [
            picked,
            ...activePoolIds.filter(id => id !== picked),
            "__direct__"
          ];
        } else {
          // random
          const shuffled = [...activePoolIds].sort(() => Math.random() - 0.5);
          candidates = [...shuffled, "__direct__"];
        }
      } else if (override.proxyPoolId && override.proxyPoolId !== "__none__") {
        candidates = [
          override.proxyPoolId,
          ...activePoolIds.filter(id => id !== override.proxyPoolId),
          "__direct__"
        ];
      } else {
        candidates = ["__direct__", ...activePoolIds];
      }

      if (excludeSet.has("noauth")) {
        return null;
      }

      // Filter candidates that have not been excluded in this retry loop and are not in persistent rate-limit cooldown
      const availableCandidates = candidates.filter(cand => {
        if (excludeSet.has(`noauth:${cand}`)) return false;
        return !isProxyRateLimited(providerId, cand);
      });

      // If all unexcluded candidates are in persistent cooldown, still attempt the first unexcluded candidate in this loop
      const pickedCandidate = availableCandidates.length > 0
        ? availableCandidates[0]
        : candidates.find(cand => !excludeSet.has(`noauth:${cand}`));

      if (!pickedCandidate) {
        // All proxy options and direct exhausted for this request
        return null;
      }

      const isDirect = pickedCandidate === "__direct__";
      const poolObj = isDirect ? null : activePools.find(p => p.id === pickedCandidate);
      const resolvedProxy = isDirect
        ? { connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: "", proxyPoolId: null, vercelRelayUrl: "" }
        : await resolveConnectionProxyConfig({ proxyPoolId: pickedCandidate });

      const poolLabel = isDirect ? "Direct" : (poolObj?.name || pickedCandidate.slice(0, 8));
      const connSuffix = (isDirect && activePoolIds.length === 0 && !override.proxyPoolId) ? "" : `:${pickedCandidate}`;
      const connId = `noauth${connSuffix}`;

      return {
        id: connId,
        connectionId: connId,
        connectionName: `Public (${poolLabel})`,
        isActive: true,
        accessToken: "public",
        providerSpecificData: {
          connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
          connectionProxyUrl: resolvedProxy.connectionProxyUrl,
          connectionNoProxy: resolvedProxy.connectionNoProxy,
          connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
          vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
        },
      };
    };

    // If provider supports no-auth free pool (e.g. OpenCode), prioritize public Free Pool first
    // unless a specific user connection is explicitly requested, or "noauth" was already tried/excluded
    const isFreePoolPreferred = hasNoAuthFallback && (!preferredConnectionId || preferredConnectionId === "noauth" || preferredConnectionId.startsWith("noauth:"));
    if (isFreePoolPreferred && !excludeSet.has("noauth")) {
      const virtualConn = await getVirtualNoAuthConnection();
      if (virtualConn) {
        log.debug("AUTH", `${provider} | Prioritizing public free pool before user key pool (${virtualConn.connectionName})`);
        return virtualConn;
      }
    }

    const connections = await getProviderConnections({ provider: providerId, isActive: true });
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`);

    if (connections.length === 0) {
      if (hasNoAuthFallback && !excludeSet.has("noauth")) {
        const virtualConn = await getVirtualNoAuthConnection();
        if (virtualConn) return virtualConn;
      }
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    // Antigravity quota cache is lazy: only populated after that account returns 409/429.
    const isAntigravity = providerId === "antigravity";
    const antigravityQuotaCache = isAntigravity && model ? getAntigravityQuotaCache() : null;

    // Codex tier-aware routing
    const isCodex = providerId === "codex";
    const isCodexPlusModel = isCodex && isCodexPlusOnlyModel(model);

    // Filter out model-locked, excluded, Antigravity quota-exhausted, and Codex tier-incompatible connections.
    let availableConnections = connections.filter(c => {
      if (excludeSet.has(c.id)) return false;
      if (isModelLockActive(c, model)) return false;
      // Codex: Free accounts cannot serve Plus-only models (sol, terra, astra, image)
      if (isCodexPlusModel && isCodexFreeAccount(c)) return false;
      // Antigravity: skip if live quota exhausted for this model
      if (isAntigravity && model && antigravityQuotaCache) {
        const quota = antigravityQuotaCache.get(c.id)?.[model];
        if (quota && quota.remainingPercentage <= 0 && quota.resetAt && new Date(quota.resetAt).getTime() > Date.now()) {
          const account = c.id?.slice(0, 8) || "unknown";
          log.info("AG_QUOTA", `${account} | CACHE_BLOCK ${model} — skip upstream until ${quota.resetAt}`);
          return false;
        }
      }
      return true;
    });

    // Codex: For Free-compatible models (e.g. Luna, GPT-5.5), prioritize Free accounts first.
    // Plus accounts are preserved in standby and only used when all Free accounts are exhausted.
    if (isCodex && !isCodexPlusModel) {
      const freeAccounts = availableConnections.filter(isCodexFreeAccount);
      if (freeAccounts.length > 0) {
        log.debug("AUTH", `codex | Prioritizing ${freeAccounts.length} Free accounts for "${model || "default"}" before Plus accounts`);
        availableConnections = freeAccounts;
      } else {
        log.debug("AUTH", `codex | All Free accounts exhausted/locked, falling back to ${availableConnections.length} Plus accounts for "${model || "default"}"`);
      }
    }

    log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    connections.forEach(c => {
      const excluded = excludeSet.has(c.id);
      const locked = isModelLockActive(c, model);
      const tierSkipped = isCodexPlusModel && isCodexFreeAccount(c);
      if (excluded || locked || tierSkipped) {
        const lockUntil = getEarliestModelLockUntil(c);
        log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ""} ${tierSkipped ? `[free-tier, ${model} requires plus]` : ""}`);
      }
    });

    if (availableConnections.length === 0) {
      // If all accounts are rate-limited or excluded, and this provider supports no-auth fallback,
      // fall back to public no-auth pool if not already excluded in this retry loop
      if (hasNoAuthFallback && !excludeSet.has("noauth")) {
        log.info("AUTH", `${provider} | all ${connections.length} accounts unavailable — falling back to public no-auth pool`);
        const virtualConn = await getVirtualNoAuthConnection();
        if (virtualConn) return virtualConn;
      }

      // Find earliest persistent lock or lazy Antigravity quota-cache reset for retry timing.
      const lockedConns = connections.filter(c => isModelLockActive(c, model));
      const expiries = lockedConns.map(c => getEarliestModelLockUntil(c)).filter(Boolean);
      if (isAntigravity && model && antigravityQuotaCache) {
        connections.forEach((c) => {
          const resetAt = antigravityQuotaCache.get(c.id)?.[model]?.resetAt;
          if (resetAt && new Date(resetAt).getTime() > Date.now()) expiries.push(resetAt);
        });
      }
      const earliest = expiries.sort()[0] || null;
      if (earliest) {
        const earliestConn = lockedConns[0];
        log.warn("AUTH", `${provider} | all ${connections.length} accounts locked for ${model || "all"} (${formatRetryAfter(earliest)}) | lastError=${earliestConn?.lastError?.slice(0, 50)}`);
        return {
          allRateLimited: true,
          retryAfter: earliest,
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError || null,
          lastErrorCode: earliestConn?.errorCode || null
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }

    const settings = await getSettings();
    // Per-provider strategy overrides global setting
    const providerOverride = (settings.providerStrategies || {})[providerId] || {};
    const strategy = providerOverride.fallbackStrategy || settings.fallbackStrategy || "fill-first";

    let connection;
    // Pin to preferred connection if specified and available
    if (preferredConnectionId) {
      connection = availableConnections.find((c) => c.id === preferredConnectionId);
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }
    if (connection) {
      // skip strategy
    } else if (strategy === "round-robin") {
      const stickyLimit = providerOverride.stickyRoundRobinLimit || settings.stickyRoundRobinLimit || 3;

      // Sort by lastUsed (most recent first) to find current candidate
      const byRecency = [...availableConnections].sort((a, b) => {
        if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt) - new Date(a.lastUsedAt);
      });

      const current = byRecency[0];
      const currentCount = current?.consecutiveUseCount || 0;

      if (current && current.lastUsedAt && currentCount < stickyLimit) {
        // Stay with current account
        connection = current;
        // Update lastUsedAt and increment count (await to ensure persistence)
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: (connection.consecutiveUseCount || 0) + 1
        });
      } else {
        // Pick the least recently used (excluding current if possible)
        const sortedByOldest = [...availableConnections].sort((a, b) => {
          if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
          if (!a.lastUsedAt) return -1;
          if (!b.lastUsedAt) return 1;
          return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
        });

        connection = sortedByOldest[0];

        // Update lastUsedAt and reset count to 1 (await to ensure persistence)
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: 1
        });
      }
    } else {
      // Default: fill-first (already sorted by priority in getProviderConnections)
      connection = availableConnections[0];
    }

    const resolvedProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});

    return {
      authType: connection.authType,
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      idToken: connection.idToken,
      expiresAt: connection.expiresAt,
      expiresIn: connection.expiresIn,
      lastRefreshAt: connection.lastRefreshAt,
      projectId: connection.projectId,
      connectionName: connection.displayName || connection.name || connection.email || connection.id,
      copilotToken: connection.providerSpecificData?.copilotToken,
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
        vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
      },
      connectionId: connection.id,
      // Include current status for optimization check
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      // Pass full connection for clearAccountError to read modelLock_* keys
      _connection: connection
    };
  } finally {
    if (resolveMutex) resolveMutex();
  }
}

/**
 * Mark account+model as unavailable — locks modelLock_${model} in DB.
 * All errors (429, 401, 5xx, etc.) lock per model, not per account.
 * @param {string} connectionId
 * @param {number} status - HTTP status code from upstream
 * @param {string} errorText
 * @param {string|null} provider
 * @param {string|null} model - The specific model that triggered the error
 * @returns {{ shouldFallback: boolean, cooldownMs: number }}
 */
export async function markAccountUnavailable(connectionId, status, errorText, provider = null, model = null, resetsAtMs = null) {
  if (!connectionId) return { shouldFallback: false, cooldownMs: 0 };
  if (connectionId === "noauth" || connectionId.startsWith("noauth:")) {
    const { shouldFallback, cooldownMs } = checkFallbackError(status, errorText, 0);
    const proxyId = connectionId.includes(":") ? connectionId.slice("noauth:".length) : null;
    if (provider && proxyId) {
      recordProxyRateLimit(provider, proxyId, cooldownMs);
    }
    return { shouldFallback, cooldownMs };
  }
  const connections = await getProviderConnections({ provider });
  const conn = connections.find(c => c.id === connectionId);
  const backoffLevel = conn?.backoffLevel || 0;

  // GitHub premium-request exhaustion is account-wide until the next UTC month.
  const githubResetAtMs = githubMonthlyResetMs(status, errorText, provider);
  const dailyQuotaResetAtMs = accountWideDailyQuotaResetMs(status, errorText);

  // Provider-specific precise cooldown (e.g. codex usage_limit_reached resets_at) overrides backoff
  let shouldFallback, cooldownMs, newBackoffLevel;
  if (githubResetAtMs) {
    shouldFallback = true;
    cooldownMs = githubResetAtMs - Date.now();
    newBackoffLevel = 0;
  } else if (dailyQuotaResetAtMs) {
    shouldFallback = true;
    cooldownMs = dailyQuotaResetAtMs - Date.now();
    newBackoffLevel = 0;
  } else if (resetsAtMs && resetsAtMs > Date.now()) {
    shouldFallback = true;
    // Antigravity quota API provides exact per-model resetAt. Do not truncate it.
    cooldownMs = resolveProviderId(provider) === "antigravity"
      ? resetsAtMs - Date.now()
      : Math.min(resetsAtMs - Date.now(), MAX_RATE_LIMIT_COOLDOWN_MS);
    newBackoffLevel = 0;
  } else {
    ({ shouldFallback, cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel));
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  const isAccountWide = !!githubResetAtMs || !!dailyQuotaResetAtMs;
  const reason = typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";
  const lockUpdate = buildModelLockUpdate(isAccountWide ? null : model, cooldownMs);

  const updateData = {
    ...lockUpdate,
    testStatus: "unavailable",
    lastError: reason,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? backoffLevel
  };

  const connName = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);

  // When quota is exhausted / daily limit reached, auto-disable the key (isActive: false)
  // to avoid repeatedly selecting and failing on this dead key.
  if (isAccountWide) {
    updateData.isActive = false;
    log.warn("AUTH", `⚠️ Auto-disabled connection ${connectionId} (${connName}) due to quota exhaustion: ${reason}`);
  }

  await updateProviderConnection(connectionId, updateData);

  const lockKey = Object.keys(lockUpdate)[0];
  log.warn("AUTH", `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}]`);

  if (provider && status && reason) {
    console.error(`❌ ${provider} [${status}]: ${reason}`);
  }

  return { shouldFallback: true, cooldownMs };
}

/**
 * Clear account error status on successful request.
 * - Clears modelLock_${model} (the model that just succeeded)
 * - Lazy-cleans any other expired modelLock_* keys
 * - Resets error state only if no active locks remain
 * @param {string} connectionId
 * @param {object} currentConnection - credentials object (has _connection) or raw connection
 * @param {string|null} model - model that succeeded
 */
export async function clearAccountError(connectionId, currentConnection, model = null) {
  if (!connectionId || connectionId === "noauth" || connectionId.startsWith("noauth:")) return;
  const conn = currentConnection._connection || currentConnection;
  const now = Date.now();
  const allLockKeys = Object.keys(conn).filter(k => k.startsWith("modelLock_"));

  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0) return;

  // Keys to clear: current model's lock + all expired locks
  const keysToClear = allLockKeys.filter(k => {
    if (model && k === `modelLock_${model}`) return true; // succeeded model
    if (model && k === "modelLock___all") return true;    // account-level lock
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() <= now;   // expired
  });

  if (keysToClear.length === 0 && conn.testStatus !== "unavailable" && !conn.lastError) return;

  // Check if any active locks remain after clearing
  const remainingActiveLocks = allLockKeys.filter(k => {
    if (keysToClear.includes(k)) return false;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() > now;
  });

  const clearObj = Object.fromEntries(keysToClear.map(k => [k, null]));

  // Only reset error state if no active locks remain
  if (remainingActiveLocks.length === 0) {
    Object.assign(clearObj, {
      testStatus: "active",
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      backoffLevel: 0
    });
  }

  await updateProviderConnection(connectionId, clearObj);
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(request) {
  // Check Authorization header first
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check Anthropic x-api-key header
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) {
    return xApiKey;
  }

  return null;
}

/**
 * Validate API key (optional - for local use can skip)
 */
export async function isValidApiKey(apiKey) {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}
