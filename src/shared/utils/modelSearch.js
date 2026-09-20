/**
 * Smart keyword-based model search and relevance scoring utilities.
 */

/**
 * Split a search query string into lowercase keyword tokens.
 * @param {string} query
 * @returns {string[]}
 */
export function tokenizeQuery(query) {
  if (!query || typeof query !== "string") return [];
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Normalize text into raw, spaced, and compact alphanumeric representations.
 * @param {string} str
 * @returns {{ raw: string, spaced: string, compact: string }}
 */
export function normalizeForSearch(str) {
  const raw = String(str || "").toLowerCase();
  const spaced = raw.replace(/[-_./:,+~|]+/g, " ");
  const compact = raw.replace(/[^a-z0-9]/gi, "");
  return { raw, spaced, compact };
}

/**
 * Extract searchable strings from a candidate (model object or string).
 * @param {object|string} candidate
 * @param {object} [context={}] Optional provider context { providerName, providerAlias }
 * @returns {{ rawText: string, spacedText: string, compactText: string, spacedTokens: string[] }}
 */
function getSearchableText(candidate, context = {}) {
  let parts = [];

  if (typeof candidate === "string") {
    parts.push(candidate);
  } else if (candidate && typeof candidate === "object") {
    if (candidate.id) parts.push(candidate.id);
    if (candidate.name) parts.push(candidate.name);
    if (candidate.value) parts.push(candidate.value);
  }

  if (context.providerName) parts.push(context.providerName);
  if (context.providerAlias) parts.push(context.providerAlias);

  const rawText = parts.map((p) => String(p).toLowerCase()).join(" ");
  const spacedText = rawText.replace(/[-_./:,+~|]+/g, " ");
  const compactText = rawText.replace(/[^a-z0-9]/gi, "");
  const spacedTokens = spacedText.split(/\s+/).filter(Boolean);

  return { rawText, spacedText, compactText, spacedTokens };
}

/**
 * Check if a single query token matches candidate search text.
 * @param {string} token
 * @param {object} searchable
 * @returns {boolean}
 */
function matchToken(token, searchable) {
  const { rawText, spacedText, compactText, spacedTokens } = searchable;

  // 1. Direct substring match
  if (rawText.includes(token)) return true;
  if (spacedText.includes(token)) return true;

  // 2. Compact alphanumeric match (e.g. "gpt4o" matches "gpt-4o", "53" matches "5.3")
  const compactToken = token.replace(/[^a-z0-9]/gi, "");
  if (compactToken && compactText.includes(compactToken)) return true;

  // 3. Sub-token matching when token has separators (e.g. "5-3" matches candidate having "5" and "3")
  const subTokens = token.split(/[-_./:,+~|]+/).filter(Boolean);
  if (
    subTokens.length > 1 &&
    subTokens.every((st) => spacedText.includes(st) || (st.length > 0 && compactText.includes(st)))
  ) {
    return true;
  }

  // 4. Prefix match against any word boundary token
  if (spacedTokens.some((word) => word.startsWith(token))) return true;

  return false;
}

/**
 * Check if a candidate matches ALL keyword tokens in the query.
 * @param {object|string} candidate - Model object ({id, name, value}) or string name
 * @param {string} query - User search query
 * @param {object} [context={}] - Optional context ({ providerName, providerAlias })
 * @returns {boolean}
 */
export function matchModelKeywords(candidate, query, context = {}) {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return true;

  const searchable = getSearchableText(candidate, context);
  return tokens.every((token) => matchToken(token, searchable));
}

/**
 * Calculate relevance score for a candidate against a query.
 * Higher score = more relevant.
 * @param {object|string} candidate
 * @param {string} query
 * @param {object} [context={}]
 * @param {boolean} [isAdded=false]
 * @returns {number}
 */
export function calculateModelRelevance(candidate, query, context = {}, isAdded = false) {
  let score = 0;
  if (isAdded) score += 40;

  const trimmedQuery = (query || "").trim();
  if (!trimmedQuery) return score;

  const rawQuery = trimmedQuery.toLowerCase();
  const compactQuery = rawQuery.replace(/[^a-z0-9]/gi, "");
  const tokens = tokenizeQuery(rawQuery);

  const modelId = typeof candidate === "object" ? String(candidate?.id || "").toLowerCase() : "";
  const modelName = typeof candidate === "object" ? String(candidate?.name || "").toLowerCase() : String(candidate || "").toLowerCase();
  const modelValue = typeof candidate === "object" ? String(candidate?.value || "").toLowerCase() : "";

  const searchable = getSearchableText(candidate, context);

  // 1. Exact match (highest tier)
  if (modelId === rawQuery) score += 1000;
  else if (modelName === rawQuery) score += 950;
  else if (modelValue === rawQuery) score += 900;

  // 2. Starts with query
  if (modelId && modelId.startsWith(rawQuery)) score += 600;
  else if (modelName.startsWith(rawQuery)) score += 550;

  // 3. Contiguous substring of full query
  if (modelId && modelId.includes(rawQuery)) score += 350;
  else if (modelName.includes(rawQuery)) score += 300;
  else if (searchable.spacedText.includes(rawQuery)) score += 250;
  else if (compactQuery && searchable.compactText.includes(compactQuery)) score += 200;

  // 4. Token-level relevance
  tokens.forEach((token) => {
    // Exact word match
    if (searchable.spacedTokens.includes(token)) {
      score += 70;
    } else if (searchable.spacedTokens.some((w) => w.startsWith(token))) {
      score += 40;
    } else if (modelId.includes(token) || modelName.includes(token)) {
      score += 25;
    } else {
      score += 10;
    }
  });

  // 5. Shortest name/ID bonus (e.g. "gpt-4o" is preferred over "gpt-4o-2024-11-20-preview")
  const len = modelId.length || modelName.length || 50;
  score += Math.max(0, 30 - Math.floor(len / 2));

  return score;
}

/**
 * Sort a list of models with relevance scoring if a query is active,
 * or default added-first alphabetical sorting if query is empty.
 * @param {Array<object>} models
 * @param {string} query
 * @param {object} [context={}]
 * @param {Array<string>} [addedModelValues=[]]
 * @returns {Array<object>}
 */
export function sortModelsByRelevance(models, query, context = {}, addedModelValues = []) {
  const hasQuery = Boolean(query && query.trim());

  if (!hasQuery) {
    const added = models
      .filter((m) => addedModelValues.includes(m.value))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const rest = models
      .filter((m) => !addedModelValues.includes(m.value))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return [...added, ...rest];
  }

  return [...models].sort((a, b) => {
    const isAddedA = addedModelValues.includes(a.value);
    const isAddedB = addedModelValues.includes(b.value);
    const scoreA = calculateModelRelevance(a, query, context, isAddedA);
    const scoreB = calculateModelRelevance(b, query, context, isAddedB);

    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    return (a.name || "").localeCompare(b.name || "");
  });
}
