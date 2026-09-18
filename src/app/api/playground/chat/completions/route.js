import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { getSettings, getApiKeys } from "@/lib/localDb";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function POST(request) {
  await ensureInitialized();

  let outgoingRequest = request;
  try {
    const settings = await getSettings();
    if (settings?.requireApiKey && !request.headers.get("Authorization")) {
      const keys = await getApiKeys();
      const activeKey = keys.find((k) => k.isActive !== false)?.key;
      if (activeKey) {
        const headers = new Headers(request.headers);
        headers.set("Authorization", `Bearer ${activeKey}`);
        outgoingRequest = new Request(request.url, {
          method: request.method,
          headers,
          body: request.body,
          duplex: "half",
        });
      }
    }
  } catch (err) {
    console.warn("[PlaygroundAPI] Failed to inject internal credentials:", err?.message);
  }

  return await handleChat(outgoingRequest);
}
