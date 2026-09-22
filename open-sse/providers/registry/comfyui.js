export default {
  id: "comfyui",
  priority: 120,
  alias: "comfyui",
  display: {
    name: "ComfyUI",
    icon: "account_tree",
    color: "#4CAF50",
    textIcon: "CF",
    website: "https://github.com/comfyanonymous/ComfyUI",
  },
  category: "apikey",
  transport: null,
  models: [
    { id: "qwen-image-2.1", name: "Qwen Image 2.1 (RGBA)", params: ["n","size"], kind: "image" },
    { id: "wan-2.1", name: "Wan 2.1 Video", params: ["n","size"], kind: "image" },
    { id: "flux-dev", name: "FLUX Dev", params: ["n","size"], kind: "image" },
    { id: "sdxl", name: "SDXL", params: ["n","size"], kind: "image" },
  ],
  serviceKinds: ["image"],
  imageConfig: { baseUrl: "http://100.84.84.5:8188" },
};
