import { EventEmitter } from "events";
import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { DATA_DIR } from "./dataDir.js";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";

const consoleLevels = ["log", "info", "warn", "error", "debug"];
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str) {
  if (typeof str !== "string") return "";
  return str.replace(ANSI_RE, "");
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const LOG_DIR = path.join(DATA_DIR, "logs");
const ERROR_LOG_PATH = path.join(LOG_DIR, "error.log");
const ERROR_OLD_LOG_PATH = path.join(LOG_DIR, "error.old.log");
const MAX_DISK_SIZE = CONSOLE_LOG_CONFIG.maxDiskSizeBytes || 5 * 1024 * 1024; // 5MB

if (!global._consoleLogBufferState) {
  global._consoleLogBufferState = {
    logs: [],
    counter: 0,
    patched: false,
    originals: {},
    emitter: new EventEmitter(),
    pendingEntries: [],
    flushTimer: null,
    diskQueue: [],
    diskFlushTimer: null,
    processListenersAttached: false,
  };
  global._consoleLogBufferState.emitter.setMaxListeners(50);
}

const state = global._consoleLogBufferState;

if (!state.emitter) {
  state.emitter = new EventEmitter();
  state.emitter.setMaxListeners(50);
}
if (!state.pendingEntries) state.pendingEntries = [];
if (!state.diskQueue) state.diskQueue = [];

const FLUSH_INTERVAL_MS = 100;
const MAX_BATCH_ENTRIES = 50;

// Disk flush logic (append error and warn logs to error.log with rotation)
function flushDiskQueue() {
  state.diskFlushTimer = null;
  if (!state.diskQueue || state.diskQueue.length === 0) return;

  const entriesToWrite = state.diskQueue.splice(0, state.diskQueue.length);
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    // Check file size for rotation before appending
    if (fs.existsSync(ERROR_LOG_PATH)) {
      const stats = fs.statSync(ERROR_LOG_PATH);
      if (stats.size >= MAX_DISK_SIZE) {
        try {
          if (fs.existsSync(ERROR_OLD_LOG_PATH)) {
            fs.rmSync(ERROR_OLD_LOG_PATH, { force: true });
          }
          fs.renameSync(ERROR_LOG_PATH, ERROR_OLD_LOG_PATH);
        } catch {
          // Fallback: truncate if rename fails
          fs.writeFileSync(ERROR_LOG_PATH, "");
        }
      }
    }

    const payload = entriesToWrite.map((e) => {
      const tagStr = e.tag ? ` [${e.tag}]` : "";
      let text = `[${e.isoTime}] [${e.level.toUpperCase()}]${tagStr} ${e.message}\n`;
      if (e.stack) {
        text += `  Stack: ${e.stack}\n`;
      }
      if (e.details) {
        text += `  Details: ${JSON.stringify(e.details)}\n`;
      }
      return text;
    }).join("");

    fs.appendFileSync(ERROR_LOG_PATH, payload, "utf8");
  } catch (err) {
    // Fail silently to avoid recursion in logging
  }
}

function scheduleDiskFlush() {
  if (state.diskFlushTimer) return;
  state.diskFlushTimer = setTimeout(flushDiskQueue, 1000);
  state.diskFlushTimer?.unref?.();
}

function flushPendingEntries() {
  state.flushTimer = null;
  if (!state.pendingEntries.length) return;

  const entries = state.pendingEntries.splice(0, state.pendingEntries.length);
  state.emitter.emit("entries", entries);
  // Keep emitting legacy "lines" event with raw strings for backward compatibility
  state.emitter.emit("lines", entries.map((e) => e.raw));
}

function scheduleFlush() {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(flushPendingEntries, FLUSH_INTERVAL_MS);
  state.flushTimer?.unref?.();
}

function extractErrorDetails(err) {
  if (!err) return { stack: null, details: null };
  const details = {};
  let stack = null;

  if (err instanceof Error || (typeof err === "object" && err.stack && err.message)) {
    stack = err.stack ? stripAnsi(err.stack) : null;
    if (err.name && err.name !== "Error") details.name = err.name;
    if (err.code) details.code = err.code;
    if (err.status || err.statusCode) details.status = err.status || err.statusCode;
    if (err.cause) {
      details.cause = err.cause instanceof Error
        ? (err.cause.stack || err.cause.message)
        : err.cause;
    }
    if (err.response?.status) details.upstreamStatus = err.response.status;
    if (err.response?.data) details.upstreamData = err.response.data;
    if (Array.isArray(err.errors)) {
      details.errors = err.errors.map((e) => (e?.stack || e?.message || String(e)));
    }
    // Inspect other non-standard properties
    for (const key of Object.getOwnPropertyNames(err)) {
      if (!["name", "message", "stack", "cause", "code", "status", "statusCode", "response", "errors"].includes(key)) {
        try {
          details[key] = err[key];
        } catch {
          /* ignore */
        }
      }
    }
  }

  return {
    stack,
    details: Object.keys(details).length > 0 ? details : null,
  };
}

