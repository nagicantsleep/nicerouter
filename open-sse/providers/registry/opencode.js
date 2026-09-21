export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  aliases: ["opencode-free"],
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
    website: "https://opencode.ai",
    notice: {
      text: "Free tier powered by OpenCode public pool (Bearer public). Route through a proxy pool to avoid IP-based rate limits.",
    },
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    // Upstream free-tier gate rejects stream:false with 403 FreeTierError
    // (verified live). Force SSE upstream; chatCore converts back to JSON
    // for non-streaming clients via the existing forced-SSE path.
    forceStream: true,
    headers: {
      "x-opencode-client": "desktop",
    },
    noAuth: true,
    quirks: {
      forceAutoToolChoiceModels: ["muse-spark-1.3-contributor-free"],
    },
  },
  models: [
    // Endpoint formats differ per model, so declare non-chat models explicitly.
    { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Contributor Free", targetFormat: "openai-responses" },
    { id: "muse-spark-1.3-contributor-free", name: "Muse Spark 1.3 Contributor Free", targetFormat: "openai-responses" },
    { id: "union-alpha", name: "Union Alpha Free", targetFormat: "claude" },
    { id: "mimo-v2.5-free", name: "MiMo V2.5 Free", targetFormat: "openai" },
    { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash Free", targetFormat: "openai" },
    { id: "ling-3.0-flash-fin-free", name: "Ling 3.0 Flash Fin Free", targetFormat: "openai" },
    { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free", targetFormat: "openai" },
    { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free", targetFormat: "openai" },
  ],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
