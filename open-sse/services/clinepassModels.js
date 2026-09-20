import { buildClineHeaders } from "../shared/clineAuth.js";

const CLINEPASS_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/models";
const CLINE_RECOMMENDED_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/ai/cline/recommended-models";
const FETCH_TIMEOUT_MS = 5000;

/**
 * Build request headers for the Cline /models endpoint (Cline's upstream API).
 * - API keys are sent as plain Bearer tokens.
 * - OAuth access tokens must carry the WorkOS `workos:` prefix (handled by buildClineHeaders).
 */
function buildModelListHeaders(token, isApiKey) {
  if (isApiKey) {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    };
  }
  return buildClineHeaders(token, { Accept: "application/json" });
}

/**
 * Internal: fetch the raw model list from Cline's /models endpoint.
 * Returns the parsed array or null on any failure.
 */
async function fetchClineRawModels(credentials) {
  const isApiKey = Boolean(credentials?.apiKey);
  const token = isApiKey ? credentials.apiKey : credentials?.accessToken;
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers = buildModelListHeaders(token, isApiKey);

    const response = await fetch(CLINEPASS_MODELS_ENDPOINT, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const json = await response.json();
    const rawList = Array.isArray(json) ? json : json?.data;
    return Array.isArray(rawList) ? rawList : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Internal: fetch recommended, free, and clinepass models from Cline's recommended-models endpoint.
 * Returns the parsed object or null on any failure.
 */
async function fetchClineRecommendedModels(credentials) {
  const isApiKey = Boolean(credentials?.apiKey);
  const token = isApiKey ? credentials.apiKey : credentials?.accessToken;
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers = buildModelListHeaders(token, isApiKey);

    const response = await fetch(CLINE_RECOMMENDED_MODELS_ENDPOINT, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const json = await response.json();
    return json && typeof json === "object" ? json : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch ClinePass live model catalog from Cline's /models & recommended-models endpoint.
 * Returns only models with the cline-pass/ prefix or listed in clinePass section.
 *
 * @param {object} credentials - Connection credentials ({ accessToken, apiKey })
 * @returns {Promise<{ models: { id: string, name: string }[] } | null>}
 */
export async function resolveClinepassModels(credentials) {
  const isApiKey = Boolean(credentials?.apiKey);
  const token = isApiKey ? credentials.apiKey : credentials?.accessToken;
  if (!token) return null;

  const [rawList, recData] = await Promise.all([
    fetchClineRawModels(credentials),
    fetchClineRecommendedModels(credentials),
  ]);

  if (!rawList && !recData) return null;

  const modelMap = new Map();

  // 1. Add from recommended-models clinePass list if available
  if (Array.isArray(recData?.clinePass)) {
    for (const m of recData.clinePass) {
      if (typeof m?.id === "string" && m.id.trim() !== "") {
        modelMap.set(m.id, { id: m.id, name: m.name || m.id });
      }
    }
  }

  // 2. Add any cline-pass/ models from /models raw list
  if (Array.isArray(rawList)) {
    for (const m of rawList) {
      if (typeof m?.id === "string" && m.id.startsWith("cline-pass/")) {
        if (!modelMap.has(m.id)) {
          modelMap.set(m.id, { id: m.id, name: m.name || m.id });
        }
      }
    }
  }

  const models = Array.from(modelMap.values());
  return models.length ? { models } : null;
}

/**
 * Fetch Cline live model catalog from Cline's /models and recommended-models endpoints.
 * Returns ALL models (including free-tier models, recommended models, and general models).
 *
 * @param {object} credentials - Connection credentials ({ accessToken, apiKey })
 * @returns {Promise<{ models: { id: string, name: string }[] } | null>}
 */
export async function resolveClineModels(credentials) {
  const isApiKey = Boolean(credentials?.apiKey);
  const token = isApiKey ? credentials.apiKey : credentials?.accessToken;
  if (!token) return null;

  const [rawList, recData] = await Promise.all([
    fetchClineRawModels(credentials),
    fetchClineRecommendedModels(credentials),
  ]);

  if (!rawList && !recData) return null;

  const modelMap = new Map();

  // Helper to add models safely
  const addModels = (list) => {
    if (!Array.isArray(list)) return;
    for (const m of list) {
      if (typeof m?.id === "string" && m.id.trim() !== "") {
        if (!modelMap.has(m.id)) {
          modelMap.set(m.id, { id: m.id, name: m.name || m.id });
        }
      }
    }
  };

  // Add from recommended endpoints: free, recommended, and clinePass
  if (recData && typeof recData === "object") {
    addModels(recData.free);
    addModels(recData.recommended);
    addModels(recData.clinePass);
    addModels(recData.clineCloud);
  }

  // Add from raw /models list
  if (Array.isArray(rawList)) {
    addModels(rawList);
  }

  const models = Array.from(modelMap.values());
  return models.length ? { models } : null;
}
