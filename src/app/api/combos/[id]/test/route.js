import { NextResponse } from "next/server";
import { getComboById, getProviderConnections, getSettings, getApiKeys, getProviderNodes } from "../../../../../lib/localDb";
import { resolveProviderAlias } from "../../../../../../open-sse/services/model.js";
import { getConsistentMachineId } from "../../../../../shared/utils/machineId";

const CLI_TOKEN_SALT = "9r-cli-auth";

/**
 * Parse a model string or object from combo.models
 * @param {string|object} entry
 * @returns {{ modelStr: string, provider: string, modelName: string, enabled: boolean }}
 */
export function parseModelString(entry) {
  if (typeof entry === "string") {
    const hasSlash = entry.includes("/");
    const firstSlash = entry.indexOf("/");
    const provider = hasSlash ? entry.slice(0, firstSlash) : entry;
    const modelName = hasSlash ? entry.slice(firstSlash + 1) : entry;
    return {
      modelStr: entry,
      provider,
      modelName,
      enabled: true,
    };
  }
  if (typeof entry === "object" && entry !== null) {
    const model = entry.model || "";
    const hasSlash = model.includes("/");
    const firstSlash = model.indexOf("/");
    const provider = hasSlash ? model.slice(0, firstSlash) : model;
    const modelName = hasSlash ? model.slice(firstSlash + 1) : model;
    return {
      modelStr: model,
      provider,
      modelName,
      enabled: entry.enabled !== false,
    };
  }
  return {
    modelStr: String(entry),
    provider: String(entry),
    modelName: String(entry),
    enabled: true,
  };
}

/**
 * Identify fallback reason from status and error message
 * @param {number} status
 * @param {string} errorMessage
 * @returns {string}
 */
export function getFallbackReason(status, errorMessage = "") {
  const msg = String(errorMessage || "");
  const lower = msg.toLowerCase();

  if (lower.includes("no active connection") || lower.includes("no active credential")) {
    return "No active credentials configured";
  }
  if (lower.includes("locked in cooldown")) {
    return "Account locked in cooldown";
  }
  if (status === 429 || lower.includes("quota") || lower.includes("rate limit") || lower.includes("limit exceeded")) {
    return "Rate limit / Quota exceeded (429)";
  }
  if (status === 502 || status === 503 || lower.includes("service unavailable") || lower.includes("bad gateway") || lower.includes("upstream")) {
    return "Upstream provider unavailable (503/502)";
  }
  if (status === 401 || status === 403 || lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("invalid api key") || lower.includes("access")) {
    return "Authentication / API key error (401/403)";
  }
  return msg || `Error (HTTP ${status || "unknown"})`;
}

/**
 * Resolves active connections for a given provider alias/prefix
 */
async function resolveConnections(providerPrefix) {
  // 1. Try raw provider string first (matches unit test mocks and providers with exact id)
  let conns = await getProviderConnections({ provider: providerPrefix });
  if (conns && conns.length > 0) return conns;

  // 2. Try resolving provider alias (e.g. cx -> codex, rc -> ramclouds)
  try {
    const resolvedId = resolveProviderAlias(providerPrefix);
    if (resolvedId && resolvedId !== providerPrefix) {
      conns = await getProviderConnections({ provider: resolvedId });
      if (conns && conns.length > 0) return conns;
    }
  } catch {}

  // 3. Try resolving custom provider node prefix (e.g. vb, cr, sa, ka)
  try {
    if (typeof getProviderNodes === "function") {
      const allNodes = await getProviderNodes();
      const matchedNode = allNodes?.find(
        (n) => n.prefix === providerPrefix || n.data?.prefix === providerPrefix
      );
      if (matchedNode) {
        conns = await getProviderConnections({ provider: matchedNode.id });
        if (conns && conns.length > 0) return conns;
      }
    }
  } catch {}

  return [];
}

async function getAuthHeaders() {
  let apiKey = null;
  try {
    const keys = await getApiKeys();
    apiKey = keys?.find((k) => k.isActive !== false)?.key || null;
  } catch {}

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  try {
    headers["x-9r-cli-token"] = await getConsistentMachineId(CLI_TOKEN_SALT);
  } catch {}
  return headers;
}

/**
 * Executes the full combo fallback trace, optionally streaming events
 */
