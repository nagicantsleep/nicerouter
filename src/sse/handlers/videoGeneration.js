import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings, getProviderConnectionById } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleVideoProxyCore, getVideoConfig, sanitizeSecrets } from "open-sse/handlers/videoCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import * as log from "../utils/logger.js";

// Video generation defaults to xai when no provider prefix is specified
const DEFAULT_VIDEO_PROVIDER = "xai";
const NO_AUTH_PROVIDERS = new Set(["comfyui"]);

/**
 * Poll requests carry no model, so the provider comes from the pinned
 * connection (`x-connection-id`, returned on create) or an explicit
 * `?provider=` / `x-9router-provider` header — falling back to the historical xAI default.
 */
async function resolveGetProvider(request, connectionId) {
  if (connectionId) {
    if (getVideoConfig(connectionId)) return connectionId;
    const conn = await getProviderConnectionById(connectionId).catch(() => null);
    if (conn?.provider && getVideoConfig(conn.provider)) return conn.provider;
  }
  const queried = new URL(request.url).searchParams.get("provider");
  if (queried && getVideoConfig(queried)) return queried;
  const headerProvider = request.headers.get("x-provider") || request.headers.get("x-9router-provider");
  if (headerProvider && getVideoConfig(headerProvider)) return headerProvider;
  return DEFAULT_VIDEO_PROVIDER;
}

// Creation POSTs are billable jobs — only rotate to another account for
// errors that upstream rejects BEFORE creating a job (auth/quota). A 5xx may
// have created the job, so it is returned to the caller instead of re-sent.
const CREATE_ROTATION_STATUSES = new Set([
  HTTP_STATUS.UNAUTHORIZED,
  HTTP_STATUS.FORBIDDEN,
  HTTP_STATUS.RATE_LIMITED,
]);

async function requireValidApiKey(request) {
  const apiKey = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }
  return null;
}

/**
 * Read the request body once, byte-preserving.
 * JSON bodies are additionally parsed so the `model` provider prefix can be
 * resolved (and stripped) — everything else is forwarded exactly as received.
 */
async function readForwardableBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const raw = await request.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body") };
    }
    return { raw, parsed, contentType };
  }
  // Multipart (or any other content type): forward the exact bytes — parsing
  // and re-encoding FormData would change the multipart boundary.
  const buf = Buffer.from(await request.arrayBuffer());
  return { raw: buf, parsed: null, contentType };
}

async function resolveVideoProvider(parsedBody) {
  if (!parsedBody?.model) return { provider: DEFAULT_VIDEO_PROVIDER, model: null };

  const modelStr = String(parsedBody.model);
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Combos are not supported for video generation") };
  }
  if (!getVideoConfig(modelInfo.provider)) {
    // Bare model ids (no explicit "provider/" prefix) fall back to the default
    // video provider — the prefix-less inference targets chat providers only.
    if (!modelStr.includes("/")) {
      return { provider: DEFAULT_VIDEO_PROVIDER, model: modelStr };
    }
    return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, `Provider '${modelInfo.provider}' does not support video generation`) };
  }
  return { provider: modelInfo.provider, model: modelInfo.model };
}

function withConnectionHeader(response, connectionId, provider = null) {
  const headers = new Headers(response.headers);
  // Video jobs are account-bound upstream — clients echo this back as
  // `x-connection-id` on GET polls so the same account is used.
  if (connectionId) {
    headers.set("x-9router-connection-id", String(connectionId));
  }
  if (provider) {
    headers.set("x-9router-provider", String(provider));
  }
  return new Response(response.body, { status: response.status, headers });
}

/**
 * POST /v1/videos/{generations|edits|extensions} — async job creation proxy.
 */
