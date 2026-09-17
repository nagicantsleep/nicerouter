import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const DEFAULT_UPSTREAM_BASE = "https://www.codebuff.com";
const DEFAULT_USER_AGENT = "Freebuff-CLI/0.0.150";
const ROOT_AGENT_ID = "base2-free";
const SESSION_EXPIRY_BUFFER_MS = 10000; // 10s buffer before expiresAt

// In-memory cache for sessions and root runs, keyed by authToken
const sessionCache = new Map();

function generateClientId() {
  return crypto.randomBytes(7).toString("hex").slice(0, 13);
}

export class FreebuffExecutor extends BaseExecutor {
  constructor() {
    super("freebuff", PROVIDERS.freebuff || {
      baseUrl: DEFAULT_UPSTREAM_BASE,
      headers: { "User-Agent": DEFAULT_USER_AGENT },
    });
  }

  buildUrl() {
    return `${DEFAULT_UPSTREAM_BASE}/api/v1/chat/completions`;
  }

  buildHeaders(credentials, stream = true) {
    const token = credentials?.accessToken || credentials?.apiKey;
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": DEFAULT_USER_AGENT,
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (stream) {
      headers["Accept"] = "text/event-stream";
    }
    return headers;
  }

  /**
   * Ensure an active session and run exists for this authToken.
   */
  async ensureSessionAndRun(authToken, requestedModel, proxyOptions = null, signal = null, log = null) {
    const cached = sessionCache.get(authToken);
    const now = Date.now();

    if (
      cached &&
      cached.instanceId &&
      cached.runId &&
      cached.expiresAt > now + SESSION_EXPIRY_BUFFER_MS
    ) {
      return cached;
    }

    const headers = {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "User-Agent": DEFAULT_USER_AGENT,
      "x-freebuff-model": requestedModel || "google/gemini-2.5-flash-lite",
    };

    // Step 1: POST /api/v1/freebuff/session
    log?.debug?.("FREEBUFF", `Creating/refreshing Freebuff session for model ${requestedModel}`);
    const sessionRes = await proxyAwareFetch(
      `${DEFAULT_UPSTREAM_BASE}/api/v1/freebuff/session`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({}),
        signal,
      },
      proxyOptions
    );

    if (!sessionRes.ok) {
      const errText = await sessionRes.text().catch(() => "");
      let errMsg = errText;
      try {
        const json = JSON.parse(errText);
        errMsg = json.message || json.error || errText;
      } catch {}
      throw new Error(`Freebuff session failed (${sessionRes.status}): ${errMsg}`);
    }

    const sessionData = await sessionRes.json();
    if (sessionData.status === "queued") {
      const waitMs = sessionData.estimatedWaitMs || 5000;
      const pos = sessionData.position != null ? ` (position ${sessionData.position})` : "";
      throw new Error(`Freebuff waiting room queued${pos}. Please try again in about ${Math.round(waitMs / 1000)}s.`);
    }

    const instanceId = sessionData.instanceId;
    if (!instanceId) {
      throw new Error("Freebuff session response missing instanceId");
    }

    const expiresAt = sessionData.expiresAt
      ? Date.parse(sessionData.expiresAt)
      : now + 15 * 60 * 1000;

    // Step 2: POST /api/v1/agent-runs
    log?.debug?.("FREEBUFF", `Starting root run for Freebuff instance ${instanceId}`);
    const runRes = await proxyAwareFetch(
      `${DEFAULT_UPSTREAM_BASE}/api/v1/agent-runs`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "User-Agent": DEFAULT_USER_AGENT,
        },
        body: JSON.stringify({
          action: "START",
          agentId: ROOT_AGENT_ID,
          ancestorRunIds: [],
        }),
        signal,
      },
      proxyOptions
    );

    if (!runRes.ok) {
      const errText = await runRes.text().catch(() => "");
      let errMsg = errText;
      try {
        const json = JSON.parse(errText);
        errMsg = json.message || json.error || errText;
      } catch {}
      throw new Error(`Freebuff start run failed (${runRes.status}): ${errMsg}`);
    }

    const runData = await runRes.json();
    const runId = runData.runId;
    if (!runId) {
      throw new Error("Freebuff agent-runs response missing runId");
    }

    const sessionEntry = {
      instanceId,
      runId,
      expiresAt,
    };
    sessionCache.set(authToken, sessionEntry);
    return sessionEntry;
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const authToken = credentials?.accessToken || credentials?.apiKey;
    if (!authToken) {
      throw new Error("Freebuff requires an accessToken or apiKey (authToken)");
    }

    // Normalize model (strip freebuff/ prefix if present)
    const cleanModel = (model || "").replace(/^freebuff\//i, "");

    // 1. Ensure active session & root run
    let session;
    try {
      session = await this.ensureSessionAndRun(authToken, cleanModel, proxyOptions, signal, log);
    } catch (err) {
      log?.error?.("FREEBUFF", `Session/run negotiation failed: ${err.message}`);
      throw err;
    }

    // 2. Clone body and inject codebuff_metadata
    const payload = {
      ...body,
      model: cleanModel,
      stream: Boolean(stream),
      codebuff_metadata: {
        run_id: session.runId,
        cost_mode: "free",
        client_id: generateClientId(),
        freebuff_instance_id: session.instanceId,
      },
    };

    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials, stream);

    log?.debug?.("FREEBUFF", `Dispatching chat completion to ${url} (model=${cleanModel}, runId=${session.runId})`);

    const response = await proxyAwareFetch(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal,
      },
      proxyOptions
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      // If session expired or invalid agent hierarchy, invalidate cache
      if (response.status === 401 || response.status === 403 || errorText.includes("free_mode_invalid")) {
        sessionCache.delete(authToken);
      }
      return {
        response: new Response(errorText, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
      };
    }

    return { response };
  }

  parseError(response, bodyText) {
    let parsed = null;
    try {
      parsed = JSON.parse(bodyText || "{}");
    } catch {
      parsed = null;
    }
    const errObj = parsed?.error || parsed;
    const msg = errObj?.message || parsed?.message || bodyText || response.statusText;
    const status = Number(errObj?.code || errObj?.statusCode || response.status) || response.status;
    return {
      status,
      message: msg || `Freebuff upstream error: ${response.status}`,
    };
  }
}
