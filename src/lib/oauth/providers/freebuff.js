import { FREEBUFF_CONFIG } from "../constants/oauth.js";

const freebuff = {
  config: FREEBUFF_CONFIG,
  flowType: "import_token",
  mapTokens: (tokens) => ({
    accessToken: tokens.accessToken,
    refreshToken: null,
    expiresIn: tokens.expiresIn || 86400 * 30,
    providerSpecificData: {
      fingerprintId: tokens.fingerprintId || null,
      fingerprintHash: tokens.fingerprintHash || null,
      authMethod: "imported",
    },
  }),
};

export default freebuff;
