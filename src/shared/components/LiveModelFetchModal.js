"use client";

import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import Input from "./Input";
import { useTranslation } from "@/shared/hooks/useTranslation";

const MODEL_FAMILIES = [
  { id: "all", label: "All", regex: null },
  { id: "deepseek", label: "DeepSeek", regex: /deepseek/i },
  { id: "claude", label: "Claude", regex: /claude/i },
  { id: "openai", label: "GPT / OpenAI", regex: /(gpt|openai|^o[134](-|$)|chatgpt)/i },
  { id: "gemini", label: "Gemini", regex: /gemini/i },
  { id: "qwen", label: "Qwen", regex: /qwen/i },
  { id: "llama", label: "Llama", regex: /(llama|meta)/i },
  { id: "mistral", label: "Mistral", regex: /(mistral|codestral|pixtral|mixtral)/i },
  { id: "kimi", label: "Kimi", regex: /(kimi|moonshot)/i },
  { id: "glm", label: "GLM", regex: /(glm|chatglm|cogview)/i },
];

export default function LiveModelFetchModal({
  isOpen,
  onClose,
  providerId,
  providerAlias,
  targetConnectionId,
  existingModelIds = new Set(),
  onModelsAdded,
}) {
  const { t: translate } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [liveModels, setLiveModels] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFamily, setSelectedFamily] = useState("all");
  const [selectedModelIds, setSelectedModelIds] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  // Fetch live models whenever modal opens
  useEffect(() => {
    if (!isOpen) {
      setLiveModels([]);
      setError("");
      setSearchQuery("");
      setSelectedFamily("all");
      setSelectedModelIds(new Set());
      return;
    }

    let isCancelled = false;
    const fetchModels = async () => {
      setLoading(true);
      setError("");
      try {
        const isFreeTier = ["openrouter", "poolside", "nvidia", "cloudflare-ai", "api-airforce", "opencode", "opencode-go"].includes(providerId);
        const targetId = targetConnectionId || providerId;
        const res = await fetch(`/api/providers/${targetId}/models${isFreeTier ? "?freeOnly=true" : ""}`);
        const data = await res.json();

        if (isCancelled) return;

        if (!res.ok) {
          setError(data.error || translate("Failed to fetch live models"));
          return;
        }

        let models = data.models || [];

        // Special rule for OpenRouter: strictly enforce :free pattern
        if (providerId === "openrouter") {
          models = models.filter((m) => String(m.id).endsWith(":free") || (m.pricing?.prompt === "0" && m.pricing?.completion === "0"));
        }

        // Clean Qoder model id prefixes
        if (providerId === "qoder") {
          models = models.map((m) => ({
            ...m,
            id: String(m.id || m.name).replace(/^qoder\//, ""),
          }));
        }

        setLiveModels(models);
      } catch (err) {
        if (!isCancelled) {
          setError(err.message || translate("Error fetching models"));
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    fetchModels();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, providerId, targetConnectionId, translate]);

  // Filter models by family and search query
  const filteredModels = useMemo(() => {
    const familyObj = MODEL_FAMILIES.find((f) => f.id === selectedFamily);
    const query = searchQuery.trim().toLowerCase();

    return liveModels.filter((model) => {
      const modelId = String(model.id || "").toLowerCase();
      const modelName = String(model.name || "").toLowerCase();

      // Family regex filter
      if (familyObj?.regex && !familyObj.regex.test(modelId) && !familyObj.regex.test(modelName)) {
        return false;
      }

      // Search query filter
      if (query && !modelId.includes(query) && !modelName.includes(query)) {
        return false;
      }

      return true;
    });
  }, [liveModels, selectedFamily, searchQuery]);

  // Detect which filtered models are available to add (not already present)
  const availableFilteredModels = useMemo(() => {
    return filteredModels.filter((m) => !existingModelIds.has(m.id));
  }, [filteredModels, existingModelIds]);

  const allAvailableSelected = availableFilteredModels.length > 0 &&
    availableFilteredModels.every((m) => selectedModelIds.has(m.id));

  const toggleSelectAll = () => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (allAvailableSelected) {
        // Deselect all available filtered
        availableFilteredModels.forEach((m) => next.delete(m.id));
      } else {
        // Select all available filtered
        availableFilteredModels.forEach((m) => next.add(m.id));
      }
      return next;
    });
  };

  const toggleSelectModel = (modelId) => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  // Save selected models to customModels in database
  const handleSave = async () => {
    if (selectedModelIds.size === 0 || saving) return;
    setSaving(true);

    try {
      const modelsToAdd = liveModels.filter((m) => selectedModelIds.has(m.id));
      const addedList = [];

      for (const m of modelsToAdd) {
        try {
          const res = await fetch("/api/models/custom", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              providerAlias,
              id: m.id,
              type: "llm",
              name: m.name || m.id,
            }),
          });
          if (res.ok) {
            addedList.push(m.id);
          }
        } catch (e) {
          console.error(`Error saving model ${m.id}:`, e);
        }
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("customModelChanged"));
      }

      if (onModelsAdded) {
        await onModelsAdded(addedList);
      }

      onClose();
    } catch (err) {
      console.error("Failed to add models:", err);
      setError(err.message || translate("Failed to save selected models"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-xl">tune</span>
          <span>{translate("Fetch & Select Live Models")} ({providerAlias || providerId})</span>
        </div>
      }
      size="lg"
      className="max-h-[85vh] flex flex-col"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-xs text-text-muted">
            {translate("Selected")}: <span className="font-semibold text-text">{selectedModelIds.size}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-3.5 py-1.5 text-xs rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-text"
            >
              {translate("Cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={selectedModelIds.size === 0 || saving}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium shadow-sm"
            >
              <span className="material-symbols-outlined text-sm" style={saving ? { animation: "spin 1s linear infinite" } : undefined}>
                {saving ? "progress_activity" : "add_circle"}
              </span>
              {saving
                ? translate("Adding...")
                : `${translate("Add Selected")} (${selectedModelIds.size})`}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3 py-1 overflow-hidden h-full">
        {/* OpenRouter notice if applicable */}
        {providerId === "openrouter" && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <span className="material-symbols-outlined text-sm">verified</span>
            <span>{translate("Filtering to official OpenRouter free tier models (:free pattern) only.")}</span>
          </div>
        )}

        {/* Search input */}
        <div>
          <Input
            placeholder={translate("Search models by id or name...")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftIcon="search"
            clearable
            onClear={() => setSearchQuery("")}
            className="text-xs"
          />
        </div>

        {/* Model Family Filter Pills */}
        <div className="flex flex-wrap gap-1.5 pb-1">
          {MODEL_FAMILIES.map((family) => {
            const isSelected = selectedFamily === family.id;
            return (
              <button
                key={family.id}
                type="button"
                onClick={() => setSelectedFamily(family.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  isSelected
                    ? "bg-primary text-white shadow-xs"
                    : "bg-black/5 dark:bg-white/5 text-text-muted hover:text-text hover:bg-black/10 dark:hover:bg-white/10"
                }`}
              >
                {family.label}
              </button>
            );
          })}
        </div>

        {/* Select all header */}
        <div className="flex items-center justify-between pt-2 border-t border-border-subtle text-xs text-text-muted">
          <span>
            {translate("Showing")} {filteredModels.length} {translate("models")}
            {availableFilteredModels.length < filteredModels.length && (
              <span className="ml-1 opacity-70">
                ({filteredModels.length - availableFilteredModels.length} {translate("already added")})
              </span>
            )}
          </span>
          {availableFilteredModels.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectAll}
              className="text-xs text-primary hover:underline font-medium"
            >
              {allAvailableSelected ? translate("Deselect All") : translate("Select All Available")}
            </button>
          )}
        </div>

        {/* Error notice */}
        {error && (
          <div className="p-3 text-xs rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400">
            {error}
          </div>
        )}

        {/* Models list */}
        <div className="overflow-y-auto max-h-[380px] flex flex-col gap-1.5 pr-1 border rounded-lg border-border-subtle p-2 bg-surface/50">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-muted">
              <span className="material-symbols-outlined text-2xl animate-spin text-primary">progress_activity</span>
              <span className="text-xs">{translate("Connecting to upstream live catalog...")}</span>
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="text-center py-10 text-xs text-text-muted">
              {translate("No models matching your search or family filter.")}
            </div>
          ) : (
            filteredModels.map((model) => {
              const isAlreadyAdded = existingModelIds.has(model.id);
              const isSelected = selectedModelIds.has(model.id);

              return (
                <div
                  key={model.id}
                  onClick={() => {
                    if (!isAlreadyAdded) toggleSelectModel(model.id);
                  }}
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                    isAlreadyAdded
                      ? "opacity-55 border-border-subtle bg-black/[0.02] dark:bg-white/[0.02] cursor-not-allowed"
                      : isSelected
                      ? "border-primary/50 bg-primary/5 cursor-pointer shadow-2xs"
                      : "border-border-subtle hover:border-primary/30 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <input
                      type="checkbox"
                      checked={isAlreadyAdded || isSelected}
                      disabled={isAlreadyAdded}
                      onChange={() => {}}
                      className="rounded border-border-subtle text-primary focus:ring-primary h-3.5 w-3.5"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-medium truncate text-text">
                          {model.id}
                        </span>
                        {model.isFree && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            Free
                          </span>
                        )}
                      </div>
                      {model.name && model.name !== model.id && (
                        <div className="text-[11px] text-text-muted truncate">
                          {model.name}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {model.contextLength && (
                      <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5 font-mono">
                        {Math.round(model.contextLength / 1000)}k ctx
                      </span>
                    )}
                    {isAlreadyAdded ? (
                      <span className="px-2 py-0.5 text-[10px] rounded-full bg-black/10 dark:bg-white/10 text-text-muted font-medium">
                        {translate("Added")}
                      </span>
                    ) : (
                      <span className={`text-[11px] font-medium ${isSelected ? "text-primary" : "text-text-muted"}`}>
                        {isSelected ? translate("Selected") : translate("Select")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}

LiveModelFetchModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  providerId: PropTypes.string.isRequired,
  providerAlias: PropTypes.string,
  targetConnectionId: PropTypes.string,
  existingModelIds: PropTypes.instanceOf(Set),
  onModelsAdded: PropTypes.func,
};