export async function handleVideoCreate(request, action) {
  const authError = await requireValidApiKey(request);
  if (authError) return authError;

  const bodyInfo = await readForwardableBody(request);
  if (bodyInfo.error) return bodyInfo.error;

  const resolved = await resolveVideoProvider(bodyInfo.parsed);
  if (resolved.error) return resolved.error;
  const { provider, model } = resolved;

  // Strip the provider prefix (e.g. "xai/grok-imagine-video") before forwarding;
  // otherwise forward the original bytes untouched.
  let forwardBody = bodyInfo.raw;
  if (bodyInfo.parsed && model && bodyInfo.parsed.model !== model) {
    forwardBody = JSON.stringify({ ...bodyInfo.parsed, model });
  }

  const preferredConnectionId = request.headers.get("x-connection-id") || null;
  const idempotencyKey = request.headers.get("idempotency-key") || null;

  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    let credentials = await getProviderCredentials(provider, excludeConnectionIds, model, { preferredConnectionId });

    if (!credentials && NO_AUTH_PROVIDERS.has(provider) && excludeConnectionIds.size === 0) {
      credentials = {
        provider,
        baseUrl: getVideoConfig(provider)?.baseUrl || "http://100.84.84.5:8188",
        connectionId: "comfyui-default",
      };
    }

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model || "video"}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    const result = await handleVideoProxyCore({
      provider,
      action,
      rawBody: forwardBody,
      contentType: bodyInfo.contentType || null,
      idempotencyKey,
      credentials: refreshedCredentials,
      signal: request.signal,
      log,
      onCredentialsRefreshed: async (newCreds) => {
        if (credentials.connectionId && credentials.connectionId !== "comfyui-default") {
          await updateProviderCredentials(credentials.connectionId, {
            accessToken: newCreds.accessToken,
            refreshToken: newCreds.refreshToken,
            providerSpecificData: newCreds.providerSpecificData,
            testStatus: "active",
          });
        }
      },
    });

    if (result.success) {
      if (credentials.connectionId && credentials.connectionId !== "comfyui-default") {
        await clearAccountError(credentials.connectionId, credentials, model);
      }
      log.info("VIDEO", `${provider.toUpperCase()} | ${action} accepted (connection ${credentials.connectionId})`);
      return withConnectionHeader(result.response, credentials.connectionId, provider);
    }

    // Record the failure (dashboard shows lastError/errorCode → user sees re-auth is needed)
    if (credentials.connectionId && credentials.connectionId !== "comfyui-default") {
      const { shouldFallback } = await markAccountUnavailable(
        credentials.connectionId, result.status, sanitizeSecrets(result.error, refreshedCredentials), provider, model
      );

      if (shouldFallback && CREATE_ROTATION_STATUSES.has(result.status)) {
        excludeConnectionIds.add(credentials.connectionId);
        lastError = result.error;
        lastStatus = result.status;
        continue;
      }
    }

    return result.response;
  }
}

/**
 * GET /v1/videos/{request_id} — poll job status.
 * Jobs are account-bound upstream, so no cross-account rotation here: the
 * caller pins the creating account via `x-connection-id` (returned on create).
 */
export async function handleVideoGet(request, requestId) {
  const authError = await requireValidApiKey(request);
  if (authError) return authError;

  if (!requestId) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing video request id");

  const preferredConnectionId = request.headers.get("x-connection-id") || null;
  const provider = await resolveGetProvider(request, preferredConnectionId);

  let credentials = await getProviderCredentials(provider, null, null, { preferredConnectionId });
  if (!credentials && NO_AUTH_PROVIDERS.has(provider)) {
    credentials = {
      provider,
      baseUrl: getVideoConfig(provider)?.baseUrl || "http://100.84.84.5:8188",
      connectionId: "comfyui-default",
    };
  }
  if (!credentials || credentials.allRateLimited) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
  }

  const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

  const result = await handleVideoProxyCore({
    provider,
    requestId,
    credentials: refreshedCredentials,
    signal: request.signal,
    log,
    onCredentialsRefreshed: async (newCreds) => {
      if (credentials.connectionId && credentials.connectionId !== "comfyui-default") {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active",
        });
      }
    },
  });

  if (result.success) {
    if (credentials.connectionId && credentials.connectionId !== "comfyui-default") {
      await clearAccountError(credentials.connectionId, credentials, null);
    }
    return withConnectionHeader(result.response, credentials.connectionId, provider);
  }

  if (credentials.connectionId && credentials.connectionId !== "comfyui-default") {
    await markAccountUnavailable(
      credentials.connectionId, result.status, sanitizeSecrets(result.error, refreshedCredentials), provider, null
    );
  }
  return result.response;
}
