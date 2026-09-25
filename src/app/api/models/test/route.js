import { NextResponse } from "next/server";
import { pingModelByKind } from "./ping";
import { getProviderConnections } from "@/lib/localDb";
import { resolveProviderId } from "@/shared/constants/providers.js";

// POST /api/models/test - Ping a model via internal completions or embeddings
export async function POST(request) {
  try {
    const { model, kind, connectionId, allKeys } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });

    if (allKeys) {
      const [rawProvider] = String(model).split("/");
      const resolvedProvider = resolveProviderId(rawProvider) || rawProvider;
      const connections = await getProviderConnections({ provider: resolvedProvider });
      const activeConnections = connections.filter((c) => c.isActive !== false);
      const targets = activeConnections.length > 0 ? activeConnections : connections;

      if (targets.length === 0) {
        return NextResponse.json({ ok: false, error: "No connections found for provider", total: 0, passed: 0, failed: 0, results: [] });
      }

      const results = [];
      let passed = 0;
      let failed = 0;

      for (const conn of targets) {
        try {
          const res = await pingModelByKind(model, kind || "llm", undefined, { connectionId: conn.id });
          if (res.ok) passed += 1;
          else failed += 1;
          results.push({
            connectionId: conn.id,
            name: conn.displayName || conn.name || conn.email || conn.id.slice(0, 8),
            ok: !!res.ok,
            status: res.status,
            error: res.error || null,
            latencyMs: res.latencyMs,
          });
        } catch (err) {
          failed += 1;
          results.push({
            connectionId: conn.id,
            name: conn.displayName || conn.name || conn.email || conn.id.slice(0, 8),
            ok: false,
            error: err.message,
          });
        }
      }

      return NextResponse.json({
        ok: passed > 0,
        total: targets.length,
        passed,
        failed,
        results,
      });
    }

    const result = await pingModelByKind(model, kind || "llm", undefined, { connectionId });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
