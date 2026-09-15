import { Suspense } from "react";
import ConsoleLogClient from "./ConsoleLogClient";

// Force dynamic so Next.js standalone build includes the server-side JS file
export const dynamic = "force-dynamic";

export default function ConsoleLogPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-text-muted text-xs">Loading console logs...</div>}>
      <ConsoleLogClient />
    </Suspense>
  );
}
