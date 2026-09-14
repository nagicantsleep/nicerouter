import { NextResponse } from "next/server";
import fs from "node:fs";
import {
  clearConsoleLogs,
  getConsoleLogs,
  initConsoleLogCapture,
  truncateDiskLogs,
  getDiskLogInfo,
} from "@/lib/consoleLogBuffer";

initConsoleLogCapture();

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const download = searchParams.get("download");

    // Download error.log directly as attachment
    if (download === "disk") {
      const diskInfo = getDiskLogInfo();
      if (diskInfo.path && fs.existsSync(diskInfo.path)) {
        const stream = fs.createReadStream(diskInfo.path);
        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": 'attachment; filename="9router-error.log"',
          },
        });
      }
      return new Response("No disk logs found", { status: 404 });
    }

    const logs = getConsoleLogs();
    const diskInfo = getDiskLogInfo();

    return NextResponse.json({
      success: true,
      logs,
      diskLogInfo: diskInfo,
    });
  } catch (error) {
    console.error("Error getting console logs:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const cleanDisk = searchParams.get("cleanDisk") === "true";

    clearConsoleLogs();

    let diskResult = null;
    if (cleanDisk) {
      diskResult = truncateDiskLogs();
    }

    const diskInfo = getDiskLogInfo();

    return NextResponse.json({
      success: true,
      cleanedDisk: cleanDisk,
      diskResult,
      diskLogInfo: diskInfo,
    });
  } catch (error) {
    console.error("Error clearing console logs:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
