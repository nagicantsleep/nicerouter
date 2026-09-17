import { describe, it, expect, vi } from "vitest";
import { normalizeCursorModel, CursorExecutor } from "../../open-sse/executors/cursor.js";
import cursorRegistry from "../../open-sse/providers/registry/cursor.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("Cursor Composer and Grok models", () => {
  it("normalizes model names appropriately", () => {
    expect(normalizeCursorModel("composer")).toBe("composer-2.5");
    expect(normalizeCursorModel("cursor-composer")).toBe("composer-2.5");
    expect(normalizeCursorModel("composer-2.5")).toBe("composer-2.5");
    expect(normalizeCursorModel("composer-2.5-fast")).toBe("composer-2.5-fast");

    expect(normalizeCursorModel("grok")).toBe("grok-4.5");
    expect(normalizeCursorModel("cursor-grok")).toBe("grok-4.5");
    expect(normalizeCursorModel("cursor-grok-4.5")).toBe("grok-4.5");
    expect(normalizeCursorModel("cursor-grok-4.6")).toBe("grok-4.6");
    expect(normalizeCursorModel("grok-4.5")).toBe("grok-4.5");
    expect(normalizeCursorModel("grok-4.6")).toBe("grok-4.6");
    expect(normalizeCursorModel("cursor-grok-4.6-high")).toBe("cursor-grok-4.6-high");
  });

  it("exposes composer and grok models in cursor registry", () => {
    const ids = cursorRegistry.models.map((m) => m.id);
    expect(ids).toContain("composer-2.5");
    expect(ids).toContain("composer-2.5-fast");
    expect(ids).toContain("composer");
    expect(ids).toContain("grok-4.5");
    expect(ids).toContain("grok-4.6");
    expect(ids).toContain("grok");
    expect(ids).toContain("cursor-grok-4.5");
    expect(ids).toContain("cursor-grok-4.6-high");
  });

  it("provides capabilities for composer and grok models", () => {
    const composerCaps = getCapabilitiesForModel("cursor", "composer-2.5");
    expect(composerCaps.vision).toBe(true);
    expect(composerCaps.reasoning).toBe(true);
    expect(composerCaps.contextWindow).toBeGreaterThan(100000);

    const grokCaps = getCapabilitiesForModel("cursor", "grok-4.5");
    expect(grokCaps.vision).toBe(true);
    expect(grokCaps.reasoning).toBe(true);
  });
});
