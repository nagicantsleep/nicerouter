import { describe, it, expect } from "vitest";
import { hasValuableContent } from "open-sse/utils/streamHelpers.js";
import { FORMATS } from "open-sse/translator/formats.js";
import { parseSSEToOpenAIResponse } from "open-sse/handlers/chatCore/sseToJsonHandler.js";

describe("SeekAI and non-standard reasoning normalization", () => {
  it("recognizes delta.reasoning in hasValuableContent", () => {
    const chunkWithReasoning = {
      choices: [{ delta: { reasoning: "Let me consider..." } }],
    };
    expect(hasValuableContent(chunkWithReasoning, FORMATS.OPENAI)).toBe(true);

    const chunkEmpty = {
      choices: [{ delta: {} }],
    };
    expect(hasValuableContent(chunkEmpty, FORMATS.OPENAI)).toBeFalsy();
  });

  it("aggregates delta.reasoning chunks in parseSSEToOpenAIResponse", () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}',
      'data: {"choices":[{"delta":{"reasoning":"Thinking chunk 1. "}}]}',
      'data: {"choices":[{"delta":{"reasoning":"Thinking chunk 2."}}]}',
      'data: {"choices":[{"delta":{"content":"Hello!"}}]}',
      'data: {"choices":[{"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join("\n\n");

    const parsed = parseSSEToOpenAIResponse(sseLines);
    expect(parsed.choices[0].message.content).toBe("Hello!");
    expect(parsed.choices[0].message.reasoning_content).toBe("Thinking chunk 1. Thinking chunk 2.");
  });
});
