export default {
  id: "typesafe",
  priority: 110,
  alias: "typesafe",
  aliases: [
    "typesafe-ai",
    "typesage",
    "typesage-ai",
    "ts",
  ],
  uiAlias: "typesafe",
  display: {
    name: "TypeSafe AI",
    icon: "verified_user",
    color: "#4F46E5",
    textIcon: "TS",
    website: "https://typesafe.ai",
    notice: {
      text: "TypeSafe AI System One decision model (Jev). Fast, calibrated decisions (choice, score, noul).",
      apiKeyUrl: "https://console.typesafe.ai/settings/keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.typesafe.ai/v1/systemone",
    validateUrl: "https://api.typesafe.ai/v1/systemone",
  },
  models: [
    { id: "jev-latest", name: "Jev Latest (System One)" },
    { id: "jev-1.13.0", name: "Jev 1.13.0" },
    { id: "jev-1.12.0", name: "Jev 1.12.0" },
  ],
  passthroughModels: true,
};
