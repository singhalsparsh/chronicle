"use client";

import { useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  Clock3,
  Download,
  Fingerprint,
  HardHat,
  ListChecks,
  Loader2,
  LockKeyhole,
  ScrollText,
  Send,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace-context";
import { fmtDate } from "@/components/shared";
import type { AuditAction, NextActionItem } from "@/lib/types";

const ACTION_LABEL: Record<AuditAction, string> = {
  APP_LOADED: "Workspace loaded",
  ROLE_CHANGED: "Role preview changed",
  SOURCE_INGESTED: "Source ingested",
  SECRET_REDACTED: "Secrets scrubbed",
  RECONSTRUCT_COMPLETED: "Reconstruction",
  VERIFICATION_COMPLETED: "Verification",
  CLAIM_EDITED: "Claim edited",
  CONFLICT_RESOLVED: "Conflict resolved",
  INTERVIEW_COMPLETED: "Interview completed",
  SNAPSHOT_LOCKED: "Snapshot locked",
  RECEIPT_ACKNOWLEDGED: "Receipt acknowledged",
  MUTATION_REJECTED: "Mutation rejected",
  DEMO_RESET: "Demo reset",
};

const PRIORITY_STYLE: Record<NextActionItem["priority"], string> = {
  P0: "border-conflict/40 bg-conflict/10 text-conflict",
  P1: "border-evidence/40 bg-evidence/10 text-evidence",
  P2: "border-border bg-muted/40 text-muted-foreground",
};

function NextActionRow({ item }: { item: NextActionItem }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
      <div className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border font-mono text-[11px] font-semibold ${PRIORITY_STYLE[item.priority]}`}>
        {item.priority}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-snug">{item.task}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          ref {item.ref} {item.ownerHint ? `· ${item.ownerHint}` : ""}
        </p>
      </div>
    </div>
  );
}

export function StageHandover() {
  const { state, lockSnapshot, acknowledgeReceipt, setStage, viewer } = useWorkspace();
  const isMaintainer = viewer?.tier === 3;
  const [busy, setBusy] = useState<"lock" | "receipt" | "export" | null>(null);

  const handover = state?.handover;
  const contacts = state?.claims.filter((c) => c.category === "CONTACT") ?? [];
  const dependencies = state?.claims.filter((c) => c.category === "DEPENDENCY") ?? [];
  const nextActions = state?.nextActions ?? [];
  const audit = state?.auditLog.slice(-10).reverse() ?? [];

  const onLock = async () => {
    // Hostile-audit fix: prevent locking while conflicts are still unresolved.
    const unresolvedConflicts = state?.conflicts.filter((c) => c.resolution === "UNRESOLVED").length ?? 0;
    if (unresolvedConflicts > 0) {
      toast.error("Cannot lock snapshot: Resolve all conflicts first.", {
        description: `${unresolvedConflicts} conflict(s) still unresolved.`,
      });
      return;
    }
    setBusy("lock");
    try {
      await lockSnapshot();
      toast.success("Snapshot v1.0 locked & published", {
        description: "The immutable digest was written to the handover record.",
      });
    } catch {
      toast.error("Could not lock snapshot.");
    } finally {
      setBusy(null);
    }
  };

  const onReceipt = async () => {
    setBusy("receipt");
    try {
      await acknowledgeReceipt();
      toast.success("Handover receipt acknowledged", {
        description: "A timestamped audit entry was logged.",
      });
    } catch {
      toast.error("Could not acknowledge receipt.");
    } finally {
      setBusy(null);
    }
  };

  const onExport = async () => {
    setBusy("export");
    try {
      const res = await fetch("/api/handover/export", {
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? "Export failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `chronicle-handover-${handover?.version ?? "v1.0"}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Handover packet downloaded", {
        description: "Markdown snapshot exported for the incoming owner.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export the handover packet.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_400px]">
      {/* Left — portal */}
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Send className="size-4 text-evidence" />
                  Incoming handover portal
                </CardTitle>
                <CardDescription>
                  Permissioned state bundle for the incoming owner of {state?.project.name}.
                </CardDescription>
              </div>
              <Badge variant="outline" className="h-6 border-evidence/40 bg-evidence/10 font-mono text-[11px] text-evidence">
                snapshot {handover?.version ?? "v1.0"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border p-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <UserRound className="size-3.5" /> Departing lead
              </p>
              <p className="mt-1 font-mono text-sm font-medium">{state?.project.departingLead}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock3 className="size-3.5" /> Handover window
              </p>
              <p className="mt-1 text-sm font-medium">May 8 – May 22</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <HardHat className="size-3.5" /> Incoming owner
              </p>
              <p className="mt-1 text-sm font-medium">@sparsh_s</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Who to ask</CardTitle>
              <CardDescription>Contacts extracted from the evidence.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {contacts.map((claim) => (
                <div key={claim.id} className="rounded-lg border border-border bg-card p-3">
                  <p className="text-[13px] font-medium">{claim.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{claim.summary}</p>
                  <div className="mt-1.5">
                    <Badge variant="outline" className="h-5 font-mono text-[11px] text-evidence border-evidence/30 bg-evidence/10">
                      {claim.author}
                    </Badge>
                  </div>
                </div>
              ))}
              {contacts.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">No contact claims visible.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Dependencies &amp; open flags</CardTitle>
              <CardDescription>What the incoming owner must know.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {dependencies.map((claim) => (
                <div key={claim.id} className="rounded-lg border border-border bg-card p-3">
                  <p className="text-[13px] font-medium">{claim.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{claim.summary}</p>
                </div>
              ))}
              <Separator className="my-1" />
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="h-6 text-[11px] text-conflict border-conflict/30 bg-conflict/10">
                  {state?.stats.unresolvedConflicts ?? 0} unresolved conflicts
                </Badge>
                <Badge variant="outline" className="h-6 text-[11px] text-missing border-missing/30 bg-missing/10">
                  {state?.stats.openGaps ?? 0} open exit interviews
                </Badge>
                <Badge variant="outline" className="h-6 text-[11px] text-missing border-missing/30 bg-missing/10">
                  {state?.stats.missingEvidenceClaims ?? 0} missing-evidence claims
                </Badge>
              </div>
              {((state?.stats.unresolvedConflicts ?? 0) > 0 || (state?.stats.openGaps ?? 0) > 0) && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => setStage(4)}>
                  Resolve before handover
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ListChecks className="size-4 text-evidence" />
              First 7 days · next actions
            </CardTitle>
            <CardDescription>Ranked P0 → P2 from unfinished work and gaps.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2">
              {nextActions.map((item) => (
                <NextActionRow key={item.task} item={item} />
              ))}
            </div>
            {nextActions.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">No visible next actions.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right — snapshot + audit */}
      <div className="space-y-5">
        <Card className="border-evidence/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <LockKeyhole className="size-4 text-evidence" />
              Snapshot
            </CardTitle>
            <CardDescription>Lock the immutable state bundle, then acknowledge receipt.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2.5">
              <span className="text-xs text-muted-foreground">Version</span>
              <span className="font-mono text-sm font-semibold">{handover?.version}</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Fingerprint className="size-3.5" /> Digest
              </span>
              <span className="truncate font-mono text-[11px]">{handover?.digest || "—"}</span>
            </div>

            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={onLock}
                disabled={busy !== null || handover?.locked || !isMaintainer}
              >
                {busy === "lock" ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}
                {handover?.locked ? "Snapshot v1.0 published" : "Lock & Publish Snapshot v1.0"}
              </Button>
              {!isMaintainer && !handover?.locked && (
                <p className="text-center text-[11px] text-muted-foreground">
                  Requires Maintainer (T3) clearance to lock
                </p>
              )}
              {handover?.locked && (
                <Button className="w-full" variant="outline" onClick={onReceipt} disabled={busy !== null || handover.receiptAcknowledged}>
                  {busy === "receipt" ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />}
                  {handover.receiptAcknowledged ? "Receipt acknowledged" : "Acknowledge Handover Receipt"}
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <Button
                className="w-full"
                variant="outline"
                onClick={onExport}
                disabled={busy !== null || !handover?.locked}
              >
                {busy === "export" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                {handover?.locked ? "Download Handover Packet" : "Lock snapshot to download packet"}
              </Button>
            </div>

            {handover?.locked && (
              <div className="rounded-lg border border-verified/30 bg-verified/10 p-3 text-xs">
                <p className="flex items-center gap-1.5 font-medium text-verified">
                  <CheckCircle2 className="size-3.5" />
                  Snapshot locked {handover.lockedAt ? fmtDate(handover.lockedAt, true) : ""}
                </p>
                {handover.receiptAcknowledged && (
                  <p className="mt-1 text-muted-foreground">
                    Receipt acknowledged by {handover.ackActor} · {fmtDate(handover.receiptAcknowledgedAt ?? "", true)}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ScrollText className="size-4 text-muted-foreground" />
              Audit trail
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px] pr-3">
              <div className="space-y-2.5">
                {audit.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-border bg-muted/20 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">{entry.id}</span>
                      <span className="text-[11px] text-muted-foreground">{fmtDate(entry.ts, true)}</span>
                    </div>
                    <p className="mt-0.5 text-xs font-medium">{ACTION_LABEL[entry.action]}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{entry.detail}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{entry.actor}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
