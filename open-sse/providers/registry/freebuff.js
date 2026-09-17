export default {
  id: "freebuff",
  priority: 85,
  alias: "fb",
  aliases: ["fb", "freebuff"],
  uiAlias: "fb",
  display: {
    name: "Freebuff (Codebuff)",
    icon: "terminal",
    color: "#3B82F6",
    textIcon: "FB",
    website: "https://codebuff.com",
    notice: {
      text: "Free ad-supported AI coding agent backend by Codebuff. Supports 1-click auto-import from ~/.config/manicode/credentials.json.",
      signupUrl: "https://codebuff.com",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: "https://www.codebuff.com",
    format: "freebuff",
    headers: {
      "User-Agent": "Freebuff-CLI/0.0.150",
    },
  },
  models: [
    { id: "google/gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
    { id: "google/gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { id: "mimo/mimo-v2.5", name: "Xiaomi MiMo V2.5" },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek/deepseek-v3", name: "DeepSeek V3" },
    { id: "z-ai/glm-5.1", name: "GLM 5.1" },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
    { id: "minimax/minimax-m2.7", name: "MiniMax M2.7" },
    { id: "minimax-m3", name: "MiniMax M3" },
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
  ],
  oauth: {
    importTitle: "Import Freebuff Token",
    storagePathHint: "~/.config/manicode/credentials.json",
  },
};
