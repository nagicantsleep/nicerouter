import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from "../../utils/stream.js";
import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { PROVIDERS } from "../../config/providers.js";
import { STREAM_STALL_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { buildAbortedResponsesTerminalBytes } from "../../utils/responsesStreamHelpers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { saveRequestDetail, trackPendingRequest, appendRequestLog } from "@/lib/usageDb.js";
import { SSE_HEADERS_CORS as SSE_HEADERS } from "../../utils/sseConstants.js";
import { createErrorResult, formatProviderError } from "../../utils/error.js";

// Codex returns Responses API SSE → which client format to translate INTO, by request sourceFormat.
// Gemini-family all map to ANTIGRAVITY decoder; unknown sources fall back to OPENAI.
const CODEX_SOURCE_TO_TARGET = {
  [FORMATS.OPENAI_RESPONSES]: FORMATS.OPENAI_RESPONSES,
  [FORMATS.CLAUDE]: FORMATS.CLAUDE,
  [FORMATS.ANTIGRAVITY]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI_CLI]: FORMATS.ANTIGRAVITY,
};

const PEEK_MAX_BYTES = 8192;

/**
 * Detect stream error in initial SSE chunks (e.g. Anthropic/OneClick/OpenAI error returned with HTTP 200).
 */
export function detectStreamError(text) {
  if (!text || typeof text !== "string") return null;
  const lower = text.toLowerCase();

  // Fast path: must contain at least one error indicator
  const hasErrorWord = lower.includes("error");
  const hasLimitWord = lower.includes("limit") || lower.includes("quota");
  const hasCapacityWord = lower.includes("capacity") || lower.includes("overloaded");
  if (!hasErrorWord && !hasLimitWord && !hasCapacityWord) {
    return null;
  }

  // Structural checks: SSE error event, JSON error field, or response.failed
  const isSseErrorEvent = /event:\s*error/i.test(text);
  const hasErrorJson = /"error"\s*:\s*\{/i.test(text) ||
                       /"type"\s*:\s*"error"/i.test(text) ||
                       /"type"\s*:\s*"response\.failed"/i.test(text) ||
                       /"error"\s*:\s*"[^"]+"/i.test(text);

  const hasExplicitLimitError =
    lower.includes("daily usage limit exceeded") ||
    lower.includes("usage_limit_reached") ||
    lower.includes("rate_limit_error") ||
    lower.includes("insufficient_quota") ||
    lower.includes("selected model is at capacity") ||
    lower.includes("exceeded your current quota") ||
    lower.includes("billing_hard_limit_reached");

  // If none of the structural or explicit error patterns match, it's not a stream error
  if (!isSseErrorEvent && !hasErrorJson && !hasExplicitLimitError) {
    return null;
  }

  // Parse lines to extract structured message and details
  let message = "";
  let errorType = "";
  let errorCode = null;
  let resetsAtMs = null;

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const dataStr = trimmed.slice(5).trim();
    if (!dataStr || dataStr === "[DONE]") continue;
    try {
      const parsed = JSON.parse(dataStr);
      if (parsed.error) {
        if (typeof parsed.error === "string") {
          message = parsed.error;
        } else if (typeof parsed.error === "object") {
          message = parsed.error.message || parsed.error.msg || message;
          errorType = parsed.error.type || errorType;
          errorCode = parsed.error.code || errorCode;
          if (parsed.error.resets_at || parsed.error.reset_at) {
            resetsAtMs = (parsed.error.resets_at || parsed.error.reset_at) * 1000;
          }
        }
      }
      if (parsed.type === "error" && parsed.error) {
        message = parsed.error.message || message;
        errorType = parsed.error.type || errorType;
      }
      if (parsed.response?.error) {
        message = parsed.response.error.message || message;
        errorType = parsed.response.error.type || errorType;
      }
      if (!message && (parsed.message || parsed.msg)) {
        message = parsed.message || parsed.msg;
      }
    } catch {
      // Non-JSON data payload
      if (isSseErrorEvent && !message) {
        message = dataStr;
      }
    }
  }

  // Fallback message extraction
  if (!message) {
    const match = text.match(/"message"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    if (match) {
      message = match[1].replace(/\\"/g, '"');
    } else if (hasExplicitLimitError) {
      const matchedLine = lines.find(l => /limit|capacity|quota|exceeded/i.test(l));
      message = matchedLine ? matchedLine.replace(/^data:\s*/, "").trim() : text.slice(0, 160).trim();
    } else if (isSseErrorEvent) {
      message = text.slice(0, 160).trim();
    }
  }

  // Determine appropriate HTTP status code
  let status = 429;
  const msgLower = `${message} ${errorType} ${errorCode || ""}`.toLowerCase();
  if (
    msgLower.includes("capacity") ||
    msgLower.includes("overloaded") ||
    msgLower.includes("unavailable") ||
    msgLower.includes("service_unavailable")
  ) {
    status = 503;
  } else if (
    msgLower.includes("rate_limit") ||
    msgLower.includes("rate limit") ||
    msgLower.includes("usage limit") ||
    msgLower.includes("quota") ||
    msgLower.includes("too many requests") ||
    msgLower.includes("daily usage limit exceeded") ||
    msgLower.includes("usage_limit_reached") ||
    msgLower.includes("exceeded your current quota") ||
    msgLower.includes("billing_hard_limit_reached")
  ) {
    status = 429;
  } else if (
    msgLower.includes("unauthorized") ||
    msgLower.includes("invalid_api_key") ||
    msgLower.includes("authentication")
  ) {
    status = 401;
  } else if (
    msgLower.includes("server_error") ||
    msgLower.includes("internal")
  ) {
    status = 502;
  } else {
    status = 429;
  }

  return { status, message: message || "Upstream stream error", errorType, errorCode, resetsAtMs };
}

/**
 * Peek initial SSE bytes to detect disguised stream errors before piping to client.
 */
async function peekInitialStream(providerResponse) {
  if (!providerResponse || !providerResponse.body) {
    return { isError: false, replacementBody: null };
  }

  const reader = providerResponse.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let text = "";
  let detected = null;
  let isUpstreamDone = false;

  try {
    while (text.length < PEEK_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        isUpstreamDone = true;
        break;
      }
      chunks.push(value);
      text += decoder.decode(value, { stream: true });

      detected = detectStreamError(text);
      if (detected) {
        break;
      }

      // Fast break on valid stream tokens to avoid buffering latency
      const lower = text.toLowerCase();
      if (
        lower.includes("event: message_start") ||
        lower.includes("event: content_block_start") ||
        lower.includes("event: content_block_delta") ||
        lower.includes('"delta"') ||
        lower.includes('"choices"') ||
        lower.includes('"response.output_item.added"') ||
        lower.includes('"response.created"') ||
        lower.includes("data: [done]")
      ) {
        break;
      }

      if (text.includes("\n\n") && !lower.includes("error") && !lower.includes("limit") && !lower.includes("capacity")) {
        break;
      }
    }
  } catch (err) {
    try { await reader.cancel(); } catch { /* noop */ }
    try { reader.releaseLock(); } catch { /* noop */ }
    return {
      isError: true,
      errorInfo: {
        status: 502,
        message: err.message || "Failed to read upstream stream"
      }
    };
  }

  if (detected) {
    try { await reader.cancel(); } catch { /* noop */ }
    try { reader.releaseLock(); } catch { /* noop */ }
    return {
      isError: true,
      errorInfo: detected
    };
  }

  reader.releaseLock();

  const upstream = providerResponse.body;
  let upstreamReader = null;
  const replacementBody = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      if (isUpstreamDone) {
        controller.close();
      } else {
        upstreamReader = upstream.getReader();
      }
    },
    async pull(controller) {
      if (isUpstreamDone || !upstreamReader) {
        controller.close();
        return;
      }
      try {
        const { done, value } = await upstreamReader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (e) {
        controller.error(e);
      }
    },
    cancel(reason) {
      try { upstreamReader?.cancel(reason); } catch { /* noop */ }
    }
  });

  return {
    isError: false,
    replacementBody
  };
}

