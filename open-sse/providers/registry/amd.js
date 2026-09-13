export default {
  id: "amd",
  priority: 260,
  alias: "amd",
  display: {
    name: "AMD Radeon AI",
    icon: "developer_board",
    color: "#ED1C24",
    textIcon: "AMD",
    website: "https://developer.amd.com.cn",
    notice: {
      apiKeyUrl: "https://developer.amd.com.cn",
    },
  },
  category: "apikey",
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
    baseUrl: "https://developer.amd.com.cn/radeon/api/v1/chat/completions",
    validateUrl: "https://developer.amd.com.cn/radeon/api/v1/models",
    headers: {
      "User-Agent": "Cline/3.0.0",
    },
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://developer.amd.com.cn/radeon/api/v1/chat/completions",
      headers: { "User-Agent": "Cline/3.0.0" },
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://developer.amd.com.cn/radeon/api/v1/messages",
      headers: { "User-Agent": "Cline/3.0.0" },
      auth: { combined: true, header: "Authorization", scheme: "bearer", anthropicVersion: true },
    },
  ],
  models: [
    { id: "DeepSeek-V4-Flash", name: "DeepSeek V4 Flash" },
    { id: "DeepSeek-V4-Flash-Vision-Exp", name: "DeepSeek V4 Flash Vision Exp" },
    { id: "MinerU2.5-Pro", name: "MinerU 2.5 Pro" },
    { id: "MiniCPM5-2B", name: "MiniCPM5 2B" },
    { id: "Qwen3.8-Flash-Next", name: "Qwen 3.8 Flash Next" },
  ],
};
