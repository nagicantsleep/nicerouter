export default {
  id: "agents-vn",
  priority: 273,
  hasFree: true,
  alias: "avn",
  aliases: [
    "avn",
    "agents-vn",
    "agents-ai-vn",
    "gateway-agents-ai-vn",
    "agents.ai.vn",
  ],
  uiAlias: "avn",
  display: {
    name: "Agents AI VN",
    icon: "smart_toy",
    color: "#2563EB",
    textIcon: "AVN",
    website: "https://gateway.agents.ai.vn",
    notice: {
      text: "Free community AI gateway hosting Muse Spark models. Public free key: sk-D8Kyao8gBBweVR7pKqafi1bxuH5DaPfFc7GzTPmHvdcqaZP0",
      apiKeyUrl: "https://gateway.agents.ai.vn",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  features: {
    usage: true,
    usageApikey: true,
  },
  thinkingConfig: {
    options: [
      "auto",
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://gateway.agents.ai.vn/v1/chat/completions",
    validateUrl: "https://gateway.agents.ai.vn/v1/models",
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://gateway.agents.ai.vn/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [
    { id: "muse-spark-1.3", name: "Muse Spark 1.3", isFree: true },
    { id: "muse-spark-1.2", name: "Muse Spark 1.2", isFree: true },
  ],
  modelsFetcher: { url: "https://gateway.agents.ai.vn/v1/models", type: "openai" },
  passthroughModels: true,
};
