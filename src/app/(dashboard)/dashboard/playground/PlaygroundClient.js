"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { Badge, Button, Card, Modal, ModelSelectModal, Toggle, CapacityBadges } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";

marked.setOptions({ gfm: true, breaks: true });

const STORAGE_KEYS = {
  sessions: "9router.playground.sessions",
  activeSessionId: "9router.playground.activeSessionId",
  params: "9router.playground.params",
};

const DEFAULT_PARAMS = {
  model: "ds/deepseek-chat",
  systemPrompt: "You are a helpful, capable, and honest AI assistant.",
  temperature: 0.7,
  maxTokens: 2048,
  topP: 1.0,
  reasoningEffort: "auto",
  stream: true,
};

const REASONING_EFFORT_OPTIONS = ["auto", "none", "low", "medium", "high", "max"];

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function truncateTitle(text = "") {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New session";
  return clean.length > 36 ? `${clean.slice(0, 36).trimEnd()}…` : clean;
}

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function PlaygroundClient() {
  const [params, setParams] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_PARAMS;
    const saved = safeJsonParse(globalThis.localStorage?.getItem(STORAGE_KEYS.params), null);
    return saved ? { ...DEFAULT_PARAMS, ...saved } : DEFAULT_PARAMS;
  });

  const [sessions, setSessions] = useState(() => {
    if (typeof window === "undefined") {
      return [{
        id: "default-session",
        title: "New session",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      }];
    }
    const saved = safeJsonParse(globalThis.localStorage?.getItem(STORAGE_KEYS.sessions), []);
    if (Array.isArray(saved) && saved.length > 0) return saved;
    return [{
      id: createId(),
      title: "New session",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    }];
  });

  const [activeSessionId, setActiveSessionId] = useState(() => {
    if (typeof window === "undefined") return "default-session";
    const savedActiveId = globalThis.localStorage?.getItem(STORAGE_KEYS.activeSessionId) || "";
    const saved = safeJsonParse(globalThis.localStorage?.getItem(STORAGE_KEYS.sessions), []);
    if (Array.isArray(saved) && saved.length > 0) {
      const exists = saved.some((s) => s.id === savedActiveId);
      return exists ? savedActiveId : saved[0].id;
    }
    return "default-session";
  });

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState("");
  const [activeProviders, setActiveProviders] = useState([]);
  const [availableModels, setAvailableModels] = useState([]);
  const [availableCombos, setAvailableCombos] = useState([]);

  // UI state
  const [showSessionsSidebar, setShowSessionsSidebar] = useState(true);
  const [showParamsSidebar, setShowParamsSidebar] = useState(true);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [codeLang, setCodeLang] = useState("curl");
  const [inspectMessage, setInspectMessage] = useState(null);

  const { getCaps } = useModelCaps();
  const { copied, copy } = useCopyToClipboard(2000);

  const abortRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  // Fetch providers, models, combos
  useEffect(() => {
    async function loadResources() {
      try {
        const [provRes, modelsRes, combosRes] = await Promise.all([
          fetch("/api/providers", { cache: "no-store" }),
          fetch("/api/models", { cache: "no-store" }),
          fetch("/api/combos", { cache: "no-store" }),
        ]);

        if (provRes.ok) {
          const provData = await provRes.json();
          setActiveProviders(provData.connections || []);
        }
        if (modelsRes.ok) {
          const mData = await modelsRes.json();
          setAvailableModels(Array.isArray(mData) ? mData : mData.models || []);
        }
        if (combosRes.ok) {
          const cData = await combosRes.json();
          setAvailableCombos(cData.combos || []);
        }
      } catch (err) {
        console.warn("[Playground] Error loading resources:", err);
      }
    }
    loadResources();
  }, []);

  // Persist sessions
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
      if (activeSessionId) {
        globalThis.localStorage?.setItem(STORAGE_KEYS.activeSessionId, activeSessionId);
      }
    } catch {
      // quota
    }
  }, [sessions, activeSessionId]);

  // Persist params
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEYS.params, JSON.stringify(params));
    } catch {
      // quota
    }
  }, [params]);

  // Auto scroll messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [sessions, streamingMessageId]);

  const activeSession = useMemo(() => {
    return sessions.find((s) => s.id === activeSessionId) || sessions[0] || null;
  }, [sessions, activeSessionId]);

  const currentMessages = useMemo(() => {
    return activeSession?.messages || [];
  }, [activeSession]);

  const handleNewSession = () => {
    const newSession = {
      id: createId(),
      title: "New session",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setDraft("");
    setAttachments([]);
  };

  const handleDeleteSession = (sessionId, e) => {
    e?.stopPropagation();
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== sessionId);
      if (remaining.length === 0) {
        const fresh = {
          id: createId(),
          title: "New session",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
        };
        setActiveSessionId(fresh.id);
        return [fresh];
      }
      if (sessionId === activeSessionId) {
        setActiveSessionId(remaining[0].id);
      }
      return remaining;
    });
  };

  const handleClearMessages = () => {
    if (!activeSession) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
          ? { ...s, messages: [], updatedAt: new Date().toISOString() }
          : s
      )
    );
  };

  const handleAttachFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) {
      e.target.value = "";
      return;
    }
    const converted = await Promise.all(
      images.map(async (file) => ({
        id: createId(),
        name: file.name,
        type: file.type,
        dataUrl: await fileToDataUrl(file),
      }))
    );
    setAttachments((prev) => [...prev, ...converted]);
    e.target.value = "";
  };

  const removeAttachment = (id) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleStopGeneration = () => {
    abortRef.current?.abort();
  };

  const handleSendMessage = async () => {
    const userText = draft.trim();
    if (!userText && attachments.length === 0) return;
    if (isSending) return;

    let targetSession = activeSession;
    if (!targetSession) {
      targetSession = {
        id: createId(),
        title: truncateTitle(userText),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      };
      setSessions([targetSession]);
      setActiveSessionId(targetSession.id);
    }

    const userMessageId = createId();
    const assistantMessageId = createId();

    const userMessage = {
      id: userMessageId,
      role: "user",
      content: userText,
      attachments: attachments.map((a) => ({ id: a.id, name: a.name, dataUrl: a.dataUrl })),
      timestamp: new Date().toISOString(),
    };

    const initialAssistantMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      thinking: "",
      status: "streaming",
      timestamp: new Date().toISOString(),
      model: params.model,
    };

    const nextMessages = [...targetSession.messages, userMessage, initialAssistantMessage];

    setSessions((prev) =>
      prev.map((s) =>
        s.id === targetSession.id
          ? {
              ...s,
              title: s.title === "New session" ? truncateTitle(userText) : s.title,
              messages: nextMessages,
              updatedAt: new Date().toISOString(),
            }
          : s
      )
    );

    setDraft("");
    setAttachments([]);
    setIsSending(true);
    setStreamingMessageId(assistantMessageId);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    // Prepare API messages
    const requestMessages = [];
    if (params.systemPrompt?.trim()) {
      requestMessages.push({ role: "system", content: params.systemPrompt.trim() });
    }

    for (const msg of nextMessages) {
      if (msg.id === assistantMessageId) continue;
      if (msg.role === "user") {
        if (msg.attachments && msg.attachments.length > 0) {
          const parts = [];
          if (msg.content) parts.push({ type: "text", text: msg.content });
          for (const att of msg.attachments) {
            if (att.dataUrl) {
              parts.push({ type: "image_url", image_url: { url: att.dataUrl } });
            }
          }
          requestMessages.push({ role: "user", content: parts });
        } else {
          requestMessages.push({ role: "user", content: msg.content });
        }
      } else if (msg.role === "assistant") {
        requestMessages.push({ role: "assistant", content: msg.content });
      }
    }

    const requestPayload = {
      model: params.model,
      messages: requestMessages,
      temperature: Number(params.temperature),
      max_tokens: Number(params.maxTokens),
      top_p: Number(params.topP),
      stream: Boolean(params.stream),
    };

    if (params.reasoningEffort && params.reasoningEffort !== "auto") {
      requestPayload.reasoning_effort = params.reasoningEffort;
    }

    const startTime = Date.now();
    let ttft = null;
    let accumulatedContent = "";
    let accumulatedThinking = "";
    let rawResponseText = "";

    try {
      const res = await fetch("/api/playground/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const errMsg = errJson?.error?.message || errJson?.error || errJson?.message || `HTTP ${res.status}`;
        throw new Error(errMsg);
      }

      if (params.stream) {
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (ttft === null) {
            ttft = Date.now() - startTime;
          }

          const chunkText = decoder.decode(value, { stream: true });
          rawResponseText += chunkText;
          sseBuffer += chunkText;

          const lines = sseBuffer.split(/\r?\n/);
          sseBuffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const dataStr = trimmed.slice(5).trim();
            if (!dataStr || dataStr === "[DONE]") continue;

            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices?.[0]?.delta;
              if (!delta) continue;

              // Extract thinking (reasoning_content or reasoning)
              const thinkingChunk = delta.reasoning_content || delta.reasoning;
              if (thinkingChunk) {
                accumulatedThinking += thinkingChunk;
              }

              // Extract regular text content
              if (delta.content) {
                accumulatedContent += delta.content;
              }

              // Update session message state
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === targetSession.id
                    ? {
                        ...s,
                        messages: s.messages.map((m) =>
                          m.id === assistantMessageId
                            ? {
                                ...m,
                                content: accumulatedContent,
                                thinking: accumulatedThinking,
                                status: "streaming",
                              }
                            : m
                        ),
                      }
                    : s
                )
              );
            } catch {
              // Ignore malformed chunks
            }
          }
        }
      } else {
        // Non-streaming response
        const data = await res.json();
        rawResponseText = JSON.stringify(data, null, 2);
        ttft = Date.now() - startTime;

        const choice = data.choices?.[0];
        accumulatedContent = choice?.message?.content || "";
        accumulatedThinking = choice?.message?.reasoning_content || choice?.message?.reasoning || "";
      }

      const totalLatency = Date.now() - startTime;

      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSession.id
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        content: accumulatedContent,
                        thinking: accumulatedThinking,
                        status: "done",
                        latencyMs: totalLatency,
                        ttftMs: ttft || totalLatency,
                        rawRequest: requestPayload,
                        rawResponse: rawResponseText,
                      }
                    : m
                ),
              }
            : s
        )
      );
    } catch (err) {
      if (err.name !== "AbortError") {
        const errorMsg = err.message || "Failed to generate response";
        setSessions((prev) =>
          prev.map((s) =>
            s.id === targetSession.id
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantMessageId
                      ? {
                          ...m,
                          content: accumulatedContent ? `${accumulatedContent}\n\n⚠️ **Error:** ${errorMsg}` : `⚠️ **Error:** ${errorMsg}`,
                          thinking: accumulatedThinking,
                          status: "error",
                          rawRequest: requestPayload,
                          rawResponse: rawResponseText || errorMsg,
                        }
                      : m
                  ),
                }
              : s
          )
        );
      } else {
        // Aborted
        setSessions((prev) =>
          prev.map((s) =>
            s.id === targetSession.id
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantMessageId
                      ? {
                          ...m,
                          content: accumulatedContent ? `${accumulatedContent} *(generation stopped)*` : "*(generation stopped)*",
                          thinking: accumulatedThinking,
                          status: "stopped",
                          rawRequest: requestPayload,
                          rawResponse: rawResponseText,
                        }
                      : m
                  ),
                }
              : s
          )
        );
      }
    } finally {
      setIsSending(false);
      setStreamingMessageId("");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Code Export generator
  const generatedCode = useMemo(() => {
    const msgs = [];
    if (params.systemPrompt?.trim()) {
      msgs.push({ role: "system", content: params.systemPrompt.trim() });
    }
    for (const m of currentMessages.slice(-4)) {
      if (m.status !== "error") {
        msgs.push({ role: m.role, content: m.content });
      }
    }
    if (msgs.length === 0) {
      msgs.push({ role: "user", content: "Hello!" });
    }

    const payload = {
      model: params.model,
      messages: msgs,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      top_p: params.topP,
      stream: params.stream,
    };
    if (params.reasoningEffort && params.reasoningEffort !== "auto") {
      payload.reasoning_effort = params.reasoningEffort;
    }

    const host = typeof window !== "undefined" ? window.location.origin : "http://localhost:20128";

    if (codeLang === "curl") {
      return `curl ${host}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '${JSON.stringify(payload, null, 2)}'`;
    }

    if (codeLang === "python") {
      return `from openai import OpenAI

client = OpenAI(
    base_url="${host}/v1",
    api_key="YOUR_API_KEY",
)

response = client.chat.completions.create(
    model="${params.model}",
    messages=${JSON.stringify(msgs, null, 4)},
    temperature=${params.temperature},
    max_tokens=${params.maxTokens},
    stream=${params.stream ? "True" : "False"},
)

${
  params.stream
    ? `for chunk in response:
    delta = chunk.choices[0].delta
    if getattr(delta, "reasoning_content", None):
        print(delta.reasoning_content, end="", flush=True)
    if delta.content:
        print(delta.content, end="", flush=True)`
    : `print(response.choices[0].message.content)`
}`;
    }

    if (codeLang === "javascript") {
      return `import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "${host}/v1",
  apiKey: "YOUR_API_KEY",
});

const response = await openai.chat.completions.create({
  model: "${params.model}",
  messages: ${JSON.stringify(msgs, null, 2)},
  temperature: ${params.temperature},
  max_tokens: ${params.maxTokens},
  stream: ${params.stream},
});

${
  params.stream
    ? `for await (const chunk of response) {
  const delta = chunk.choices[0]?.delta;
  if (delta?.reasoning_content) process.stdout.write(delta.reasoning_content);
  if (delta?.content) process.stdout.write(delta.content);
}`
    : `console.log(response.choices[0]?.message?.content);`
}`;
    }

    return `fetch("${host}/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_API_KEY",
  },
  body: JSON.stringify(${JSON.stringify(payload, null, 2)}),
});`;
  }, [params, currentMessages, codeLang]);

  const activeModelCaps = useMemo(() => {
    return getCaps?.(params.model) || null;
  }, [params.model, getCaps]);

  return (
    <div className="flex-1 w-full h-[calc(100vh-64px)] flex overflow-hidden bg-bg">
      {/* 1. SESSIONS SIDEBAR (Collapsible) */}
      <div
        className={`border-r border-border bg-surface transition-all duration-300 ease-in-out flex flex-col shrink-0 ${
          showSessionsSidebar ? "w-64" : "w-0 overflow-hidden border-r-0"
        }`}
      >
        <div className="p-3 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">science</span>
            <span className="font-semibold text-sm text-text-main">Playground</span>
          </div>
          <button
            onClick={() => setShowSessionsSidebar(false)}
            className="p-1 rounded text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5"
            title="Collapse history"
          >
            <span className="material-symbols-outlined text-[18px]">left_panel_close</span>
          </button>
        </div>

        <div className="p-2.5 shrink-0">
          <Button
            variant="primary"
            size="sm"
            icon="add"
            onClick={handleNewSession}
            className="w-full justify-center"
          >
            New Session
          </Button>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-2 space-y-1">
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                onClick={() => setActiveSessionId(session.id)}
                className={`group relative flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer transition-all ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium border border-primary/20"
                    : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-main"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <span className="material-symbols-outlined text-[16px] shrink-0 opacity-70">
                    chat_bubble
                  </span>
                  <span className="truncate">{session.title || "New session"}</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => handleDeleteSession(session.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-opacity"
                  title="Delete session"
                >
                  <span className="material-symbols-outlined text-[14px]">delete</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Clear all */}
        {sessions.length > 1 && (
          <div className="p-2 border-t border-border shrink-0">
            <button
              onClick={() => {
                if (confirm("Clear all chat sessions?")) {
                  const fresh = {
                    id: createId(),
                    title: "New session",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    messages: [],
                  };
                  setSessions([fresh]);
                  setActiveSessionId(fresh.id);
                }
              }}
              className="w-full text-center py-1 text-[11px] text-text-muted hover:text-red-500"
            >
              Clear all history
            </button>
          </div>
        )}
      </div>

      {/* 2. MAIN CHAT CANVAS */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* Top Control Bar */}
        <div className="h-14 border-b border-border bg-surface px-4 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {!showSessionsSidebar && (
              <button
                onClick={() => setShowSessionsSidebar(true)}
                className="p-1.5 rounded-lg border border-border text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5"
                title="Open history"
              >
                <span className="material-symbols-outlined text-[18px]">left_panel_open</span>
              </button>
            )}

            {/* Model Badge & Picker */}
            <button
              onClick={() => setShowModelModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border hover:border-primary/40 bg-bg hover:bg-primary/5 transition-all text-left"
              title="Click to change model"
            >
              <span className="material-symbols-outlined text-primary text-[18px]">smart_toy</span>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-medium text-xs text-text-main">{params.model}</span>
                  <span className="material-symbols-outlined text-[14px] text-text-muted">expand_more</span>
                </div>
              </div>
              <CapacityBadges caps={activeModelCaps} />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Toggle System Prompt Button */}
            <button
              onClick={() => setShowSystemPrompt(!showSystemPrompt)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                showSystemPrompt || params.systemPrompt !== DEFAULT_PARAMS.systemPrompt
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border text-text-muted hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-main"
              }`}
              title="Toggle System Prompt"
            >
              <span className="material-symbols-outlined text-[16px]">tune</span>
              <span className="hidden sm:inline">System Prompt</span>
            </button>

            {/* Clear messages */}
            <button
              onClick={handleClearMessages}
              disabled={currentMessages.length === 0}
              className="p-2 rounded-lg border border-border text-text-muted hover:text-red-500 hover:bg-red-500/10 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              title="Clear messages in this session"
            >
              <span className="material-symbols-outlined text-[18px]">clear_all</span>
            </button>

            {/* View Code */}
            <button
              onClick={() => setShowCodeModal(true)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex items-center gap-1"
              title="View code snippet"
            >
              <span className="material-symbols-outlined text-[16px]">code</span>
              <span className="hidden sm:inline">View Code</span>
            </button>

            {/* Toggle Params Sidebar */}
            <button
              onClick={() => setShowParamsSidebar(!showParamsSidebar)}
              className={`p-2 rounded-lg border transition-colors ${
                showParamsSidebar
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5"
              }`}
              title="Toggle Parameters Sidebar"
            >
              <span className="material-symbols-outlined text-[18px]">settings</span>
            </button>
          </div>
        </div>

        {/* System Prompt Bar (Collapsible) */}
        {showSystemPrompt && (
          <div className="border-b border-border bg-surface-2/60 p-3 shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-text-main flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px] text-primary">terminal</span>
                System Instructions
              </span>
              <button
                onClick={() => setParams((p) => ({ ...p, systemPrompt: DEFAULT_PARAMS.systemPrompt }))}
                className="text-[11px] text-text-muted hover:text-primary transition-colors"
              >
                Reset default
              </button>
            </div>
            <textarea
              rows={2}
              value={params.systemPrompt}
              onChange={(e) => setParams((p) => ({ ...p, systemPrompt: e.target.value }))}
              placeholder="Enter instructions that guide model behavior..."
              className="w-full text-xs p-2.5 rounded-lg border border-border bg-surface text-text-main outline-none focus:border-primary/50 resize-y"
            />
          </div>
        )}

        {/* Message History List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 space-y-6">
          {currentMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto py-12">
              <div className="size-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-4 shadow-sm">
                <span className="material-symbols-outlined text-3xl">science</span>
              </div>
              <h2 className="text-lg font-semibold text-text-main mb-1">9Router Playground</h2>
              <p className="text-xs text-text-muted mb-6">
                Test models, tune parameters, benchmark reasoning models, and inspect raw API traffic.
              </p>

              {/* Quick suggestions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full text-left">
                {[
                  "Write a Python script to scrape a website",
                  "Explain quantum computing in simple terms",
                  "Compare SQL vs NoSQL databases",
                  "Solve this logic puzzle step by step",
                ].map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setDraft(prompt);
                      textareaRef.current?.focus();
                    }}
                    className="p-3 rounded-xl border border-border bg-surface hover:border-primary/40 hover:bg-primary/5 transition-all text-xs text-text-muted hover:text-text-main"
                  >
                    💡 {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            currentMessages.map((msg) => (
              <div key={msg.id} className="space-y-2">
                {msg.role === "user" ? (
                  /* User Bubble */
                  <div className="flex justify-end">
                    <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl bg-primary text-white p-3.5 shadow-sm space-y-2">
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {msg.attachments.map((att) => (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              key={att.id}
                              src={att.dataUrl}
                              alt={att.name}
                              className="size-20 object-cover rounded-lg border border-white/20"
                            />
                          ))}
                        </div>
                      )}
                      <p className="text-xs md:text-sm whitespace-pre-wrap leading-relaxed">
                        {msg.content}
                      </p>
                    </div>
                  </div>
                ) : (
                  /* Assistant Bubble */
                  <div className="flex justify-start">
                    <div className="max-w-[95%] sm:max-w-[85%] rounded-2xl border border-border bg-surface p-4 shadow-sm space-y-3">
                      {/* Model & Header */}
                      <div className="flex items-center justify-between text-[11px] text-text-muted pb-1 border-b border-border/50">
                        <div className="flex items-center gap-1.5 font-mono">
                          <span className="size-2 rounded-full bg-emerald-500 inline-block" />
                          <span className="font-semibold text-text-main">{msg.model || params.model}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {msg.latencyMs && (
                            <span title="Total Latency">⚡ {(msg.latencyMs / 1000).toFixed(2)}s</span>
                          )}
                          {msg.ttftMs && (
                            <span title="Time to First Token">⏱️ {msg.ttftMs}ms TTFT</span>
                          )}
                          {msg.rawRequest && (
                            <button
                              onClick={() => setInspectMessage(msg)}
                              className="text-primary hover:underline flex items-center gap-0.5"
                              title="Inspect JSON request and response"
                            >
                              <span className="material-symbols-outlined text-[13px]">data_object</span>
                              <span>Inspect</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Thinking / Reasoning Accordion */}
                      {msg.thinking && (
                        <ThinkingBlock
                          thinking={msg.thinking}
                          isStreaming={msg.status === "streaming" && !msg.content}
                        />
                      )}

                      {/* Main Assistant Content */}
                      {msg.content ? (
                        <div
                          className="text-xs md:text-sm prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: marked.parse(msg.content) }}
                        />
                      ) : msg.status === "streaming" ? (
                        <div className="flex items-center gap-2 text-xs text-text-muted py-2">
                          <span className="size-2 rounded-full bg-primary animate-ping" />
                          <span>Generating answer...</span>
                        </div>
                      ) : null}

                      {/* Action Bar */}
                      <div className="flex items-center justify-end gap-1 pt-1">
                        <button
                          onClick={() => copy(msg.content, `msg-${msg.id}`)}
                          className="p-1 rounded text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          title="Copy response"
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            {copied === `msg-${msg.id}` ? "check" : "content_copy"}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t border-border bg-surface shrink-0">
          <div className="max-w-4xl mx-auto space-y-2">
            {/* Attachment preview */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 p-2 bg-surface-2/50 rounded-lg border border-border">
                {attachments.map((a) => (
                  <div key={a.id} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.dataUrl} alt={a.name} className="size-14 object-cover rounded-lg border border-border" />
                    <button
                      onClick={() => removeAttachment(a.id)}
                      className="absolute -top-1.5 -right-1.5 size-4 bg-red-500 text-white rounded-full flex items-center justify-center text-[10px]"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2 bg-bg border border-border rounded-xl p-2 focus-within:border-primary/50 transition-colors shadow-inner">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleAttachFiles}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-text-muted hover:text-primary rounded-lg transition-colors"
                title="Attach images (for vision models)"
              >
                <span className="material-symbols-outlined text-[20px]">add_photo_alternate</span>
              </button>

              <textarea
                ref={textareaRef}
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your prompt here... (Enter to send, Shift+Enter for new line)"
                className="flex-1 bg-transparent text-xs md:text-sm text-text-main outline-none resize-none max-h-36 py-1 custom-scrollbar"
              />

              {isSending ? (
                <button
                  type="button"
                  onClick={handleStopGeneration}
                  className="p-2.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors shrink-0 shadow-sm"
                  title="Stop generation"
                >
                  <span className="material-symbols-outlined text-[18px]">stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSendMessage}
                  disabled={!draft.trim() && attachments.length === 0}
                  className="p-2.5 rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-40 disabled:pointer-events-none transition-colors shrink-0 shadow-sm"
                  title="Send message"
                >
                  <span className="material-symbols-outlined text-[18px]">send</span>
                </button>
              )}
            </div>
            <div className="flex items-center justify-between text-[11px] text-text-muted px-1">
              <span>Model: <code className="font-mono">{params.model}</code></span>
              <span>Ctrl+Enter to send • {params.stream ? "Stream ON" : "Stream OFF"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. PARAMETERS SIDEBAR (Collapsible) */}
      <div
        className={`border-l border-border bg-surface transition-all duration-300 ease-in-out flex flex-col shrink-0 ${
          showParamsSidebar ? "w-80" : "w-0 overflow-hidden border-l-0"
        }`}
      >
        <div className="p-3 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 font-semibold text-sm text-text-main">
            <span className="material-symbols-outlined text-primary text-[20px]">tune</span>
            <span>Configuration</span>
          </div>
          <button
            onClick={() => setShowParamsSidebar(false)}
            className="p-1 rounded text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5"
            title="Collapse settings"
          >
            <span className="material-symbols-outlined text-[18px]">right_panel_close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-5 text-xs">
          {/* Model Card */}
          <div className="p-3 rounded-xl border border-border bg-bg space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-text-main">Active Target</span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setShowModelModal(true)}
              >
                Change
              </Button>
            </div>
            <p className="font-mono text-xs text-primary font-medium break-all">{params.model}</p>
            <div className="pt-1">
              <CapacityBadges caps={activeModelCaps} />
            </div>
          </div>

          {/* Temperature */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-text-main">Temperature</span>
              <span className="font-mono text-text-muted">{params.temperature}</span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={params.temperature}
              onChange={(e) => setParams((p) => ({ ...p, temperature: parseFloat(e.target.value) }))}
              className="w-full accent-primary cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-text-muted">
              <span>0.0 (Precise)</span>
              <span>1.0 (Balanced)</span>
              <span>2.0 (Creative)</span>
            </div>
          </div>

          {/* Max Tokens */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-text-main">Max Output Tokens</span>
              <input
                type="number"
                min="64"
                max="65536"
                step="128"
                value={params.maxTokens}
                onChange={(e) => setParams((p) => ({ ...p, maxTokens: parseInt(e.target.value) || 2048 }))}
                className="w-20 text-right font-mono p-1 rounded border border-border bg-bg text-xs"
              />
            </div>
            <input
              type="range"
              min="128"
              max="16384"
              step="128"
              value={params.maxTokens}
              onChange={(e) => setParams((p) => ({ ...p, maxTokens: parseInt(e.target.value) }))}
              className="w-full accent-primary cursor-pointer"
            />
          </div>

          {/* Top P */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-text-main">Top P</span>
              <span className="font-mono text-text-muted">{params.topP}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={params.topP}
              onChange={(e) => setParams((p) => ({ ...p, topP: parseFloat(e.target.value) }))}
              className="w-full accent-primary cursor-pointer"
            />
          </div>

          {/* Reasoning Effort */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-text-main flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] text-primary">neurology</span>
                Reasoning Effort
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 pt-1">
              {REASONING_EFFORT_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setParams((p) => ({ ...p, reasoningEffort: opt }))}
                  className={`py-1 px-1.5 rounded-lg font-mono text-[11px] uppercase transition-all ${
                    params.reasoningEffort === opt
                      ? "bg-primary text-white font-semibold shadow-sm"
                      : "border border-border text-text-muted hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-main"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Stream Toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div>
              <span className="font-medium text-text-main block">Real-time Stream</span>
              <span className="text-[10px] text-text-muted">Stream tokens via SSE</span>
            </div>
            <Toggle
              checked={params.stream}
              onChange={(v) => setParams((p) => ({ ...p, stream: v }))}
            />
          </div>

          {/* Reset Parameters */}
          <div className="pt-4">
            <button
              onClick={() => setParams(DEFAULT_PARAMS)}
              className="w-full py-1.5 text-center text-xs text-text-muted hover:text-primary transition-colors border border-dashed border-border rounded-lg"
            >
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>

      {/* Model Selection Modal */}
      {showModelModal && (
        <ModelSelectModal
          isOpen={showModelModal}
          onClose={() => setShowModelModal(false)}
          onSelect={(selected) => {
            if (selected?.value) {
              setParams((p) => ({ ...p, model: selected.value }));
            }
            setShowModelModal(false);
          }}
          activeProviders={activeProviders}
          title="Select Playground Target Model or Combo"
          closeOnSelect={true}
        />
      )}

      {/* Code Export Modal */}
      {showCodeModal && (
        <Modal
          isOpen={showCodeModal}
          onClose={() => setShowCodeModal(false)}
          title="API Code Snippet"
          size="lg"
        >
          <div className="space-y-3">
            {/* Lang Tabs */}
            <div className="flex gap-1 border-b border-border pb-2">
              {[
                { id: "curl", label: "cURL" },
                { id: "python", label: "Python" },
                { id: "javascript", label: "JavaScript" },
                { id: "fetch", label: "Fetch" },
              ].map((lang) => (
                <button
                  key={lang.id}
                  onClick={() => setCodeLang(lang.id)}
                  className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${
                    codeLang === lang.id
                      ? "bg-primary text-white"
                      : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-main"
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>

            {/* Code Box */}
            <div className="relative">
              <pre className="p-3.5 rounded-xl bg-surface-2 border border-border text-xs font-mono text-text-main overflow-x-auto custom-scrollbar max-h-96">
                {generatedCode}
              </pre>
              <button
                onClick={() => copy(generatedCode, "modal-code")}
                className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-surface border border-border text-xs text-text-muted hover:text-primary shadow-sm flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {copied === "modal-code" ? "check" : "content_copy"}
                </span>
                <span>{copied === "modal-code" ? "Copied" : "Copy"}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Raw JSON Inspector Modal */}
      {inspectMessage && (
        <Modal
          isOpen={!!inspectMessage}
          onClose={() => setInspectMessage(null)}
          title="Raw Request & Response Inspector"
          size="lg"
        >
          <div className="space-y-4 text-xs">
            <div>
              <span className="font-semibold text-text-main block mb-1">Request Payload sent to /v1/chat/completions</span>
              <pre className="p-3 rounded-lg bg-surface-2 border border-border font-mono overflow-x-auto max-h-60 custom-scrollbar">
                {JSON.stringify(inspectMessage.rawRequest || {}, null, 2)}
              </pre>
            </div>
            <div>
              <span className="font-semibold text-text-main block mb-1">Response Data</span>
              <pre className="p-3 rounded-lg bg-surface-2 border border-border font-mono overflow-x-auto max-h-72 custom-scrollbar">
                {typeof inspectMessage.rawResponse === "object"
                  ? JSON.stringify(inspectMessage.rawResponse, null, 2)
                  : inspectMessage.rawResponse || "No raw response recorded"}
              </pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Collapsible Thinking Block Component
function ThinkingBlock({ thinking, isStreaming }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.03] overflow-hidden transition-all text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-primary/5 transition-colors"
      >
        <div className="flex items-center gap-1.5 font-medium text-primary">
          <span className={`material-symbols-outlined text-[16px] ${isStreaming ? "animate-pulse" : ""}`}>
            neurology
          </span>
          <span>{isStreaming ? "Thinking..." : "Thought process"}</span>
          <span className="text-[10px] text-text-muted font-mono font-normal">
            ({thinking.length} chars)
          </span>
        </div>
        <span className="material-symbols-outlined text-[16px] text-text-muted">
          {expanded ? "expand_less" : "expand_more"}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-primary/10 font-mono text-[11px] text-text-muted whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto custom-scrollbar">
          {thinking}
        </div>
      )}
    </div>
  );
}
