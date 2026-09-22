import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels, autoDisableComboModel } from "../services/model.js";
import { handleSystemoneCore } from "open-sse/handlers/systemoneCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { saveRequestUsage } from "@/lib/usageDb.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { PROVIDERS } from "open-sse/config/providers.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { parseModel, resolveProviderAlias } from "open-sse/services/model.js";

/**
 * Handle a single model execution for System One request
 */
async function handleSingleModelSystemOne(body, modelStr, request, apiKey, url) {
  let { provider, model } = parseModel(modelStr);
  const resolvedProvider = resolveProviderAlias(provider) || provider || "typesafe";
  if (!model) {
    model = modelStr.includes("/") ? modelStr.split("/")[1] : modelStr;
  }
  if (!model) {
    model = "jev-latest";
  }

  // Case 1: OpenCode provider (e.g. oc/jev-1.13-free)
  if (
    resolvedProvider === "opencode" ||
    resolvedProvider === "oc" ||
    resolvedProvider === "opencode-zen" ||
    resolvedProvider === "zen" ||
    resolvedProvider === "ocz"
  ) {
    const excludeConnectionIds = new Set();
    let lastError = null;
    let lastStatus = null;

    while (true) {
      const credentials = await getProviderCredentials(resolvedProvider, excludeConnectionIds, model);
      const token = credentials?.apiKey || (credentials?.accessToken && credentials.accessToken !== "public" ? credentials.accessToken : null);
      const customBase = credentials?.providerSpecificData?.baseUrl || PROVIDERS.opencode?.baseUrl || "https://opencode.ai";
      const targetUrl = `${customBase.replace(/\/$/, "")}/zen/v1/systemone`;

      const proxyOptions = {
        connectionProxyEnabled: credentials?.providerSpecificData?.connectionProxyEnabled === true,
        connectionProxyUrl: credentials?.providerSpecificData?.connectionProxyUrl || "",
        connectionNoProxy: credentials?.providerSpecificData?.connectionNoProxy || "",
      };

      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: token ? `Bearer ${token}` : "Bearer public",
        "x-opencode-client": "desktop",
      };

      const requestPayload = { ...body, model };

      try {
        const response = await proxyAwareFetch(
          targetUrl,
          {
            method: "POST",
            headers,
            body: JSON.stringify(requestPayload),
          },
          proxyOptions
        );

        if (response.ok) {
          if (credentials?.connectionId) clearAccountError(credentials.connectionId);
          const data = await response.json();
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const errorText = await response.text();
        lastStatus = response.status;
        lastError = errorText || `OpenCode upstream status ${response.status}`;

        if (credentials?.connectionId && (response.status === 429 || response.status >= 500)) {
          markAccountUnavailable(credentials.connectionId, lastError, response.status);
          excludeConnectionIds.add(credentials.connectionId);
          const nextCreds = await getProviderCredentials(resolvedProvider, excludeConnectionIds, model);
          if (nextCreds) continue;
        }

        return new Response(errorText, {
          status: response.status,
          headers: { "Content-Type": response.headers.get("content-type") || "application/json" },
        });
      } catch (err) {
        lastError = err.message;
        lastStatus = HTTP_STATUS.BAD_GATEWAY;
        if (credentials?.connectionId) {
          markAccountUnavailable(credentials.connectionId, lastError, lastStatus);
          excludeConnectionIds.add(credentials.connectionId);
        }
        const nextCreds = await getProviderCredentials(resolvedProvider, excludeConnectionIds, model);
        if (nextCreds) continue;
        return errorResponse(lastStatus, lastError);
      }
    }
  }

  // Case 2: TypeSafe AI provider (direct REST endpoint)
  if (
    resolvedProvider === "typesafe" ||
    resolvedProvider === "typesafe-ai" ||
    resolvedProvider === "typesage" ||
    resolvedProvider === "typesage-ai" ||
    resolvedProvider === "ts"
  ) {
    const excludeConnectionIds = new Set();
    let lastError = null;
    let lastStatus = null;

    while (true) {
      const credentials = await getProviderCredentials(resolvedProvider, excludeConnectionIds, model);

      if (!credentials || credentials.allRateLimited) {
        if (!credentials && excludeConnectionIds.size === 0) {
          return errorResponse(HTTP_STATUS.NOT_FOUND, `No credentials for provider: ${resolvedProvider}`);
        }
        return unavailableResponse(
          lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE,
          `[typesafe/${model}] ${lastError || credentials?.lastError || "Unavailable"}`,
          credentials?.retryAfter,
          credentials?.retryAfterHuman
        );
      }

      const token = credentials.apiKey || credentials.accessToken;
      const targetUrl = credentials?.providerSpecificData?.baseUrl || "https://api.typesafe.ai/v1/systemone";

      const proxyOptions = {
        connectionProxyEnabled: credentials?.providerSpecificData?.connectionProxyEnabled === true,
        connectionProxyUrl: credentials?.providerSpecificData?.connectionProxyUrl || "",
        connectionNoProxy: credentials?.providerSpecificData?.connectionNoProxy || "",
      };

      const requestPayload = { ...body, model };

      try {
        const response = await proxyAwareFetch(
          targetUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(requestPayload),
          },
          proxyOptions
        );

        if (response.ok) {
          clearAccountError(credentials.connectionId);
          const data = await response.json();
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const errorText = await response.text();
        lastStatus = response.status;
        lastError = errorText || `Upstream returned status ${response.status}`;

        if (response.status === 429 || response.status >= 500) {
          markAccountUnavailable(credentials.connectionId, lastError, response.status);
          excludeConnectionIds.add(credentials.connectionId);
          continue;
        }

        return new Response(errorText, {
          status: response.status,
          headers: { "Content-Type": response.headers.get("content-type") || "application/json" },
        });
      } catch (err) {
        lastError = err.message;
        lastStatus = HTTP_STATUS.BAD_GATEWAY;
        markAccountUnavailable(credentials.connectionId, lastError, lastStatus);
        excludeConnectionIds.add(credentials.connectionId);
      }
    }
  }

  // Case 3: Standard providers via handleSystemoneCore
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(resolvedProvider, excludeConnectionIds, model);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("SYSTEMONE", `[${resolvedProvider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${resolvedProvider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${resolvedProvider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${resolvedProvider}`);
      }
      log.warn("SYSTEMONE", "No more accounts available", { provider: resolvedProvider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${resolvedProvider} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(resolvedProvider, credentials);

    const result = await handleSystemoneCore({
      body,
      modelInfo: { provider: resolvedProvider, model },
      credentials: refreshedCredentials,
      log,
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      }
    });

    if (result.success) {
      if (result.usage && url && saveRequestUsage) {
        saveRequestUsage({
          provider: resolvedProvider,
          model,
          connectionId: credentials.connectionId,
          apiKey,
          endpoint: url.pathname,
          tokens: {
            ...result.usage,
            total_tokens: result.usage.prompt_tokens + result.usage.completion_tokens,
          },
          status: "success",
        }).catch(() => {});
      }
      return result.response;
    }

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, resolvedProvider, model);

    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}