/**
 * Determine which SSE transform stream to use based on provider/format.
 */
function buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete, apiKey, credentials }) {
  const isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");
  // Responses-API providers (e.g. codex) emit Responses SSE → translate into client format
  const isResponsesProvider = PROVIDERS[provider]?.format === FORMATS.OPENAI_RESPONSES;
  const needsCodexTranslation = isResponsesProvider && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;

  if (needsCodexTranslation) {
    const codexTarget = CODEX_SOURCE_TO_TARGET[sourceFormat] || FORMATS.OPENAI;
    return createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, codexTarget, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames, credentials);
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames, credentials);
  }

  return createPassthroughStreamWithLogger(provider, reqLogger, model, connectionId, body, onStreamComplete, apiKey);
}

/**
 * Handle streaming response — pipe provider SSE through transform stream to client.
 */
export async function handleStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, userAgent, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, customToolNames, streamController, onStreamComplete, streamDetailId, pxpipe, reqTag, log, credentials }) {
  // When upstream returns HTML/text instead of SSE (e.g. Cloudflare 5xx error
  // page), piping it through the SSE transform stream causes Next.js
  // "failed to pipe response" and crashes the chat router. Read the body,
  // pull a short human-readable message from the <title>, sanitize it, and
  // return a clean JSON error instead. The message is stripped of HTML tags
  // and clamped so untrusted upstream text never reaches the client verbatim
  // (the UI may render error.message as HTML).
  const upstreamContentType = (providerResponse.headers.get('content-type') || '').toLowerCase();
  if (upstreamContentType && !upstreamContentType.includes('text/event-stream') && !upstreamContentType.includes('application/json')) {
    const bodyText = await providerResponse.text().catch(() => '');
    const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/i);
    const sanitizedTitle = (titleMatch?.[1] || '').replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
    const shortMsg = sanitizedTitle
      || (bodyText.length < 200 ? bodyText.replace(/<[^>]*>/g, '').trim().slice(0, 160) : `Upstream returned non-SSE response (${upstreamContentType})`);
    const status = providerResponse.status || 502;
    if (log?.errorLine) log.errorLine(reqTag, "✗", `BLOCKED ${status} · ${provider}/${model} · non-SSE (${upstreamContentType})\n    ${shortMsg}`);
    else console.warn(`[STREAM] ${provider} | ${model} | blocked pipe: ${shortMsg} [${status}]`);
    streamController?.handleError?.(new Error(`upstream non-SSE: ${status}`));
    return {
      success: false,
      response: new Response(JSON.stringify({ error: { message: `[${status}]: ${shortMsg}` } }), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }),
    };
  }

  // Peek initial SSE bytes to catch in-stream errors (e.g. 200 OK with rate_limit_error or capacity errors)
  const peek = await peekInitialStream(providerResponse);
  if (peek.isError) {
    const { status, message, resetsAtMs } = peek.errorInfo;
    const errMsg = formatProviderError(new Error(message), provider, model, status);
    trackPendingRequest(model, provider, connectionId, false, true);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${status}` }).catch(() => {});
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      response: { error: message, status, thinking: null },
      pxpipe,
      status: "error"
    }, { id: streamDetailId })).catch(() => {});

    if (log?.errorLine) {
      log.errorLine(reqTag, "✗", `STREAM ERROR ${status} · ${provider}/${model} · ${Date.now() - requestStartTime}ms\n    ${errMsg}`);
    } else {
      console.warn(`[STREAM ERROR] ${provider}/${model} [${status}]: ${errMsg}`);
    }
    streamController?.handleError?.(new Error(errMsg));
    return createErrorResult(status, errMsg, resetsAtMs);
  }

  if (onRequestSuccess) {
    Promise.resolve()
      .then(onRequestSuccess)
      .catch(err => {
        console.error("[ChatCore] onRequestSuccess failed:", err?.message || err);
      });
  }

  const responseToPipe = peek.replacementBody
    ? new Response(peek.replacementBody, {
        headers: providerResponse.headers,
        status: providerResponse.status,
        statusText: providerResponse.statusText
      })
    : providerResponse;

  const transformStream = buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete, apiKey, credentials });

  // Responses passthrough: synthesize response.failed + [DONE] if the stream aborts/stalls before a terminal event
  const isResponsesPassthrough = sourceFormat === FORMATS.OPENAI_RESPONSES && targetFormat === FORMATS.OPENAI_RESPONSES;
  const onAbortTerminal = isResponsesPassthrough ? buildAbortedResponsesTerminalBytes : null;
  const stallTimeoutMs = PROVIDERS[provider]?.stallTimeoutMs || STREAM_STALL_TIMEOUT_MS;
  const transformedBody = pipeWithDisconnect(responseToPipe, transformStream, streamController, onAbortTerminal, stallTimeoutMs);

  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: 0, total: Date.now() - requestStartTime },
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: "[Streaming - raw response not captured]",
    response: { content: "[Streaming in progress...]", thinking: null, type: "streaming" },
    pxpipe,
    status: "success"
  }, { id: streamDetailId })).catch(err => {
    console.error("[RequestDetail] Failed to save streaming request:", err.message);
  });

  return {
    success: true,
    response: new Response(transformedBody, { headers: SSE_HEADERS })
  };
}

/**
 * Build onStreamComplete callback for streaming usage tracking.
 */
export function buildOnStreamComplete({ provider, model, connectionId, apiKey, requestStartTime, body, stream, finalBody, translatedBody, clientRawRequest, pxpipe, reqTag, log }) {
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const onStreamComplete = (contentObj, usage, ttftAt) => {
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime
    };
    const safeContent = contentObj?.content || "[Empty streaming response]";
    const safeThinking = contentObj?.thinking || null;

    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency,
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: safeContent,
      response: { content: safeContent, thinking: safeThinking, type: "streaming" },
      pxpipe,
      status: "success"
    }, { id: streamDetailId })).catch(err => {
      console.error("[RequestDetail] Failed to update streaming content:", err.message);
    });

    // Persist stream usage to DB (no console line; the "📊 done" line below is authoritative)
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, label: "STREAM USAGE", silent: true });
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency }));
  };

  return { onStreamComplete, streamDetailId };
}
