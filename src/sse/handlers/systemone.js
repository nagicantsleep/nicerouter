import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import * as log from "../utils/logger.js";
import { PROVIDERS } from "open-sse/config/providers.js";
import { getComboModels, autoDisableComboModel } from "../services/model.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { parseModel, resolveProviderAlias } from "open-sse/services/model.js";

/**
 * Handle a single model execution for System One request
 */
async function handleSingleModelSystemOne(body, modelStr, request) {
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
          const nextCreds = await getProviderCredentials(resolvedProvider, excludeConnectionIds, model);
          if (nextCreds) continue;
        }
        return errorResponse(HTTP_STATUS.BAD_GATEWAY, `Failed to reach OpenCode: ${err.message}`);
      }
    }
  }

  // Case 2: OpenRouter provider
  if (resolvedProvider === "openrouter") {
    const credentials = await getProviderCredentials("openrouter", new Set(), model);
    const token = credentials?.apiKey || credentials?.accessToken;
    if (!token) {
      return errorResponse(HTTP_STATUS.NOT_FOUND, "No active credentials for provider: openrouter.");
    }
    const targetUrl = "https://openrouter.ai/api/alpha/decisions";
    const proxyOptions = {
      connectionProxyEnabled: credentials?.providerSpecificData?.connectionProxyEnabled === true,
      connectionProxyUrl: credentials?.providerSpecificData?.connectionProxyUrl || "",
      connectionNoProxy: credentials?.providerSpecificData?.connectionNoProxy || "",
    };
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
          body: JSON.stringify({ ...body, model }),
        },
        proxyOptions
      );
      const text = await response.text();
      return new Response(text, {
        status: response.status,
        headers: { "Content-Type": response.headers.get("content-type") || "application/json" },
      });
    } catch (err) {
      return errorResponse(HTTP_STATUS.BAD_GATEWAY, `Failed to reach OpenRouter: ${err.message}`);
    }
  }

  // Case 3: Default TypeSafe provider (e.g. typesafe/jev-latest, or bare jev-latest)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials("typesafe", excludeConnectionIds, model);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        log.warn("SYSTEMONE", `[typesafe/${model}] ${errorMsg}`);
        return unavailableResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, errorMsg);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", "No active credentials for provider: typesafe");
        return errorResponse(
          HTTP_STATUS.NOT_FOUND,
          "No active credentials for provider: typesafe. Please add a TypeSafe API key in Dashboard."
        );
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const token = credentials.apiKey || credentials.accessToken;
    const customBase = credentials?.providerSpecificData?.baseUrl;
    const targetUrl = customBase
      ? (customBase.replace(/\/$/, "").endsWith("/systemone")
          ? customBase
          : `${customBase.replace(/\/$/, "")}/systemone`)
      : (PROVIDERS.typesafe?.baseUrl || "https://api.typesafe.ai/v1/systemone");

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

      // Upstream returned error
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

/**
 * Handle direct System One requests (POST /v1/systemone)
 * Compatible with TypeSafe official SDKs, direct REST calls, and combo routing.
 */
export async function handleSystemOne(request) {
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

  // Authentication check
  const apiKey = extractApiKey(request);
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
      handleSingleModel: (b, m) => handleSingleModelSystemOne(b, m, request),
      log,
      comboName: requestedModel,
      comboStrategy,
      comboStickyLimit,
      onModelQuotaExceeded: autoDisableComboModel,
    });
  }

  // Single model execution
  return handleSingleModelSystemOne(body, requestedModel, request);
}
