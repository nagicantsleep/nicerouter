"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Card, Button, Badge } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

const LEVEL_COLORS = {
  error: {
    badge: "bg-red-500/15 text-red-400 border border-red-500/30",
    text: "text-red-400",
    icon: "error",
  },
  warn: {
    badge: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30",
    text: "text-yellow-400",
    icon: "warning",
  },
  info: {
    badge: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
    text: "text-blue-400",
    icon: "info",
  },
  debug: {
    badge: "bg-purple-500/15 text-purple-400 border border-purple-500/30",
    text: "text-purple-400",
    icon: "bug_report",
  },
  log: {
    badge: "bg-zinc-800 text-zinc-400 border border-zinc-700",
    text: "text-zinc-300",
    icon: "terminal",
  },
};

function normalizeEntry(item, index = 0) {
  if (typeof item === "object" && item !== null && item.message !== undefined) {
    const raw = item.raw || item.message || "";
    let comboName = item.details?.combo || null;
    if (!comboName) {
      const match = raw.match(/\[COMBO\]\s*\[([^\]]+)\]/i);
      if (match) comboName = match[1];
    }

    return {
      id: item.id || `entry_${index}_${Date.now()}`,
      timestamp: item.timestamp || "",
      isoTime: item.isoTime || "",
      level: item.level || "log",
      tag: item.tag || null,
      comboName,
      message: item.message || "",
      stack: item.stack || null,
      details: item.details || null,
      raw,
    };
  }

  const raw = String(item || "");
  let level = "log";
  if (raw.includes("❌") || /\[error\]/i.test(raw)) level = "error";
  else if (raw.includes("⚠️") || /\[warn\]/i.test(raw)) level = "warn";
  else if (raw.includes("ℹ️") || /\[info\]/i.test(raw)) level = "info";
  else if (raw.includes("🔍") || /\[debug\]/i.test(raw)) level = "debug";

  let tag = null;
  const tagMatch = raw.match(/\[([A-Za-z0-9_-]{2,20})\]/);
  if (tagMatch) tag = tagMatch[1];

  let comboName = null;
  const comboMatch = raw.match(/\[COMBO\]\s*\[([^\]]+)\]/i);
  if (comboMatch) {
    comboName = comboMatch[1];
  }

  return {
    id: `raw_${index}_${Date.now()}`,
    timestamp: "",
    isoTime: "",
    level,
    tag,
    comboName,
    message: raw,
    stack: null,
    details: null,
    raw,
  };
}

