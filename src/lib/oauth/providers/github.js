import { GITHUB_CONFIG } from "../constants/oauth.js";

const github = {
  config: GITHUB_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config) => {
    const response = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        scope: config.scopes,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Device code request failed: ${error}`);
    }

    return await response.json();
  },
  pollToken: async (config, deviceCode) => {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    // Handle response properly - if not ok, try to get error as text first
    let data;
    try {
      data = await response.json();
    } catch (e) {
      // If response is not JSON, get as text
      const text = await response.text();
      data = { error: "invalid_response", error_description: text };
    }

    return {
      ok: response.ok,
      data: data,
    };
  },
  postExchange: async (tokens) => {
    // Get Copilot token using GitHub access token
    const copilotHeaders = {
      Authorization: `token ${tokens.access_token}`,
      Accept: "application/json",
      "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
      "User-Agent": GITHUB_CONFIG.userAgent || "GitHubCopilotChat/0.24.1",
      "Editor-Version": "vscode/1.96.2",
      "Editor-Plugin-Version": "copilot-chat/0.24.1",
    };

    let copilotRes = await fetch(GITHUB_CONFIG.copilotTokenUrl, { headers: copilotHeaders });
    if (!copilotRes.ok) {
      // Fallback to Bearer scheme if token scheme failed
      copilotRes = await fetch(GITHUB_CONFIG.copilotTokenUrl, {
        headers: { ...copilotHeaders, Authorization: `Bearer ${tokens.access_token}` },
      });
    }
    const copilotToken = copilotRes.ok ? await copilotRes.json() : {};

    // Get user info from GitHub
    const userRes = await fetch(GITHUB_CONFIG.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: "application/json",
        "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
        "User-Agent": GITHUB_CONFIG.userAgent,
      },
    });
    const userInfo = userRes.ok ? await userRes.json() : {};

    return { copilotToken, userInfo };
  },
  mapTokens: (tokens, extra) => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    name: extra?.userInfo?.login || extra?.userInfo?.name,
    displayName: extra?.userInfo?.name || extra?.userInfo?.login,
    email: extra?.userInfo?.email || null,
    providerSpecificData: {
      copilotToken: extra?.copilotToken?.token,
      copilotTokenExpiresAt: extra?.copilotToken?.expires_at,
      sku: extra?.copilotToken?.sku,
      plan: extra?.copilotToken?.sku,
      endpoints: extra?.copilotToken?.endpoints,
      githubUserId: extra?.userInfo?.id,
      githubLogin: extra?.userInfo?.login,
      githubName: extra?.userInfo?.name,
      githubEmail: extra?.userInfo?.email,
    },
  }),
};

export default github;
