import { FREEBUFF_CONFIG } from "../constants/oauth.js";

const DEFAULT_UPSTREAM_BASE = "https://www.codebuff.com";
const DEFAULT_USER_AGENT = "Freebuff-CLI/0.0.150";

/**
 * Freebuff Service
 * Validates Freebuff auth token against Codebuff backend and extracts user info.
 */
export class FreebuffService {
  constructor() {
    this.config = FREEBUFF_CONFIG;
  }

  /**
   * Validate token by pinging Freebuff session creation
   */
  async validateImportToken(authToken) {
    if (!authToken || typeof authToken !== "string") {
      throw new Error("Freebuff auth token is required");
    }

    const trimmed = authToken.trim();

    try {
      const response = await fetch(`${DEFAULT_UPSTREAM_BASE}/api/v1/freebuff/session`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${trimmed}`,
          "Content-Type": "application/json",
          "User-Agent": DEFAULT_USER_AGENT,
          "x-freebuff-model": "google/gemini-2.5-flash-lite",
        },
        body: JSON.stringify({}),
      });

      if (response.status === 401 || response.status === 403) {
        throw new Error("Invalid Freebuff auth token or token expired");
      }

      // If 200 (active) or queued or rate-limited, the token itself is authenticated
      if (!response.ok && response.status !== 429) {
        const text = await response.text().catch(() => "");
        throw new Error(`Token validation failed (${response.status}): ${text || response.statusText}`);
      }

      return {
        accessToken: trimmed,
        expiresIn: 30 * 86400, // Long-lived CLI token (30 days default)
      };
    } catch (err) {
      if (err.message.includes("Invalid Freebuff auth token")) throw err;
      throw new Error(`Freebuff validation error: ${err.message}`);
    }
  }

  /**
   * Extract user info from decoded JWT if token is a JWT, or return null
   */
  extractUserInfo(token, credentialsJson = null) {
    if (credentialsJson?.default) {
      const cred = credentialsJson.default;
      return {
        email: cred.email || null,
        name: cred.name || null,
        id: cred.id || null,
      };
    }

    try {
      const parts = token.split(".");
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
        return {
          email: payload.email || payload.sub || null,
          name: payload.name || null,
          userId: payload.sub || payload.id || null,
        };
      }
    } catch {}

    return null;
  }
}