export default function ConsoleLogClient() {
  const searchParams = useSearchParams();
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const [levelFilter, setLevelFilter] = useState("all"); // "all" | "combos" | "error" | "warn" | "info"
  const [selectedCombo, setSelectedCombo] = useState("");
  const [comboSubFilter, setComboSubFilter] = useState("all"); // "all" | "failures" | "served"
  const [availableCombos, setAvailableCombos] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [diskLogInfo, setDiskLogInfo] = useState({ path: "", sizeBytes: 0, sizeFormatted: "0 B" });
  const [expandedLogIds, setExpandedLogIds] = useState(new Set());
  const [copiedId, setCopiedId] = useState(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [showClearMenu, setShowClearMenu] = useState(false);

  const logRef = useRef(null);
  const clearMenuRef = useRef(null);
  const isAutoScrollingRef = useRef(false);
  const prevScrollHeightRef = useRef(0);

  // Sync URL query params on load (e.g. ?category=combos&combo=deepseek-combo)
  useEffect(() => {
    const cat = searchParams.get("category");
    const cmb = searchParams.get("combo");
    if (cat === "combos" || cat === "combo") {
      setLevelFilter("combos");
    }
    if (cmb) {
      setSelectedCombo(cmb);
    }
  }, [searchParams]);

  // Pre-fetch configured combos from backend for the filter dropdown
  useEffect(() => {
    fetch("/api/combos")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.combos) {
          setAvailableCombos(data.combos.map((c) => c.name));
        }
      })
      .catch(() => {});
  }, []);

  // Fetch disk log info
  useEffect(() => {
    let isMounted = true;
    const fetchDisk = () => {
      fetch("/api/translator/console-logs")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (isMounted && data?.diskLogInfo) {
            setDiskLogInfo(data.diskLogInfo);
          }
        })
        .catch(() => {});
    };

    fetchDisk();
    const interval = setInterval(fetchDisk, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Close clear menu on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (clearMenuRef.current && !clearMenuRef.current.contains(e.target)) {
        setShowClearMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // SSE stream connection
  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const maxLines = CONSOLE_LOG_CONFIG.maxLines || 1000;

        if (msg.type === "init") {
          const normalized = (msg.logs || []).map((l, i) => normalizeEntry(l, i));
          setLogs(normalized.slice(-maxLines));
        } else if (msg.type === "entries") {
          const newEntries = (msg.entries || []).map((entry, i) => normalizeEntry(entry, i));
          setLogs((prev) => {
            const next = [...prev, ...newEntries];
            return next.length > maxLines ? next.slice(-maxLines) : next;
          });
        } else if (msg.type === "lines") {
          const newEntries = (msg.lines || []).map((line, i) => normalizeEntry(line, i));
          setLogs((prev) => {
            const next = [...prev, ...newEntries];
            return next.length > maxLines ? next.slice(-maxLines) : next;
          });
        } else if (msg.type === "line") {
          const newEntry = normalizeEntry(msg.line);
          setLogs((prev) => {
            const next = [...prev, newEntry];
            return next.length > maxLines ? next.slice(-maxLines) : next;
          });
        } else if (msg.type === "clear") {
          setLogs([]);
        }
      } catch (err) {
        console.error("Error parsing console log SSE:", err);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  // Handle user scrolling
  const handleScroll = () => {
    if (!logRef.current || isAutoScrollingRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const isAtBottom = distanceFromBottom <= 40;

    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    } else if (isAtBottom && !autoScroll) {
      setAutoScroll(true);
    }
  };

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (!logRef.current) return;
    if (autoScroll) {
      isAutoScrollingRef.current = true;
      logRef.current.scrollTop = logRef.current.scrollHeight;
      requestAnimationFrame(() => {
        isAutoScrollingRef.current = false;
      });
    } else {
      const currentScrollHeight = logRef.current.scrollHeight;
      const prevScrollHeight = prevScrollHeightRef.current;
      if (prevScrollHeight > 0 && currentScrollHeight < prevScrollHeight) {
        const diff = prevScrollHeight - currentScrollHeight;
        logRef.current.scrollTop = Math.max(0, logRef.current.scrollTop - diff);
      }
    }
    prevScrollHeightRef.current = logRef.current.scrollHeight;
  }, [logs, autoScroll]);

  // Extract all detected combo names from logs merged with availableCombos
  const allDetectedCombos = useMemo(() => {
    const set = new Set(availableCombos);
    for (const log of logs) {
      if (log.comboName) set.add(log.comboName);
      if (log.details?.combo) set.add(log.details.combo);
    }
    return Array.from(set).filter(Boolean).sort();
  }, [logs, availableCombos]);

  // Counts for tabs
  const counts = useMemo(() => {
    let errors = 0;
    let warns = 0;
    let infos = 0;
    let combos = 0;
    let comboFailures = 0;
    let comboServed = 0;

    for (const log of logs) {
      if (log.level === "error") errors++;
      else if (log.level === "warn") warns++;
      else if (log.level === "info") infos++;

      const isCombo = log.tag === "COMBO" || log.raw?.includes("[COMBO]") || log.message?.includes("[COMBO]");
      if (isCombo) {
        combos++;
        const isFailure =
          log.level === "warn" ||
          log.level === "error" ||
          log.raw?.includes("failed") ||
          log.raw?.includes("falling back") ||
          log.raw?.includes("threw error");
        if (isFailure) comboFailures++;

        const isServed = log.raw?.includes("succeeded") || log.raw?.includes("served request");
        if (isServed) comboServed++;
      }
    }
    return { all: logs.length, errors, warns, infos, combos, comboFailures, comboServed };
  }, [logs]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return logs.filter((log) => {
      const isCombo = log.tag === "COMBO" || log.raw?.includes("[COMBO]") || log.message?.includes("[COMBO]");

      // Category filter: Combos
      if (levelFilter === "combos") {
        if (!isCombo) return false;

        // Specific combo filter
        if (selectedCombo) {
          const matchName = log.comboName === selectedCombo ||
            log.details?.combo === selectedCombo ||
            log.message?.toLowerCase().includes(`[${selectedCombo.toLowerCase()}]`) ||
            log.raw?.toLowerCase().includes(`[${selectedCombo.toLowerCase()}]`);
          if (!matchName) return false;
        }

        // Sub-filter: all | failures | served
        if (comboSubFilter === "failures") {
          const isFailure =
            log.level === "warn" ||
            log.level === "error" ||
            log.raw?.includes("failed") ||
            log.raw?.includes("falling back") ||
            log.raw?.includes("threw error");
          if (!isFailure) return false;
        } else if (comboSubFilter === "served") {
          const isServed = log.raw?.includes("succeeded") || log.raw?.includes("served request");
          if (!isServed) return false;
        }
      } else if (levelFilter !== "all" && log.level !== levelFilter) {
        return false;
      }

      if (q) {
        const inMsg = log.message?.toLowerCase().includes(q);
        const inRaw = log.raw?.toLowerCase().includes(q);
        const inTag = log.tag?.toLowerCase().includes(q);
        const inStack = log.stack?.toLowerCase().includes(q);
        const inCombo = log.comboName?.toLowerCase().includes(q);
        return inMsg || inRaw || inTag || inStack || inCombo;
      }
      return true;
    });
  }, [logs, levelFilter, selectedCombo, comboSubFilter, searchQuery]);

  const toggleExpand = (id) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopy = (text, id) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClearScreen = async () => {
    setShowClearMenu(false);
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      setLogs([]);
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  const handleCleanDiskLogs = async () => {
    setShowClearMenu(false);
    setIsCleaning(true);
    try {
      const res = await fetch("/api/translator/console-logs?cleanDisk=true", { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        if (data.diskLogInfo) setDiskLogInfo(data.diskLogInfo);
        setLogs([]);
      }
    } catch (err) {
      console.error("Failed to truncate disk logs:", err);
    } finally {
      setIsCleaning(false);
    }
  };

  const handleDownloadLogs = (type) => {
    if (type === "disk") {
      window.open("/api/translator/console-logs?download=disk", "_blank");
    } else {
      const content = logs.map((l) => l.raw).join("\n");
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `9router-console-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-0 overflow-hidden border-border/80">
        {/* Top Control Bar */}
        <div className="p-3 bg-surface-1 border-b border-border flex flex-wrap items-center justify-between gap-3">
          {/* Level Filter Tabs */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setLevelFilter("all")}
              className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-all cursor-pointer ${
                levelFilter === "all"
                  ? "bg-surface-3 text-text-main shadow-sm border border-border"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main"
              }`}
            >
              All ({counts.all})
            </button>

            {/* Dedicated Combo Category Tab */}
            <button
              onClick={() => setLevelFilter("combos")}
              className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                levelFilter === "combos"
                  ? "bg-purple-500/20 text-purple-400 border border-purple-500/40 shadow-sm"
                  : "text-text-muted hover:bg-purple-500/10 hover:text-purple-400"
              }`}
            >
              <span className="material-symbols-outlined text-[15px]">layers</span>
              <span>Combos ({counts.combos})</span>
              {counts.comboFailures > 0 && (
                <span
                  className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-mono font-bold"
                  title={`${counts.comboFailures} fallback/failover events recorded`}
                >
                  {counts.comboFailures} fail
                </span>
              )}
            </button>

            <button
              onClick={() => setLevelFilter("error")}
              className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                levelFilter === "error"
                  ? "bg-red-500/20 text-red-400 border border-red-500/40 shadow-sm"
                  : "text-text-muted hover:bg-red-500/10 hover:text-red-400"
              }`}
            >
              <span className="size-2 rounded-full bg-red-500 inline-block" />
              Errors ({counts.errors})
            </button>
            <button
              onClick={() => setLevelFilter("warn")}
              className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                levelFilter === "warn"
                  ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 shadow-sm"
                  : "text-text-muted hover:bg-yellow-500/10 hover:text-yellow-400"
              }`}
            >
              <span className="size-2 rounded-full bg-yellow-500 inline-block" />
              Warnings ({counts.warns})
            </button>
            <button
              onClick={() => setLevelFilter("info")}
              className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-all cursor-pointer ${
                levelFilter === "info"
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/40 shadow-sm"
                  : "text-text-muted hover:bg-blue-500/10 hover:text-blue-400"
              }`}
            >
              Info ({counts.infos})
            </button>
          </div>

          {/* Search Box & Quick Controls */}
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            <div className="relative w-48 sm:w-64">
              <input
                type="text"
                placeholder="Search logs / errors..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full py-1.5 pl-8 pr-7 text-xs text-text-main bg-surface-2 rounded-[8px] border border-border focus:outline-none focus:ring-1 focus:ring-brand-500/50"
              />
              <span className="material-symbols-outlined absolute left-2 top-2 text-[16px] text-text-muted pointer-events-none">
                search
              </span>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-2 text-text-muted hover:text-text-main cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              )}
            </div>

            {/* Auto-scroll Toggle */}
            <Button
              size="sm"
              variant={autoScroll ? "secondary" : "outline"}
              icon={autoScroll ? "vertical_align_bottom" : "pause"}
              onClick={() => {
                const next = !autoScroll;
                setAutoScroll(next);
                if (next && logRef.current) {
                  isAutoScrollingRef.current = true;
                  logRef.current.scrollTop = logRef.current.scrollHeight;
                  requestAnimationFrame(() => {
                    isAutoScrollingRef.current = false;
                  });
                }
              }}
              title={autoScroll ? "Auto-scroll ON (click to pause)" : "Auto-scroll PAUSED (click to resume)"}
            >
              <span className="hidden sm:inline">{autoScroll ? "Auto-scroll" : "Paused"}</span>
            </Button>

            {/* Download Logs Button */}
            <Button
              size="sm"
              variant="outline"
              icon="download"
              onClick={() => handleDownloadLogs("screen")}
              title="Download visible logs"
            >
              <span className="hidden sm:inline">Export</span>
            </Button>

            {/* Clear / Truncate Dropdown */}
            <div className="relative" ref={clearMenuRef}>
              <Button
                size="sm"
                variant="outline"
                icon="delete"
                iconRight="arrow_drop_down"
                loading={isCleaning}
                onClick={() => setShowClearMenu(!showClearMenu)}
              >
                Clean
              </Button>
              {showClearMenu && (
                <div className="absolute right-0 top-full mt-1.5 w-60 bg-surface-1 border border-border rounded-[10px] shadow-xl py-1.5 z-50 text-xs">
                  <button
                    onClick={handleClearScreen}
                    className="w-full text-left px-3 py-2 hover:bg-surface-2 flex items-center gap-2 cursor-pointer text-text-main"
                  >
                    <span className="material-symbols-outlined text-[16px] text-text-muted">backspace</span>
                    <div>
                      <div className="font-medium">Clear Screen</div>
                      <div className="text-[10px] text-text-muted">Empty current RAM display buffer</div>
                    </div>
                  </button>
                  <div className="my-1 border-t border-border/60" />
                  <button
                    onClick={handleCleanDiskLogs}
                    className="w-full text-left px-3 py-2 hover:bg-red-500/10 text-red-400 flex items-center gap-2 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px] text-red-500">cleaning_services</span>
                    <div>
                      <div className="font-semibold">Truncate & Clean Disk</div>
                      <div className="text-[10px] text-red-400/80">
                        Wipe error.log on disk ({diskLogInfo.sizeFormatted}) & clear RAM
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dedicated Combo Secondary Filtering Toolbar */}
        {levelFilter === "combos" && (
          <div className="px-3 py-2.5 bg-purple-500/5 dark:bg-purple-950/20 border-b border-purple-500/20 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-purple-400 flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px]">filter_list</span>
                <span>Filter by Combo:</span>
              </span>

              <select
                value={selectedCombo}
                onChange={(e) => setSelectedCombo(e.target.value)}
                className="py-1 px-2.5 text-xs bg-surface-2 rounded-lg border border-border text-text-main focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
              >
                <option value="">All Combos ({counts.combos})</option>
                {allDetectedCombos.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1 ml-1 sm:ml-3">
                <button
                  onClick={() => setComboSubFilter("all")}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                    comboSubFilter === "all"
                      ? "bg-surface-3 text-text-main font-semibold shadow-xs"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  All Events ({counts.combos})
                </button>
                <button
                  onClick={() => setComboSubFilter("failures")}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer ${
                    comboSubFilter === "failures"
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/40 font-semibold shadow-xs"
                      : "text-text-muted hover:text-amber-400"
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">swap_horiz</span>
                  <span>Failovers & Errors ({counts.comboFailures})</span>
                </button>
                <button
                  onClick={() => setComboSubFilter("served")}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer ${
                    comboSubFilter === "served"
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-semibold shadow-xs"
                      : "text-text-muted hover:text-emerald-400"
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">check_circle</span>
                  <span>Served ({counts.comboServed})</span>
                </button>
              </div>
            </div>

            <div className="text-[11px] text-text-muted hidden lg:flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px] text-amber-400">info</span>
              <span>Monitors when primary models fail and trigger fallback routing.</span>
            </div>
          </div>
        )}

        {/* Subheader: Status & Disk Info */}
        <div className="px-4 py-2 bg-surface-2/60 border-b border-border flex items-center justify-between text-[11px] text-text-muted">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
              {connected ? "Real-time Streaming" : "Disconnected"}
            </span>
            <span>•</span>
            <span>
              Showing {filteredLogs.length} / {logs.length} entries
              {levelFilter === "combos" && ` (Combos: ${counts.combos}, ${counts.comboFailures} failovers)`}
            </span>
            {searchQuery && (
              <>
                <span>•</span>
                <span className="text-brand-500">Filtered by: &ldquo;{searchQuery}&rdquo;</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span>
              Disk error log: <strong className="text-text-main">{diskLogInfo.sizeFormatted}</strong>
            </span>
            {diskLogInfo.sizeBytes > 0 && (
              <button
                onClick={() => handleDownloadLogs("disk")}
                className="text-brand-500 hover:underline cursor-pointer flex items-center gap-0.5"
                title="Download raw error.log from disk"
              >
                <span className="material-symbols-outlined text-[14px]">file_download</span>
                Raw log
              </button>
            )}
          </div>
        </div>

        {/* Log Viewer Terminal */}
        <div className="relative">
          <div
            ref={logRef}
            onScroll={handleScroll}
            style={{ overflowAnchor: "none" }}
            className="bg-black text-xs font-mono h-[calc(100vh-250px)] overflow-y-auto p-3 space-y-1 select-text"
          >
            {filteredLogs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-text-muted gap-2 py-16">
                <span className="material-symbols-outlined text-[36px] opacity-40">
                  {levelFilter === "combos" ? "layers" : "terminal"}
                </span>
                <span>
                  {levelFilter === "combos"
                    ? selectedCombo
                      ? `No combo logs found for "${selectedCombo}".`
                      : "No combo fallback events recorded yet."
                    : searchQuery || levelFilter !== "all"
                    ? "No logs match the current filter."
                    : "No console logs captured yet."}
                </span>
              </div>
            ) : (
              filteredLogs.map((entry) => {
                const isCombo = entry.tag === "COMBO" || entry.raw?.includes("[COMBO]");
                const isComboFailover =
                  isCombo &&
                  (entry.level === "warn" ||
                    entry.level === "error" ||
                    entry.raw?.includes("failed") ||
                    entry.raw?.includes("falling back") ||
                    entry.raw?.includes("threw error"));
                const isComboServed =
                  isCombo && (entry.raw?.includes("✅") || entry.raw?.includes("served request"));
                const isComboAllFailed =
                  isCombo && (entry.raw?.includes("❌") || entry.raw?.includes("All models in combo failed"));

                const style = LEVEL_COLORS[entry.level] || LEVEL_COLORS.log;
                const isExpanded = expandedLogIds.has(entry.id);
                const hasStackOrDetails = !!(entry.stack || entry.details);

                return (
                  <div
                    key={entry.id}
                    className={`group relative rounded-[6px] p-1.5 transition-colors ${
                      isComboFailover
                        ? "bg-amber-950/20 hover:bg-amber-950/30 border-l-4 border-amber-500"
                        : isComboServed
                        ? "bg-emerald-950/20 hover:bg-emerald-950/30 border-l-4 border-emerald-500"
                        : isComboAllFailed
                        ? "bg-red-950/30 hover:bg-red-950/40 border-l-4 border-red-500"
                        : entry.level === "error"
                        ? "bg-red-950/20 hover:bg-red-950/30 border-l-2 border-red-500"
                        : entry.level === "warn"
                        ? "bg-yellow-950/15 hover:bg-yellow-950/25 border-l-2 border-yellow-500"
                        : "hover:bg-zinc-900/60 border-l-2 border-transparent"
                    }`}
                  >
                    <div className="flex items-start gap-2 leading-relaxed">
                      {/* Timestamp */}
                      {entry.timestamp && (
                        <span className="text-zinc-600 shrink-0 select-none text-[11px] pt-0.5">
                          {entry.timestamp}
                        </span>
                      )}

                      {/* Level Badge */}
                      <span
                        className={`shrink-0 px-1.5 py-0.2 rounded text-[10px] font-bold uppercase tracking-wide select-none ${style.badge}`}
                      >
                        {entry.level}
                      </span>

                      {/* Tag Badge */}
                      {entry.tag && (
                        <span
                          className={`shrink-0 px-1.5 py-0.2 rounded text-[10px] font-semibold select-none ${
                            isCombo
                              ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                              : "bg-zinc-800/80 text-cyan-400 border border-zinc-700/60"
                          }`}
                        >
                          [{entry.tag}]
                        </span>
                      )}

                      {/* Combo Failover Icon Indicator */}
                      {isComboFailover && (
                        <span
                          className="shrink-0 px-1 py-0.2 rounded text-[10px] font-bold bg-amber-500/25 text-amber-300 border border-amber-500/40 flex items-center gap-0.5 select-none"
                          title="Fallback Failover Triggered"
                        >
                          <span className="material-symbols-outlined text-[12px]">swap_horiz</span>
                          <span>FAILOVER</span>
                        </span>
                      )}

                      {/* Main Log Message */}
                      <div
                        className={`flex-1 break-words whitespace-pre-wrap ${
                          isComboFailover
                            ? "text-amber-200 font-medium"
                            : isComboServed
                            ? "text-emerald-200"
                            : isComboAllFailed
                            ? "text-red-300 font-semibold"
                            : style.text
                        }`}
                      >
                        {entry.message}
                      </div>

                      {/* Action Bar (Copy & Expand) */}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0 select-none">
                        {hasStackOrDetails && (
                          <button
                            onClick={() => toggleExpand(entry.id)}
                            className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] flex items-center gap-0.5 cursor-pointer"
                            title="Toggle Stack Trace & Details"
                          >
                            <span className="material-symbols-outlined text-[12px]">
                              {isExpanded ? "expand_less" : "expand_more"}
                            </span>
                            {isExpanded ? "Collapse" : "Details"}
                          </button>
                        )}
                        <button
                          onClick={() => handleCopy(entry.raw, entry.id)}
                          className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] flex items-center gap-0.5 cursor-pointer"
                          title="Copy log entry"
                        >
                          <span className="material-symbols-outlined text-[12px]">
                            {copiedId === entry.id ? "check" : "content_copy"}
                          </span>
                          {copiedId === entry.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>

                    {/* Expandable Stack Trace & Error Details */}
                    {hasStackOrDetails && isExpanded && (
                      <div className="mt-2 ml-6 p-2.5 bg-zinc-950/90 border border-zinc-800 rounded-[6px] text-[11px] space-y-2">
                        {/* Structured Details if available */}
                        {entry.details && (
                          <div>
                            <div className="text-zinc-500 font-semibold mb-1 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">data_object</span>
                              Details:
                            </div>
                            <pre className="p-2 bg-black/60 rounded text-yellow-300 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px]">
                              {JSON.stringify(entry.details, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Stack Trace */}
                        {entry.stack && (
                          <div>
                            <div className="text-zinc-500 font-semibold mb-1 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">bug_report</span>
                              Stack Trace:
                            </div>
                            <pre className="p-2 bg-black/60 rounded text-red-400 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px]">
                              {entry.stack}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
