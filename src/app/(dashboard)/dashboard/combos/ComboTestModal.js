"use client";

import { useState } from "react";
import { Modal, Button, Badge } from "@/shared/components";

export default function ComboTestModal({ isOpen, onClose, combo, strategy = {} }) {
  const [prompt, setPrompt] = useState("Say hello in 1 word");
  const [testAll, setTestAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);
  const [showRawJson, setShowRawJson] = useState(false);

  if (!combo) return null;

  const currentStrategy = strategy.fallbackStrategy || "fallback";

  const handleRunTest = async () => {
    setLoading(true);
    setError(null);
    setTestResult(null);

    try {
      const res = await fetch(`/api/combos/${combo.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim() || "Say hello in 1 word",
          testAll,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to execute combo test");
      } else {
        setTestResult(data);
      }
    } catch (err) {
      setError(err.message || "Network error while testing combo");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">science</span>
          <span>Test Combo: <code className="font-mono text-primary font-semibold">{combo.name}</code></span>
        </div>
      }
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-xs text-text-muted flex items-center gap-2">
            {testResult && (
              <span>
                Total execution time: <strong className="text-text-main">{testResult.totalLatencyMs}ms</strong>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={loading ? undefined : "play_arrow"}
              loading={loading}
              onClick={handleRunTest}
            >
              {loading ? "Testing Fallback..." : "Run Test"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-xs">
        {/* Combo Strategy Header Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-black/[0.02] dark:bg-white/[0.02] border border-border">
          <div className="flex items-center gap-2">
            <span className="text-text-muted">Strategy:</span>
            <Badge variant="secondary" className="capitalize font-medium">
              {currentStrategy}
            </Badge>
            <span className="text-text-muted">•</span>
            <span className="text-text-muted">{combo.models?.length || 0} configured models</span>
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-text-muted hover:text-text-main">
            <input
              type="checkbox"
              checked={testAll}
              onChange={(e) => setTestAll(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary size-3.5 cursor-pointer"
            />
            <span>Test all models (do not stop at first success)</span>
          </label>
        </div>

        {/* Input prompt */}
        <div className="flex flex-col gap-1">
          <label className="font-medium text-text-main">Test Message / Prompt</label>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Say hello in 1 word"
            disabled={loading}
            className="w-full py-2 px-3 text-xs bg-surface-2 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-primary font-mono"
          />
        </div>

        {/* Error message if API call fails */}
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
            <div>
              <p className="font-semibold">Test Execution Failed</p>
              <p className="text-[11px] opacity-90 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Loading state indicator */}
        {loading && (
          <div className="py-8 flex flex-col items-center justify-center gap-3 text-text-muted border border-dashed border-border rounded-xl bg-black/[0.01] dark:bg-white/[0.01]">
            <div className="size-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <div className="text-center">
              <p className="font-medium text-text-main">Tracing combo fallback routing...</p>
              <p className="text-[11px] text-text-muted mt-0.5">Evaluating accounts, detecting rate limits, and checking provider availability</p>
            </div>
          </div>
        )}

        {/* Results Timeline */}
        {testResult && (
          <div className="flex flex-col gap-3">
            {/* Overall Status Banner */}
            <div
              className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                testResult.overallStatus === "success"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "bg-red-500/10 border-red-500/30 text-red-400"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[24px]">
                  {testResult.overallStatus === "success" ? "check_circle" : "cancel"}
                </span>
                <div>
                  <p className="font-semibold text-sm">
                    {testResult.overallStatus === "success"
                      ? `Resolved successfully on Step ${testResult.winningStep}: ${testResult.winningModel}`
                      : "All models in combo failed!"}
                  </p>
                  <p className="text-[11px] opacity-90">
                    {testResult.overallStatus === "success"
                      ? `Request served in ${testResult.totalLatencyMs}ms after ${testResult.winningStep - 1} fallback(s)`
                      : `Tested ${testResult.steps.length} models without any successful response`}
                  </p>
                </div>
              </div>
              <Badge
                variant={testResult.overallStatus === "success" ? "success" : "danger"}
                className="shrink-0 font-mono text-xs px-2.5 py-1"
              >
                {testResult.overallStatus === "success" ? "SUCCESS" : "FAILED"}
              </Badge>
            </div>

            {/* Trace Steps Timeline */}
            <div className="flex flex-col gap-2.5 mt-1">
              <h4 className="font-semibold text-text-main flex items-center justify-between">
                <span>Routing Fallback Trace ({testResult.steps.length} steps)</span>
                <button
                  onClick={() => setShowRawJson(!showRawJson)}
                  className="text-[11px] text-primary hover:underline cursor-pointer flex items-center gap-0.5 font-normal"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {showRawJson ? "expand_less" : "code"}
                  </span>
                  {showRawJson ? "Hide Raw JSON" : "View Raw JSON"}
                </button>
              </h4>

              {showRawJson && (
                <pre className="p-3 rounded-lg bg-black text-emerald-400 font-mono text-[10px] overflow-auto max-h-60 whitespace-pre-wrap">
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              )}

              <div className="flex flex-col gap-2 relative">
                {testResult.steps.map((s, idx) => {
                  const isWinning = s.model === testResult.winningModel && s.ok;
                  const isNotNeeded = s.nextAction === "not_needed";

                  return (
                    <div key={idx} className="flex flex-col gap-1.5">
                      {/* Step Card */}
                      <div
                        className={`rounded-xl border p-3 transition-all ${
                          isWinning
                            ? "bg-emerald-950/20 border-emerald-500/40 shadow-sm"
                            : isNotNeeded
                            ? "bg-black/[0.01] dark:bg-white/[0.01] border-border/40 opacity-50"
                            : s.skipped
                            ? "bg-amber-950/15 border-amber-500/30"
                            : "bg-red-950/15 border-red-500/30"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          {/* Step Header */}
                          <div className="flex items-center gap-2">
                            <span
                              className={`size-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${
                                isWinning
                                  ? "bg-emerald-500 text-white"
                                  : isNotNeeded
                                  ? "bg-zinc-700 text-zinc-300"
                                  : s.skipped
                                  ? "bg-amber-500 text-black"
                                  : "bg-red-500 text-white"
                              }`}
                            >
                              {s.step}
                            </span>
                            <code className="font-mono text-xs font-semibold text-text-main">
                              {s.model}
                            </code>
                            <span className="px-1.5 py-0.2 rounded bg-surface-3 text-text-muted text-[10px] font-mono uppercase">
                              {s.provider}
                            </span>
                          </div>

                          {/* Status & Latency Badges */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {s.latencyMs !== null && (
                              <span className="text-[11px] font-mono text-text-muted">
                                ⚡ {s.latencyMs}ms
                              </span>
                            )}
                            {isWinning && (
                              <Badge variant="success" className="font-mono text-[10px]">
                                200 OK (SERVED)
                              </Badge>
                            )}
                            {!isWinning && s.status && (
                              <Badge
                                variant={s.skipped ? "warning" : "danger"}
                                className="font-mono text-[10px]"
                              >
                                {s.skipped ? "LOCKED (0ms)" : `HTTP ${s.status}`}
                              </Badge>
                            )}
                            {isNotNeeded && (
                              <span className="text-[10px] text-text-muted italic px-2 py-0.5 rounded bg-surface-2">
                                Unused (Earlier model succeeded)
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Error / Fallback Reason */}
                        {s.error && (
                          <div className="mt-2.5 p-2 rounded-lg bg-black/40 border border-border/50 text-[11px] font-mono space-y-1">
                            {s.fallbackReason && (
                              <div className="flex items-center gap-1.5 text-amber-400 font-sans font-semibold text-[11px]">
                                <span className="material-symbols-outlined text-[14px]">warning</span>
                                <span>Reason: {s.fallbackReason}</span>
                              </div>
                            )}
                            <div className="text-red-400 break-words whitespace-pre-wrap">
                              {s.error}
                            </div>
                            {s.cooldownUntil && (
                              <div className="text-zinc-500 text-[10px]">
                                Cooldown active until: {new Date(s.cooldownUntil).toLocaleTimeString()} ({s.cooldownUntil})
                              </div>
                            )}
                          </div>
                        )}

                        {/* Success Output Preview */}
                        {s.ok && s.outputPreview && (
                          <div className="mt-2.5 p-2.5 rounded-lg bg-black/40 border border-emerald-500/30 text-[11px] space-y-1">
                            <div className="text-emerald-400 font-semibold text-[10px] flex items-center gap-1">
                              <span className="material-symbols-outlined text-[13px]">chat</span>
                              <span>Model Response Preview:</span>
                            </div>
                            <div className="font-mono text-text-main whitespace-pre-wrap break-words bg-black/30 p-1.5 rounded">
                              {s.outputPreview}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Transition / Fallback Arrow to Next Model */}
                      {idx < testResult.steps.length - 1 && !isNotNeeded && !isWinning && (
                        <div className="flex items-center gap-2 pl-3 py-0.5 text-text-muted text-[11px]">
                          <span className="material-symbols-outlined text-[16px] text-amber-500">
                            arrow_downward
                          </span>
                          <span className="font-medium text-amber-500/90">
                            Failing over → Trying next model:{" "}
                            <code className="font-mono">{testResult.steps[idx + 1]?.model}</code>
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
