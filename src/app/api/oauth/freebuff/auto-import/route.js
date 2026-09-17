import { NextResponse } from "next/server";
import { readFile, access, constants } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

function getCandidateCredentialPaths() {
  const home = homedir();
  const candidates = [
    join(home, ".config", "manicode", "credentials.json"),
  ];

  if (process.env.USERPROFILE) {
    candidates.push(join(process.env.USERPROFILE, ".config", "manicode", "credentials.json"));
  }
  if (process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, "manicode", "credentials.json"));
  }

  // Deduplicate
  return [...new Set(candidates)];
}

/**
 * GET /api/oauth/freebuff/auto-import
 * Auto-detect Freebuff/Codebuff credentials from ~/.config/manicode/credentials.json
 */
export async function GET() {
  try {
    const candidatePaths = getCandidateCredentialPaths();
    let foundPath = null;
    let fileContent = null;

    for (const p of candidatePaths) {
      try {
        await access(p, constants.R_OK);
        fileContent = await readFile(p, "utf-8");
        foundPath = p;
        break;
      } catch {
        // Continue searching next path
      }
    }

    if (!foundPath || !fileContent) {
      return NextResponse.json({
        found: false,
        error: "Freebuff credentials file not found. Ensure you have run Freebuff CLI at least once.",
        checkedPaths: candidatePaths,
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(fileContent);
    } catch {
      return NextResponse.json({
        found: false,
        error: `Failed to parse JSON credentials from ${foundPath}`,
      });
    }

    const defaultCred = parsed.default || parsed;
    const authToken = defaultCred.authToken;

    if (!authToken || typeof authToken !== "string") {
      return NextResponse.json({
        found: false,
        error: `No authToken found in ${foundPath}`,
      });
    }

    return NextResponse.json({
      found: true,
      path: foundPath,
      authToken,
      fingerprintId: defaultCred.fingerprintId || null,
      fingerprintHash: defaultCred.fingerprintHash || null,
      name: defaultCred.name || null,
      email: defaultCred.email || null,
    });
  } catch (err) {
    return NextResponse.json(
      { found: false, error: err.message },
      { status: 500 }
    );
  }
}
