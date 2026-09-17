// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, updateCombo, getProviderNodes } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

export function parseModel(modelStr) {
  const parsed = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    // Provider-node prefixes are user-defined. They must not override built-in
    // provider ids/aliases such as `cf`, `cloudflare-ai`, `openai`, or `hf`.
    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
      }

      const embeddingNodes = await getProviderNodes({ type: "custom-embedding" });
      const matchedEmbedding = embeddingNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedEmbedding) {
        return { provider: matchedEmbedding.id, model: parsed.model };
      }
    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  // Check if this is a combo name before resolving as alias
  // This prevents combo names from being incorrectly routed to providers
  const combo = await getComboByName(parsed.model);
  if (combo) {
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
  }

  return getModelInfoCore(modelStr, getModelAliases);
}

import { getEnabledComboModels } from "open-sse/services/combo.js";

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr);
  if (combo) {
    if (combo.isActive === false) {
      return { disabled: true, combo };
    }
    if (combo.models && combo.models.length > 0) {
      return getEnabledComboModels(combo.models);
    }
    return [];
  }
  return null;
}

/**
 * Automatically disable a model in a combo when it exhausts its quota.
 * @param {string} comboName
 * @param {string} failedModel
 * @param {number} [status]
 * @param {string} [errorText]
 * @returns {Promise<boolean>} Whether the model was disabled in the combo
 */
export async function autoDisableComboModel(comboName, failedModel, status, errorText) {
  if (!comboName || !failedModel) return false;
  try {
    const combo = await getComboByName(comboName);
    if (!combo || !Array.isArray(combo.models) || combo.models.length === 0) return false;

    let modified = false;
    const updatedModels = combo.models.map((m) => {
      const name = typeof m === "string" ? m : (m?.model || m?.id || m?.name || "");
      if (name === failedModel) {
        const isEnabled = typeof m === "string" ? true : m?.enabled !== false;
        if (isEnabled) {
          modified = true;
          return typeof m === "string" ? { model: m, enabled: false } : { ...m, enabled: false };
        }
      }
      return m;
    });

    if (modified) {
      await updateCombo(combo.id, { models: updatedModels });
      console.warn(`[COMBO] 🚫 Auto-disabled model "${failedModel}" in combo "${comboName}" (HTTP ${status || "unknown"}: ${errorText || "quota exhausted"})`);
      return true;
    }
  } catch (err) {
    console.error(`[COMBO] Failed to auto-disable model "${failedModel}" in combo "${comboName}":`, err);
  }
  return false;
}

