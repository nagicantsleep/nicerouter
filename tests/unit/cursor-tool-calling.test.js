import { describe, expect, it } from "vitest";
import {
  CursorExecutor,
  isAgentCapableRequest,
  formatToolsForPrompt,
  normalizeMessagesForAgent,
  parseToolCallsFromText,
  buildAgentRunFrame,
} from "../../open-sse/executors/cursor.js";
import { encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;

function textFrame(text) {
  const textPart = Buffer.from(encodeField(1, LEN, text));
  const update = Buffer.from(encodeField(1, LEN, textPart));
  return Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN, update)));
}

function doneFrame() {
  const update = Buffer.from(encodeField(14, LEN, new Uint8Array()));
  return Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN, update)));
}

function stubAgentSession(executor, frames) {
  const written = [];
  const queue = [...frames];
  executor.openAgentHttp2Stream = () => ({
    responseHeaders: Promise.resolve({ ":status": 200 }),
    write: (frame) => written.push(Buffer.from(frame)),
    end() {},
    close() {},
    async read() {
      if (!queue.length) return { value: undefined, done: true };
      return { value: queue.shift(), done: false };
    },
  });
  return written;
}

const credentials = {
  accessToken: "test-token",
  providerSpecificData: { machineId: "a".repeat(64) },
};