export async function executeComboTrace({ combo, prompt = "Say hello in 1 word", testAll = false, onEvent = null }) {
  let rawModels = [];
  if (Array.isArray(combo.models)) {
    rawModels = combo.models;
  } else if (typeof combo.models === "string") {
    try {
      rawModels = JSON.parse(combo.models);
    } catch {
      rawModels = [];
    }
  }

  const parsedModels = rawModels.map(parseModelString);
  const steps = [];
  let winningModel = null;
  let winningStep = null;
  let winningOutput = null;
  let totalLatencyMs = 0;

  const port = process.env.PORT || 20128;
  const baseUrl = `http://127.0.0.1:${port}`;
  const headers = await getAuthHeaders();

  if (onEvent) {
    onEvent({
      type: "init",
      comboId: combo.id,
      comboName: combo.name,
      totalModels: parsedModels.length,
      models: parsedModels.map((m, idx) => ({
        step: idx + 1,
        model: m.modelStr,
        provider: m.provider,
        enabled: m.enabled,
      })),
    });
  }

  for (let i = 0; i < parsedModels.length; i++) {
    const item = parsedModels[i];
    const stepNumber = i + 1;
    const nextModelItem = i < parsedModels.length - 1 ? parsedModels[i + 1] : null;
    const nextFallbackAction = nextModelItem ? `fallback_to_${nextModelItem.modelStr}` : "end_all_failed";

    // If already served and not testAll, mark subsequent steps as not_needed
    if (winningModel && !testAll) {
      const stepData = {
        step: stepNumber,
        model: item.modelStr,
        provider: item.provider,
        ok: false,
        skipped: true,
        latencyMs: null,
        status: null,
        error: null,
        fallbackReason: null,
        nextAction: "not_needed",
      };
      steps.push(stepData);
      if (onEvent) onEvent({ type: "step_complete", step: stepNumber, stepData });
      continue;
    }

    if (onEvent) {
      onEvent({
        type: "step_start",
        step: stepNumber,
        model: item.modelStr,
        provider: item.provider,
      });
    }

    // Check if disabled in combo
    if (!item.enabled) {
      const stepData = {
        step: stepNumber,
        model: item.modelStr,
        provider: item.provider,
        ok: false,
        skipped: true,
        latencyMs: null,
        status: null,
        error: "Model disabled in combo settings",
        fallbackReason: "Model disabled in combo",
        nextAction: nextFallbackAction,
      };
      steps.push(stepData);
      if (onEvent) onEvent({ type: "step_complete", step: stepNumber, stepData });
      continue;
    }

    // Resolve connections
    const conns = await resolveConnections(item.provider);
    const activeConns = conns.filter((c) => c.isActive !== false);

    if (activeConns.length === 0) {
      const errorMsg = `No active connections configured for provider "${item.provider}"`;
      const stepData = {
        step: stepNumber,
        model: item.modelStr,
        provider: item.provider,
        ok: false,
        skipped: true,
        latencyMs: 0,
        status: 500,
        error: errorMsg,
        fallbackReason: getFallbackReason(500, errorMsg),
        nextAction: nextFallbackAction,
      };
      steps.push(stepData);
      if (onEvent) onEvent({ type: "step_complete", step: stepNumber, stepData });
      continue;
    }

    // Check for lock / cooldown
    const now = new Date();
    let allLocked = true;
    let earliestCooldownUntil = null;
    let lastLockError = null;
    let lockStatusCode = 429;

    for (const conn of activeConns) {
      const lockAll = conn.modelLock___all ? new Date(conn.modelLock___all) : null;
      const lockModelKey = `modelLock_${item.modelName}`;
      const lockModel = conn[lockModelKey] ? new Date(conn[lockModelKey]) : null;
      const rateLimit = conn.rateLimitedUntil ? new Date(conn.rateLimitedUntil) : null;

      const effectiveLock = lockAll && lockAll > now ? lockAll :
        lockModel && lockModel > now ? lockModel :
        rateLimit && rateLimit > now ? rateLimit : null;

      if (effectiveLock) {
        if (!earliestCooldownUntil || effectiveLock < earliestCooldownUntil) {
          earliestCooldownUntil = effectiveLock;
          lastLockError = conn.lastError || "All accounts locked in cooldown until tomorrow";
          lockStatusCode = conn.errorCode || 429;
        }
      } else {
        allLocked = false;
        break;
      }
    }

    if (allLocked && earliestCooldownUntil) {
      const cooldownStr = earliestCooldownUntil.toISOString();
      const stepData = {
        step: stepNumber,
        model: item.modelStr,
        provider: item.provider,
        ok: false,
        skipped: true,
        latencyMs: 0,
        status: lockStatusCode,
        error: lastLockError || "All accounts locked in cooldown",
        cooldownUntil: cooldownStr,
        fallbackReason: getFallbackReason(lockStatusCode, lastLockError || "locked in cooldown"),
        nextAction: nextFallbackAction,
      };
      steps.push(stepData);
      if (onEvent) onEvent({ type: "step_complete", step: stepNumber, stepData });
      continue;
    }

    // Perform the test request via fetch
    const startMs = Date.now();
    let fetchRes = null;
    let rawText = "";
    let parsedData = null;
    let stepLatencyMs = 0;

    try {
      fetchRes = await fetch(`${baseUrl}/api/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: item.modelStr,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 50,
          stream: false,
        }),
      });
      stepLatencyMs = Date.now() - startMs;
      totalLatencyMs += stepLatencyMs;
      rawText = await fetchRes.text();
      try {
        parsedData = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsedData = null;
      }
    } catch (err) {
      stepLatencyMs = Date.now() - startMs;
      totalLatencyMs += stepLatencyMs;
      const stepData = {
        step: stepNumber,
        model: item.modelStr,
        provider: item.provider,
        ok: false,
        skipped: false,
        latencyMs: stepLatencyMs,
        status: 500,
        error: err.message || "Network request failed",
        fallbackReason: getFallbackReason(500, err.message),
        nextAction: nextFallbackAction,
      };
      steps.push(stepData);
      if (onEvent) onEvent({ type: "step_complete", step: stepNumber, stepData });
      continue;
    }

    if (fetchRes.ok) {
      const output = parsedData?.choices?.[0]?.message?.content ||
        parsedData?.choices?.[0]?.text ||
        "Success";

      const stepData = {
        step: stepNumber,
        model: item.modelStr,
        provider: item.provider,
        ok: true,
        skipped: false,
        latencyMs: stepLatencyMs,
        status: fetchRes.status,
        outputPreview: output,
        nextAction: "served",
      };
      steps.push(stepData);
      if (onEvent) onEvent({ type: "step_complete", step: stepNumber, stepData });

      if (!winningModel) {
        winningModel = item.modelStr;
        winningStep = stepNumber;
        winningOutput = output;
      }
    } else {
      const errorDetail = parsedData?.error?.message ||
        parsedData?.error ||
        parsedData?.message ||
        rawText ||
        "Request failed";

      const stepData = {
        step: stepNumber,
        model: item.modelStr,
        provider: item.provider,
        ok: false,
        skipped: false,
        latencyMs: stepLatencyMs,
        status: fetchRes.status,
        error: String(errorDetail).slice(0, 500),
        fallbackReason: getFallbackReason(fetchRes.status, errorDetail),
        nextAction: nextFallbackAction,
      };
      steps.push(stepData);
      if (onEvent) onEvent({ type: "step_complete", step: stepNumber, stepData });
    }
  }

  const overallStatus = winningModel ? "success" : "all_failed";

  return {
    comboId: combo.id,
    comboName: combo.name,
    overallStatus,
    winningModel,
    winningStep,
    winningOutput,
    totalLatencyMs,
    steps,
  };
}

/**
 * POST /api/combos/[id]/test - Test combo fallback execution trace
 */
export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const comboId = resolvedParams?.id;

    const combo = await getComboById(comboId);
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    let body = {};
    try {
      body = await request.json();
    } catch {}

    const prompt = body?.prompt || "Say hello in 1 word";
    const testAll = Boolean(body?.testAll);
    const stream = Boolean(body?.stream);

    if (stream) {
      const encoder = new TextEncoder();
      const customStream = new ReadableStream({
        async start(controller) {
          function send(event) {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            } catch {}
          }

          try {
            const finalResult = await executeComboTrace({
              combo,
              prompt,
              testAll,
              onEvent: (event) => send(event),
            });
            send({ type: "complete", ...finalResult });
          } catch (err) {
            send({ type: "error", error: err.message || "Failed to execute combo test" });
          } finally {
            try {
              controller.close();
            } catch {}
          }
        },
      });

      return new Response(customStream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
        },
      });
    }

    const result = await executeComboTrace({ combo, prompt, testAll });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[ComboTest] Unexpected error:", error);
    return NextResponse.json({ error: error.message || "Failed to execute combo test" }, { status: 500 });
  }
}