/**
 * Handle System One (Jev) decision requests for the Next.js server.
 * Supports direct model calls, provider aliases, and combos with fallback.
 *
 * @param {Request} request
 */
export async function handleSystemone(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("SYSTEMONE", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const requestedModel = body.model || "jev-latest";

  log.request("POST", `${url.pathname} | ${requestedModel}`);

  // Log API key (masked)
  const apiKey = extractApiKey(request);
  if (apiKey) {
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!requestedModel) {
    log.warn("SYSTEMONE", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Check if requestedModel is a combo
  const comboModels = await getComboModels(requestedModel);
  if (comboModels) {
    if (comboModels.disabled) {
      return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, `Combo "${requestedModel}" is disabled.`);
    }
    if (comboModels.length === 0) {
      return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, `All models in combo "${requestedModel}" are disabled.`);
    }
    const comboStrategies = settings.comboStrategies || {};
    const comboStrategy = comboStrategies[requestedModel]?.fallbackStrategy || settings.comboStrategy || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("SYSTEMONE", `Combo "${requestedModel}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelSystemOne(b, m, request, apiKey, url),
      log,
      comboName: requestedModel,
      comboStrategy,
      comboStickyLimit,
      onModelQuotaExceeded: autoDisableComboModel,
    });
  }

  // Single model execution
  return handleSingleModelSystemOne(body, requestedModel, request, apiKey, url);
}

export const handleSystemOne = handleSystemone;
