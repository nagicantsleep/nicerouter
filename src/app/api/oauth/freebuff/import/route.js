import { NextResponse } from "next/server";
import { FreebuffService } from "@/lib/oauth/services/freebuff";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/freebuff/import
 * Import and validate access token from Freebuff/Codebuff CLI
 *
 * Request body:
 * - authToken: string (required)
 * - fingerprintId: string (optional)
 * - fingerprintHash: string (optional)
 * - name: string (optional)
 * - email: string (optional)
 */
export async function POST(request) {
  try {
    const { authToken, fingerprintId, fingerprintHash, name, email } = await request.json();

    if (!authToken || typeof authToken !== "string") {
      return NextResponse.json(
        { error: "Freebuff auth token is required" },
        { status: 400 }
      );
    }

    const freebuffService = new FreebuffService();

    // Validate token by attempting session ping
    const tokenData = await freebuffService.validateImportToken(authToken.trim());

    // Extract user info if present
    const userInfo = freebuffService.extractUserInfo(tokenData.accessToken);

    const userEmail = email || userInfo?.email || null;
    const userName = name || userInfo?.name || null;

    // Save to database
    const connection = await createProviderConnection({
      provider: "freebuff",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: null,
      expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
      email: userEmail,
      providerSpecificData: {
        fingerprintId: fingerprintId || null,
        fingerprintHash: fingerprintHash || null,
        name: userName,
        authMethod: "imported",
        provider: "Imported",
      },
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Failed to import Freebuff token" },
      { status: 400 }
    );
  }
}
