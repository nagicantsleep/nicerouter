"use client";

import { useState, useRef, useEffect } from "react";
import { Modal, Button, Badge } from "@/shared/components";

export default function ComboTestModal({ isOpen, onClose, combo, strategy = {} }) {
  const [prompt, setPrompt] = useState("Say hello in 1 word");
  const [testAll, setTestAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(null);
  const [liveSteps, setLiveSteps] = useState([]);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const abortControllerRef = useRef(null);

  // Abort running stream on unmount or when modal closes
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleClose = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    onClose();
  };

  if (!combo) return null;

  const currentStrategy = strategy.fallbackStrategy || "fallback";

  const handleRunTest = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setLoading(true);
    setError(null);
    setTestResult(null);
    setCurrentStep(null);
    setLiveSteps([]);

    try {
      const res = await fetch(`/api/combos/${combo.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          prompt: prompt.trim() || "Say hello in 1 word",
          testAll,
          stream: true,
        }),
      });

      if (!res.ok) {
        let errData = {};
        try {
          errData = await res.json();
        } catch {}
        setError(errData.error || `HTTP ${res.status}: Failed to execute combo test`);
        setLoading(false);
        return;
      }

      if (!res.body) {
        throw new Error("Response body is not readable");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          const lines = trimmed.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));
                handleStreamEvent(event);
              } catch (e) {
                console.error("[ComboTest] Failed to parse SSE event:", e);
              }
            }
          }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        return;
      }
      setError(err.message || "Network error while testing combo");
    } finally {
      setLoading(false);
      setCurrentStep(null);
    }
  };

  const handleStreamEvent = (event) => {
    switch (event.type) {
      case "init": {
        if (Array.isArray(event.models)) {
          setLiveSteps(
            event.models.map((m) => ({
              step: m.step,
              model: m.model,
              provider: m.provider,
              enabled: m.enabled,
              state: "pending",
            }))
          );
        }
        break;
      }

      case "step_start": {
        setCurrentStep(event.step);
        setLiveSteps((prev) =>
          prev.map((s) =>
            s.step === event.step ? { ...s, state: "testing" } : s
          )
        );
        break;
      }

      case "step_complete": {
        setLiveSteps((prev) => {
          const exists = prev.some((s) => s.step === event.step);
          if (exists) {
            return prev.map((s) =>
              s.step === event.step
                ? { ...s, ...event.stepData, state: "completed" }
                : s
            );
          }
          return [...prev, { ...event.stepData, state: "completed" }];
        });
        break;
      }

      case "complete": {
        setTestResult(event);
        if (Array.isArray(event.steps)) {
          setLiveSteps(event.steps.map((s) => ({ ...s, state: "completed" })));
        }
        setCurrentStep(null);
        break;
      }

      case "error": {
        setError(event.error || "Execution error in stream");
        break;
      }

      default:
        break;
    }
  };

  const displaySteps = testResult?.steps || liveSteps;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="xl"
      title={
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">science</span>
          <span>
            Test Combo: <code className="font-mono text-primary font-semibold">{combo.name}</code>
          </span>
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
            <Button variant="outline" size="sm" onClick={handleClose}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={loading ? undefined : "play_arrow"}
              loading={loading}
              onClick={handleRunTest}
            >
              {loading ? "Testing..." : "Run Test"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-xs">
        {/* Combo Strategy Header Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-surface-2 border border-border">
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
              disabled={loading}
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
            className="w-full py-2 px-3 text-xs bg-surface-2 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-primary font-mono text-text-main"
          />
        </div>

        {/* Error message if API call fails */}
        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
            <div>
              <p className="font-semibold">Test Execution Error</p>
              <p className="text-[11px] opacity-90 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Live Running Indicator Bar */}
        {loading && (
          <div className="p-3 rounded-xl bg-primary/5 dark:bg-primary/10 border border-primary/25 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="material-symbols-outlined text-primary text-[20px] animate-spin">
                sync
              </span>
              <div>
                <p className="font-semibold text-text-main text-xs">
                  {currentStep
                    ? `Testing Step ${currentStep} of ${displaySteps.length}...`
                    : "Connecting and initiating fallback trace..."}
                </p>
                <p className="text-[11px] text-text-muted">
                  Testing models in real-time. Results will appear step-by-step below.
                </p>
              </div>
            </div>
            {currentStep && (
              <span className="px-2.5 py-1 rounded-full bg-primary/15 text-primary text-[11px] font-mono font-semibold">
                Step {currentStep}/{displaySteps.length}
              </span>
            )}
          </div>
        )}

        {/* Initial loading state before any steps arrive */}
        {loading && displaySteps.length === 0 && (
          <div className="py-8 flex flex-col items-center justify-center gap-3 text-text-muted border border-dashed border-border rounded-xl bg-surface-2/50">
            <div className="size-7 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <div className="text-center">
              <p className="font-medium text-text-main">Initializing fallback test...</p>
              <p className="text-[11px] text-text-muted mt-0.5">Evaluating accounts, detecting rate limits, and checking provider availability</p>
            </div>
          </div>
        )}

        {/* Overall Status Banner (Shown when finished) */}
        {testResult && (
          <div
            className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
              testResult.overallStatus === "success"
                ? "bg-emerald-50 dark:bg-emerald-950/25 border-emerald-300 dark:border-emerald-500/30 text-emerald-900 dark:text-emerald-200"
                : "bg-rose-50 dark:bg-rose-950/25 border-rose-300 dark:border-rose-500/30 text-rose-900 dark:text-rose-200"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={`material-symbols-outlined text-[24px] ${
                  testResult.overallStatus === "success"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400"
                }`}
              >
                {testResult.overallStatus === "success" ? "check_circle" : "cancel"}
              </span>
              <div>
                <p className="font-semibold text-xs">
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
        )}

        {/* Live Steps Trace Timeline */}
        {displaySteps.length > 0 && (
          <div className="flex flex-col gap-2.5 mt-1">
            <h4 className="font-semibold text-text-main flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span>Routing Fallback Trace ({displaySteps.length} models)</span>
                {loading && (
                  <span className="size-2 rounded-full bg-primary animate-ping" />
                )}
              </span>
              {testResult && (
                <button
                  onClick={() => setShowRawJson(!showRawJson)}
                  className="text-[11px] text-primary hover:underline cursor-pointer flex items-center gap-0.5 font-normal"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {showRawJson ? "expand_less" : "code"}
                  </span>
                  {showRawJson ? "Hide Raw JSON" : "View Raw JSON"}
                </button>
              )}
            </h4>

            {showRawJson && testResult && (
              <pre className="p-3 rounded-lg bg-zinc-950 text-emerald-400 border border-zinc-800 font-mono text-[10px] overflow-auto max-h-60 whitespace-pre-wrap">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            )}

            <div className="flex flex-col gap-2 relative">
              {displaySteps.map((s, idx) => {
                const isTesting = s.state === "testing";
                const isPending = s.state === "pending";
                const isWinning = Boolean(testResult ? s.model === testResult.winningModel && s.ok : s.ok);
                const isNotNeeded = s.nextAction === "not_needed";

                return (
                  <div key={s.step || idx} className="flex flex-col gap-1.5">
                    {/* Step Card */}
                    <div
                      className={`rounded-xl border p-3.5 transition-all ${
                        isTesting
                          ? "bg-primary/[0.04] dark:bg-primary/[0.08] border-primary/50 shadow-sm ring-1 ring-primary/20"
                          : isWinning
                          ? "bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-500/40 shadow-xs"
                          : isNotNeeded
                          ? "bg-surface-2/40 dark:bg-white/[0.01] border-border/40 opacity-50"
                          : isPending
                          ? "bg-surface-2/30 dark:bg-white/[0.01] border-border/40 opacity-65"
                          : s.skipped
                          ? "bg-amber-50/70 dark:bg-amber-950/20 border-amber-300 dark:border-amber-500/40 shadow-xs"
                          : "bg-rose-50/70 dark:bg-rose-950/20 border-rose-300 dark:border-rose-500/40 shadow-xs"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        {/* Step Header */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`size-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${
                              isTesting
                                ? "bg-primary text-white"
                                : isWinning
                                ? "bg-emerald-600 text-white"
                                : isNotNeeded || isPending
                                ? "bg-zinc-400 dark:bg-zinc-700 text-white"
                                : s.skipped
                                ? "bg-amber-600 text-white"
                                : "bg-rose-600 text-white"
                            }`}
                          >
                            {isTesting ? (
                              <span className="material-symbols-outlined text-[13px] animate-spin">
                                progress_activity
                              </span>
                            ) : (
                              s.step
                            )}
                          </span>
                          <code className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100">
                            {s.model}
                          </code>
                          <span className="px-1.5 py-0.5 rounded bg-surface-3 text-text-muted text-[10px] font-mono font-semibold uppercase">
                            {s.provider}
                          </span>
                        </div>

                        {/* Status & Latency Badges */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isTesting && (
                            <span className="text-[11px] font-mono text-primary flex items-center gap-1 font-semibold animate-pulse">
                              <span>Testing...</span>
                            </span>
                          )}
                          {s.latencyMs !== null && s.latencyMs !== undefined && !isTesting && (
                            <span className="text-[11px] font-mono text-text-muted">
                              ⚡ {s.latencyMs}ms
                            </span>
                          )}
                          {isWinning && (
                            <Badge variant="success" className="font-mono text-[10px]">
                              200 OK (SERVED)
                            </Badge>
                          )}
                          {!isWinning && s.status && !isTesting && (
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
                          {isPending && (
                            <span className="text-[10px] text-text-muted px-2 py-0.5 rounded bg-surface-2">
                              Queued
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Live testing hint */}
                      {isTesting && (
                        <div className="mt-2.5 p-2 rounded-lg bg-primary/5 dark:bg-primary/10 border border-primary/20 text-[11px] text-text-muted flex items-center gap-2">
                          <div className="size-2 rounded-full bg-primary animate-ping" />
                          <span>Sending completion prompt to model and measuring response time...</span>
                        </div>
                      )}

                      {/* Error / Fallback Reason - High Contrast Card */}
                      {s.error && !isTesting && (
                        <div className="mt-2.5 p-3 rounded-lg bg-white dark:bg-zinc-900 border border-rose-300 dark:border-rose-800/60 shadow-xs space-y-2">
                          {s.fallbackReason && (
                            <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-semibold text-xs">
                              <span className="material-symbols-outlined text-[15px]">warning</span>
                              <span>Reason: {s.fallbackReason}</span>
                            </div>
                          )}
                          <div className="font-mono text-xs text-rose-800 dark:text-rose-200 bg-rose-50/70 dark:bg-rose-950/50 p-2.5 rounded border border-rose-200 dark:border-rose-900/50 whitespace-pre-wrap break-words leading-relaxed">
                            {s.error}
                          </div>
                          {s.cooldownUntil && (
                            <div className="text-zinc-600 dark:text-zinc-400 text-[11px] flex items-center gap-1 font-sans">
                              <span className="material-symbols-outlined text-[14px]">timer</span>
                              <span>
                                Cooldown active until: {new Date(s.cooldownUntil).toLocaleTimeString()} ({s.cooldownUntil})
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Success Output Preview - High Contrast Card */}
                      {s.ok && s.outputPreview && !isTesting && (
                        <div className="mt-2.5 p-3 rounded-lg bg-white dark:bg-zinc-900 border border-emerald-300 dark:border-emerald-700/50 shadow-xs space-y-1.5">
                          <div className="text-emerald-800 dark:text-emerald-300 font-semibold text-xs flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[15px]">chat</span>
                            <span>Model Response Preview:</span>
                          </div>
                          <div className="font-mono text-xs text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 p-2.5 rounded border border-zinc-200 dark:border-zinc-800 whitespace-pre-wrap break-words leading-relaxed">
                            {s.outputPreview}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Transition / Fallback Arrow to Next Model */}
                    {idx < displaySteps.length - 1 &&
                      !isNotNeeded &&
                      !isPending &&
                      !isWinning &&
                      !isTesting && (
                        <div className="flex items-center pl-4 py-0.5">
                          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-[11px] font-medium">
                            <span className="material-symbols-outlined text-[14px]">arrow_downward</span>
                            <span>
                              Failing over → Trying next:{" "}
                              <code className="font-mono font-semibold">
                                {displaySteps[idx + 1]?.model}
                              </code>
                            </span>
                          </div>
                        </div>
                      )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
