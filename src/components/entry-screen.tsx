"use client";

import { useState } from "react";
import { Archive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_USERS } from "@/lib/auth/demo-users";
import type { DemoUserId } from "@/lib/auth/demo-users";

export function EntryScreen() {
  const [busy, setBusy] = useState<DemoUserId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enter = async (userId: DemoUserId) => {
    setBusy(userId);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("sign-in failed");
      window.location.reload();
    } catch {
      setError("Could not start a session. Please try again.");
      setBusy(null);
    }
  };

  const options = (Object.keys(DEMO_USERS) as DemoUserId[]).map((id) => {
    const user = DEMO_USERS[id];
    return { id, user };
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 shrink-0 place-items-center rounded-md border border-evidence/40 bg-evidence/10 text-evidence">
              <Archive className="size-4.5" />
            </div>
            <div>
              <CardTitle className="text-base">Chronicle</CardTitle>
              <CardDescription>Evidence-linked project state reconstruction &amp; permissioned handover</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Choose a demo identity. No password — the role is bound to your session and
            cannot be changed from the client.
          </p>
          {options.map(({ id, user }) => (
            <Button
              key={id}
              variant="outline"
              className="w-full justify-between h-11"
              disabled={busy !== null}
              onClick={() => enter(id)}
            >
              <span>
                Enter as {user.name} — {user.role} ({`T${user.tier}`})
              </span>
              {busy === id ? <Loader2 className="size-4 animate-spin" /> : null}
            </Button>
          ))}
          {error && <p className="text-xs text-conflict">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