function buildLogEntry(originalLevel, args) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour12: false });
  const isoTime = now.toISOString();

  // Inspect arguments safely using node:util
  const formattedRaw = stripAnsi(
    util.formatWithOptions(
      { depth: 4, maxArrayLength: 50, breakLength: 120, colors: false },
      ...args
    )
  );

  let stack = null;
  let details = null;

  // Scan args for Error instances
  for (const arg of args) {
    if (arg instanceof Error || (typeof arg === "object" && arg !== null && (arg.stack || arg.code || arg.statusCode))) {
      const res = extractErrorDetails(arg);
      if (res.stack) stack = res.stack;
      if (res.details) details = { ...(details || {}), ...res.details };
    }
  }

  // Determine actual level
  let level = originalLevel;
  if (level === "log") {
    if (formattedRaw.includes("❌") || /\[error\]/i.test(formattedRaw) || stack) {
      level = "error";
    } else if (formattedRaw.includes("⚠️") || /\[warn\]/i.test(formattedRaw)) {
      level = "warn";
    } else if (formattedRaw.includes("ℹ️") || /\[info\]/i.test(formattedRaw)) {
      level = "info";
    } else if (formattedRaw.includes("🔍") || /\[debug\]/i.test(formattedRaw)) {
      level = "debug";
    }
  }

  // Extract tag if present: e.g. "[CHAT]", "[MITM]", "[AUTH]"
  let tag = null;
  const tagMatch = formattedRaw.match(/\[([A-Za-z0-9_-]{2,20})\]/);
  if (tagMatch) {
    tag = tagMatch[1];
  }

  // Format main message
  const lines = formattedRaw.split("\n");
  const message = lines[0] || "";

  state.counter = (state.counter + 1) % 1000000;
  const id = `log_${Date.now()}_${state.counter}`;

  return {
    id,
    timestamp: timeStr,
    isoTime,
    level,
    tag,
    message,
    stack: stack || (lines.length > 1 ? lines.slice(1).join("\n") : null),
    details,
    raw: formattedRaw,
  };
}

function appendEntry(originalLevel, args) {
  const entry = buildLogEntry(originalLevel, args);

  state.logs.push(entry);
  const maxLines = CONSOLE_LOG_CONFIG.maxLines || 1000;
  if (state.logs.length > maxLines) {
    state.logs = state.logs.slice(-maxLines);
  }

  state.pendingEntries.push(entry);

  // Queue to disk if warning or error
  if (entry.level === "error" || entry.level === "warn") {
    state.diskQueue.push(entry);
    scheduleDiskFlush();
  }

  if (state.pendingEntries.length >= MAX_BATCH_ENTRIES) {
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    flushPendingEntries();
  } else {
    scheduleFlush();
  }
}

export function initConsoleLogCapture() {
  if (state.patched) return;

  for (const level of consoleLevels) {
    state.originals[level] = console[level];
    console[level] = (...args) => {
      try {
        appendEntry(level, args);
      } catch {
        /* avoid crashing logging hook */
      }
      state.originals[level](...args);
    };
  }

  // Catch process unhandled errors
  if (!state.processListenersAttached && typeof process !== "undefined" && process.on) {
    process.on("unhandledRejection", (reason) => {
      try {
        const entry = buildLogEntry("error", ["[UnhandledRejection]", reason]);
        state.logs.push(entry);
        state.pendingEntries.push(entry);
        state.diskQueue.push(entry);
        scheduleFlush();
        scheduleDiskFlush();
      } catch {
        /* ignore */
      }
    });

    process.on("uncaughtException", (err, origin) => {
      try {
        const entry = buildLogEntry("error", [`[UncaughtException] (${origin})`, err]);
        state.logs.push(entry);
        state.pendingEntries.push(entry);
        state.diskQueue.push(entry);
        scheduleFlush();
        scheduleDiskFlush();
      } catch {
        /* ignore */
      }
    });

    state.processListenersAttached = true;
  }

  state.patched = true;
}

export function getConsoleLogs() {
  return state.logs;
}

export function clearConsoleLogs() {
  state.logs = [];
  state.pendingEntries = [];
  state.emitter.emit("clear");
}

export function getConsoleEmitter() {
  return state.emitter;
}

export function truncateDiskLogs() {
  try {
    if (state.diskFlushTimer) {
      clearTimeout(state.diskFlushTimer);
      state.diskFlushTimer = null;
    }
    state.diskQueue = [];

    if (fs.existsSync(ERROR_LOG_PATH)) {
      fs.writeFileSync(ERROR_LOG_PATH, "");
    }
    if (fs.existsSync(ERROR_OLD_LOG_PATH)) {
      fs.rmSync(ERROR_OLD_LOG_PATH, { force: true });
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}

export function getDiskLogInfo() {
  let sizeBytes = 0;
  try {
    if (fs.existsSync(ERROR_LOG_PATH)) {
      sizeBytes += fs.statSync(ERROR_LOG_PATH).size;
    }
    if (fs.existsSync(ERROR_OLD_LOG_PATH)) {
      sizeBytes += fs.statSync(ERROR_OLD_LOG_PATH).size;
    }
  } catch {
    /* ignore */
  }

  return {
    path: ERROR_LOG_PATH,
    sizeBytes,
    sizeFormatted: formatBytes(sizeBytes),
  };
}
