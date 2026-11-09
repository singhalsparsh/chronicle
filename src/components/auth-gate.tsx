"use client";

import { useEffect, useState } from "react";
import { WorkspaceClient } from "@/app/workspace-client";
import { EntryScreen } from "./entry-screen";

/**
 * Entry gate: checks the session cookie via GET /api/session (the only place
 * that decides who is signed in) and renders either the workspace or the
 * one-click demo-identity screen. Kept client-side so no RSC render ever
 * touches signed-cookie timing values.
 */
export function AuthGate() {
  const [status, setStatus] = useState<"loading" | "signed-in" | "signed-out">("loading");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/session", { credentials: "include" });
        const data = (await res.json()) as { user?: unknown };
        if (active) setStatus(data.user ? "signed-in" : "signed-out");
      } catch {
        if (active) setStatus("signed-out");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading Chronicle…
      </div>
    );
  }
  if (status === "signed-out") return <EntryScreen />;
  return <WorkspaceClient />;
}
