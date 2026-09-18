import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { SSE_DONE } from "../utils/sseConstants.js";

/**
 * Convert chat completion messages to a text state string for TypeSafe System One
 */
function messagesToState(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "";
  }
  return messages
    .map((msg) => {
      const role = (msg.role || "user").toUpperCase();
      let text = "";
      if (typeof msg.content === "string") {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = msg.content
          .map((part) => (typeof part === "string" ? part : part?.text || ""))
          .filter(Boolean)
          .join("\n");
      }
      return `${role}: ${text}`;
    })
    .join("\n\n");
}

/**
 * Derive TypeSafe System One questions from chat request parameters (tools, response_format, etc.)
 */
function deriveQuestions(body) {
  if (body.questions && typeof body.questions === "object") {
    return body.questions;
  }

  // If tools are provided, convert tool definitions to a choice question
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const criteria = {};
    for (const t of body.tools) {
      const name = t.function?.name || t.name;
      const desc = t.function?.description || t.description || name;
      if (name) criteria[name] = desc;
    }
    if (Object.keys(criteria).length > 0) {
      criteria["none"] = "No tool call required";
      return {
        tool_selection: {
          type: "choice",
          instructions: "Select the most appropriate tool to address this query",
          criteria,
        },
      };
    }
  }

  // Default structured decision & score questions for System One
  return {
    decision: {
      type: "choice",
      instructions: "Evaluate the input state and categorize the request",
      criteria: {
        actionable: "Request has clear, specific instructions and is actionable",
        informational: "Request is an informational query or knowledge inquiry",
        ambiguous: "Request is vague, ambiguous, or lacks required context",
      },
    },
    confidence: {
      type: "score",
      instructions: "Rate confidence in understanding and evaluating the input state",
    },
  };
}

/**
 * Format TypeSafe System One answers into a readable assistant message content
 */
function formatAnswersContent(data) {
  if (!data) return "{}";
  if (data.answers && typeof data.answers === "object") {
    return JSON.stringify(data.answers, null, 2);
  }
  return JSON.stringify(data, null, 2);
}

/**
 * TypeSafeExecutor — handles TypeSafe AI System One decision model (Jev).
 *
 * Primary upstream: POST https://api.typesafe.ai/v1/systemone
 * Converts chat completions messages to state/questions, and transforms
 * structured decisions back into OpenAI-compatible chat completions format.
 */
export class TypeSafeExecutor extends BaseExecutor {
  constructor(provider = "typesafe", config = null) {
    super(provider, config || PROVIDERS.typesafe || {
      baseUrl: "https://api.typesafe.ai/v1/systemone",
    });
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const customBase = credentials?.providerSpecificData?.baseUrl;
    if (customBase) {
      const normalized = customBase.replace(/\/$/, "");
      return normalized.endsWith("/systemone") ? normalized : `${normalized}/systemone`;
    }
    return this.config?.baseUrl || "https://api.typesafe.ai/v1/systemone";
  }

  buildHeaders(credentials, stream = false) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(this.config?.headers || {}),
    };
    const token = credentials?.apiKey || credentials?.accessToken;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    // If request already has state and questions, pass through directly
    if (body.state !== undefined && body.questions !== undefined) {
      return {
        model: model || body.model || "jev-latest",
        state: body.state,
        questions: body.questions,
      };
    }

    // Convert OpenAI messages to System One state and questions
    const state = messagesToState(body.messages) || body.prompt || "";
    const questions = deriveQuestions(body);

    return {
      model: model || body.model || "jev-latest",
      state,
      questions,
    };
  }

  async execute(opts) {
    const { model, body, stream, credentials, signal, log, proxyOptions } = opts;
    const url = this.buildUrl(model, stream, 0, credentials);
    const transformedBody = this.transformRequest(model, body, stream, credentials);
    const headers = this.buildHeaders(credentials, stream);

    let upstreamResponse;
    try {
      upstreamResponse = await proxyAwareFetch(
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify(transformedBody),
          signal,
        },
        proxyOptions
      );
    } catch (err) {
      throw err;
    }

    // If upstream returned error, return as-is for standard error handling
    if (!upstreamResponse.ok) {
      return {
        response: upstreamResponse,
        url,
        headers,
        transformedBody,
        responseFormat: "openai",
      };
    }

    let rawData;
    try {
      rawData = await upstreamResponse.json();
    } catch (e) {
      throw new Error(`Failed to parse JSON response from TypeSafe: ${e.message}`);
    }

    const contentText = formatAnswersContent(rawData);
    const modelVersion = rawData?.metadata?.version || model || "jev-latest";
    const promptTokens = rawData?.metadata?.input_tokens || Math.max(1, Math.round((JSON.stringify(transformedBody).length) / 4));
    const completionTokens = rawData?.metadata?.output_tokens || Math.max(1, Math.round(contentText.length / 4));
    const totalTokens = promptTokens + completionTokens;

    if (stream) {
      // Build an SSE stream emitting OpenAI chat.completion.chunk items
      const encoder = new TextEncoder();
      const chunkId = `chatcmpl-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);

      const streamBody = new ReadableStream({
        start(controller) {
          // 1. Initial chunk with role
          const initialChunk = {
            id: chunkId,
            object: "chat.completion.chunk",
            created,
            model: modelVersion,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: contentText },
                finish_reason: null,
              },
            ],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialChunk)}\n\n`));

          // 2. Final chunk with finish_reason and usage
          const finalChunk = {
            id: chunkId,
            object: "chat.completion.chunk",
            created,
            model: modelVersion,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: totalTokens,
            },
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));

          // 3. Terminal DONE
          controller.enqueue(encoder.encode(SSE_DONE));
          controller.close();
        },
      });

      const syntheticResponse = new Response(streamBody, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });

      return {
        response: syntheticResponse,
        url,
        headers,
        transformedBody,
        responseFormat: "openai",
      };
    }

    // Non-streaming response: OpenAI chat.completion JSON object
    const completionPayload = {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelVersion,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: contentText,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    };

    const syntheticResponse = new Response(JSON.stringify(completionPayload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });

    return {
      response: syntheticResponse,
      url,
      headers,
      transformedBody,
      responseFormat: "openai",
    };
  }
}

export default TypeSafeExecutor;