function parseSSE(text) {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

describe("Cursor Tool Calling & Agent Helpers", () => {
  describe("isAgentCapableRequest", () => {
    it("accepts plain text messages", () => {
      expect(isAgentCapableRequest({ messages: [{ role: "user", content: "hello" }] })).toBe(true);
    });

    it("accepts requests with tools declared", () => {
      expect(isAgentCapableRequest({
        messages: [{ role: "user", content: "what is the weather?" }],
        tools: [{ function: { name: "get_weather" } }],
      })).toBe(true);
    });

    it("accepts multi-turn history with tool_calls and tool results", () => {
      expect(isAgentCapableRequest({
        messages: [
          { role: "user", content: "weather in Tokyo?" },
          { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_weather", arguments: "{}" } }] },
          { role: "tool", tool_call_id: "c1", content: "18C sunny" },
          { role: "user", content: "thanks" },
        ],
      })).toBe(true);
    });

    it("rejects non-text content (e.g. image_url)", () => {
      expect(isAgentCapableRequest({
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "http://example.com/img.png" } }] }],
      })).toBe(false);
    });
  });

  describe("formatToolsForPrompt", () => {
    it("formats OpenAI tool schemas into instructions", () => {
      const tools = [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get current weather for a city",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        },
      ];
      const prompt = formatToolsForPrompt(tools);
      expect(prompt).toContain("# Available Tools");
      expect(prompt).toContain("get_weather");
      expect(prompt).toContain('"tool_calls"');
    });

    it("returns empty string when no tools provided", () => {
      expect(formatToolsForPrompt([])).toBe("");
      expect(formatToolsForPrompt(null)).toBe("");
    });
  });

  describe("normalizeMessagesForAgent", () => {
    it("converts role: 'tool' into user message with tool_result tag", () => {
      const messages = [
        { role: "tool", tool_call_id: "call_123", content: "Sunny 25C" },
      ];
      const normalized = normalizeMessagesForAgent(messages);
      expect(normalized[0].role).toBe("user");
      expect(normalized[0].content).toContain('<tool_result tool_call_id="call_123">');
      expect(normalized[0].content).toContain("Sunny 25C");
    });

    it("converts assistant tool_calls into JSON text block", () => {
      const messages = [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "c1", type: "function", function: { name: "bash", arguments: '{"cmd":"ls"}' } },
          ],
        },
      ];
      const normalized = normalizeMessagesForAgent(messages);
      expect(normalized[0].role).toBe("assistant");
      expect(normalized[0].content).toContain("tool_calls");
      expect(normalized[0].content).toContain('"name": "bash"');
    });
  });

  describe("parseToolCallsFromText", () => {
    it("parses markdown code block with tool_calls", () => {
      const text = '```json\n{\n  "tool_calls": [\n    {\n      "name": "bash",\n      "arguments": {"cmd": "ls -la"}\n    }\n  ]\n}\n```';
      const calls = parseToolCallsFromText(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].function.name).toBe("bash");
      expect(calls[0].function.arguments).toContain("ls -la");
      expect(calls[0].id).toMatch(/^call_/);
    });

    it("parses raw JSON with tool_calls", () => {
      const text = '{"tool_calls": [{"name": "read_file", "arguments": {"path": "index.js"}}]}';
      const calls = parseToolCallsFromText(text);
      expect(calls).toHaveLength(1);
      expect(calls[0].function.name).toBe("read_file");
      expect(calls[0].function.arguments).toContain("index.js");
    });

    it("returns null for normal text", () => {
      expect(parseToolCallsFromText("Hello! How can I help you today?")).toBeNull();
      expect(parseToolCallsFromText("```python\nprint('hello')\n```")).toBeNull();
    });
  });

  describe("executeAgent with prompt-based tool calling", () => {
    it("emits tool_calls in streaming mode when model responds with tool call JSON", async () => {
      const executor = new CursorExecutor();
      const toolCallJson = '```json\n{\n  "tool_calls": [\n    {\n      "name": "get_weather",\n      "arguments": {"city": "Tokyo"}\n    }\n  ]\n}\n```';
      stubAgentSession(executor, [textFrame(toolCallJson), doneFrame()]);

      const result = await executor.executeAgent({
        model: "composer-2.5",
        body: {
          messages: [{ role: "user", content: "What is the weather in Tokyo?" }],
          tools: [{ type: "function", function: { name: "get_weather" } }],
        },
        stream: true,
        credentials,
      });

      const bodyText = await result.response.text();
      const events = parseSSE(bodyText);

      const toolCallEvent = events.find((e) => e.choices?.[0]?.delta?.tool_calls);
      expect(toolCallEvent).toBeDefined();
      const tc = toolCallEvent.choices[0].delta.tool_calls[0];
      expect(tc.function.name).toBe("get_weather");
      expect(tc.function.arguments).toContain("Tokyo");

      const finishEvent = events.find((e) => e.choices?.[0]?.finish_reason === "tool_calls");
      expect(finishEvent).toBeDefined();
    });

    it("returns message.tool_calls in non-streaming mode", async () => {
      const executor = new CursorExecutor();
      const toolCallJson = '{"tool_calls": [{"name": "calculator", "arguments": {"expr": "2+2"}}]}';
      stubAgentSession(executor, [textFrame(toolCallJson), doneFrame()]);

      const result = await executor.executeAgent({
        model: "grok-4.5",
        body: {
          messages: [{ role: "user", content: "Calculate 2+2" }],
          tools: [{ type: "function", function: { name: "calculator" } }],
        },
        stream: false,
        credentials,
      });

      expect(result.response.status).toBe(200);
      const json = await result.response.json();
      expect(json.choices[0].finish_reason).toBe("tool_calls");
      expect(json.choices[0].message.tool_calls).toHaveLength(1);
      expect(json.choices[0].message.tool_calls[0].function.name).toBe("calculator");
      expect(json.choices[0].message.content).toBeNull();
    });

    it("streams normal text directly when model does not call tools", async () => {
      const executor = new CursorExecutor();
      stubAgentSession(executor, [textFrame("Sure, I will tell you about Tokyo."), doneFrame()]);

      const result = await executor.executeAgent({
        model: "composer-2.5",
        body: {
          messages: [{ role: "user", content: "Tell me about Tokyo" }],
          tools: [{ type: "function", function: { name: "get_weather" } }],
        },
        stream: true,
        credentials,
      });

      const bodyText = await result.response.text();
      const events = parseSSE(bodyText);

      const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
      expect(content).toContain("Sure, I will tell you about Tokyo.");

      const finishEvent = events.find((e) => e.choices?.[0]?.finish_reason === "stop");
      expect(finishEvent).toBeDefined();
    });
  });
});
