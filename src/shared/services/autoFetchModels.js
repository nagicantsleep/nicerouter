// Background model health & prune service.
// Periodically checks custom & free-tier providers to prune models that are no longer available or no longer free.
// NEVER touches Auth providers (OAuth / CLI) or Decolua original built-in providers.
// NEVER auto-adds models (adding is done via user-controlled UI modal).

import { getCustomModels, deleteCustomModel, getProviderNodes } from "../../lib/localDb.js";
import { getProviderAlias } from "../constants/providers.js";
import { getProviderLiveModels } from "../../app/api/providers/[id]/models/route.js";

export const DEFAULT_AUTO_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const INITIAL_DELAY_MS = 60 * 1000; // 1 min after startup

export const PRUNE_TARGET_PROVIDERS = [
  // Free-tier providers
  { id: "openrouter", freeOnly: true },
  { id: "poolside", freeOnly: true },
  { id: "nvidia", freeOnly: false },
  { id: "opencode", freeOnly: true },
  { id: "opencode-go", freeOnly: false },
  { id: "cloudflare-ai", freeOnly: false },
  { id: "api-airforce", freeOnly: true },
  // Integrated dynamic API key providers
  { id: "ramclouds", freeOnly: false },
  { id: "seekai", freeOnly: false },
  { id: "agentrouter", freeOnly: false },
  { id: "vyceai", freeOnly: false },
  { id: "kiraai", freeOnly: false },
  { id: "orca", freeOnly: false },
  { id: "bai", freeOnly: false },
  { id: "atria", freeOnly: false },
  { id: "qoder", freeOnly: false },
  { id: "cline", freeOnly: false },
  { id: "clinepass", freeOnly: false },
];

let started = false;
let intervalHandle = null;
let initialTimeoutHandle = null;
let tickRunning = false;

function isTruthyEnv(value) {
  if (value == null || value === "") return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function isNonServerRuntime() {
  if (typeof window !== "undefined") return true;
  const phase = process.env.NEXT_PHASE || "";
  if (
    phase === "phase-production-build" ||
    phase === "phase-export" ||
    phase === "phase-static"
  ) {
    return true;
  }
  if (process.env.NEXT_RUNTIME === "edge") return true;
  return false;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a single auto-prune tick:
 * Identifies and removes custom models that have been deprecated or dropped upstream.
 * @returns {Promise<{ scanned: number, pruned: number, errors: Record<string, string> }>}
 */
export async function runAutoPruneModelsTick() {
  if (tickRunning) return { scanned: 0, pruned: 0, errors: { status: "already_running" } };
  tickRunning = true;

  const result = { scanned: 0, pruned: 0, errors: {} };

  try {
    const allCustomModels = await getCustomModels();
    if (!Array.isArray(allCustomModels) || allCustomModels.length === 0) {
      return result;
    }

    // Build list of targets: static targets + dynamic custom nodes
    const targets = [...PRUNE_TARGET_PROVIDERS];
    try {
      const customNodes = await getProviderNodes();
      for (const node of customNodes || []) {
        if (node?.id) {
          targets.push({ id: node.id, freeOnly: false, isNode: true, prefix: node.prefix });
        }
      }
    } catch {
      // Ignore custom nodes query failure
    }

    for (const target of targets) {
      const providerId = target.id;
      const providerAlias = target.prefix || getProviderAlias(providerId) || providerId;

      // Find all custom models currently saved for this provider
      const savedForProvider = allCustomModels.filter(
        (m) => m.providerAlias === providerAlias && (m.type || m.kind || "llm") === "llm"
      );

      // If user has not added any custom model for this provider, skip
      if (savedForProvider.length === 0) continue;

      try {
        const liveResult = await getProviderLiveModels(providerId, { freeOnly: target.freeOnly });
        if (!liveResult || liveResult.error || !Array.isArray(liveResult.models)) {
          // If connection is inactive or not configured, don't prune (avoid false positives)
          if (liveResult?.error && !liveResult.error.includes("No active connection found")) {
            result.errors[providerId] = liveResult.error;
          }
          continue;
        }

        result.scanned += 1;
        let liveModels = liveResult.models;

        // OpenRouter strict :free pattern filter
        if (providerId === "openrouter") {
          liveModels = liveModels.filter(
            (m) => String(m.id).endsWith(":free") || (m.pricing?.prompt === "0" && m.pricing?.completion === "0")
          );
        }

        // Qoder clean ID prefix
        if (providerId === "qoder") {
          liveModels = liveModels.map((m) => ({
            ...m,
            id: String(m.id || m.name).replace(/^qoder\//, ""),
          }));
        }

        const validLiveIds = new Set(liveModels.map((m) => m.id || m.name).filter(Boolean));

        // If upstream returned 0 models (e.g. temporary glitch or empty response),
        // do not prune all saved models at once to protect against temporary upstream downtime
        if (validLiveIds.size === 0) continue;

        for (const customEntry of savedForProvider) {
          if (!validLiveIds.has(customEntry.id)) {
            await deleteCustomModel({
              providerAlias,
              id: customEntry.id,
              type: customEntry.type || "llm",
            });
            result.pruned += 1;
            console.log(`[AutoPruneModels] Pruned dead/expired model "${customEntry.id}" from ${providerId} (${providerAlias})`);
          }
        }
      } catch (err) {
        result.errors[providerId] = err.message;
      }

      await sleep(150);
    }
  } catch (err) {
    console.error("[AutoPruneModels] Tick error (swallowed):", err.message);
  } finally {
    tickRunning = false;
  }

  return result;
}

export function startAutoPruneModels({ intervalMs, initialDelayMs } = {}) {
  if (started) return false;
  if (isTruthyEnv(process.env.DISABLE_AUTO_PRUNE_MODELS) || isTruthyEnv(process.env.DISABLE_AUTO_FETCH_MODELS)) return false;
  if (isNonServerRuntime()) return false;

  started = true;
  const period = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_AUTO_PRUNE_INTERVAL_MS;
  const firstDelay = Number.isFinite(initialDelayMs) && initialDelayMs >= 0 ? initialDelayMs : INITIAL_DELAY_MS;

  const safeTick = () => {
    runAutoPruneModelsTick().catch((err) => {
      console.warn("[AutoPruneModels] Unhandled tick rejection (swallowed):", err.message);
    });
  };

  initialTimeoutHandle = setTimeout(safeTick, firstDelay);
  if (initialTimeoutHandle.unref) initialTimeoutHandle.unref();

  intervalHandle = setInterval(safeTick, period);
  if (intervalHandle.unref) intervalHandle.unref();

  console.log(`[AutoPruneModels] Service started (period: ${Math.round(period / 3600000)}h, initial delay: ${Math.round(firstDelay / 1000)}s)`);
  return true;
}

export function stopAutoPruneModels() {
  if (initialTimeoutHandle) {
    clearTimeout(initialTimeoutHandle);
    initialTimeoutHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  started = false;
}

// Backward compatibility exports
export const startAutoFetchModels = startAutoPruneModels;
export const stopAutoFetchModels = stopAutoPruneModels;
export const runAutoFetchModelsTick = runAutoPruneModelsTick;
export const TARGET_PROVIDERS = PRUNE_TARGET_PROVIDERS;
export const DEFAULT_AUTO_FETCH_INTERVAL_MS = DEFAULT_AUTO_PRUNE_INTERVAL_MS;
