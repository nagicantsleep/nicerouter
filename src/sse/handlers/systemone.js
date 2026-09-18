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

/**
 * Handle direct System One requests (POST /v1/systemone)
 * Compatible with TypeSafe official SDKs and direct REST calls.
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
  const model = body.model || "jev-latest";

  log.request("POST", `${url.pathname} | typesafe/${model}`);

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

  // Retrieve TypeSafe credentials with account fallback
  const provider = "typesafe";
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        log.warn("SYSTEMONE", `[${provider}/${model}] ${errorMsg}`);
        return unavailableResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, errorMsg);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}. Please add a TypeSafe API key in Dashboard.`);
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const token = credentials.apiKey || credentials.accessToken;
    const customBase = credentials?.providerSpecificData?.baseUrl;
    const targetUrl = customBase
      ? (customBase.replace(/\/$/, "").endsWith("/systemone") ? customBase : `${customBase.replace(/\/$/, "")}/systemone`)
      : (PROVIDERS.typesafe?.baseUrl || "https://api.typesafe.ai/v1/systemone");

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
          body: JSON.stringify(body),
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
