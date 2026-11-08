"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleSlash2,
  Loader2,
  ScanSearch,
  ShieldQuestion,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useWorkspace, STAGES } from "@/lib/workspace-context";
import { CategoryBadge, CitationBadges, ClaimStatusBadge, TierBadge, fmtDate } from "@/components/shared";
import type { EvidenceCategory } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/types";

const CATEGORIES: EvidenceCategory[] = [
  "DECISION",
  "UNFINISHED",
  "RISK",
  "DEPENDENCY",
  "CONTACT",
  "NEXT_ACTION",
];

function StatTile({ label, value, accent, hint }: { label: string; value: string | number; accent?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-mono text-xl font-semibold tabular-nums ${accent ?? ""}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function StageReconstructVerify() {
  const { state, reconstruct, verify, setStage, stage } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<EvidenceCategory | "ALL">("ALL");

  const claims = useMemo(() => state?.claims ?? [], [state]);
  const filteredClaims = useMemo(() => {
    const sorted = [...claims].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    return category === "ALL" ? sorted : sorted.filter((c) => c.category === category);
  }, [claims, category]);

  // Use the stats computed server-side from the latest API response so the
  // "Quote grounded" card matches what the verification run actually produced.
  const verifiedCount = state?.stats.verifiedClaims ?? 0;
  const missingCount = state?.stats.missingEvidenceClaims ?? 0;
  const totalClaims = state?.stats.visibleClaims ?? 0;
  const coverage = totalClaims > 0 ? Math.round((verifiedCount / totalClaims) * 100) : 0;

  const isReconstruct = stage === 2;
  const isVerify = stage === 3;

  const runPipeline = async () => {
    setBusy(true);
    try {
      await reconstruct();
      await verify();
      toast.success("Reconstruction & verification complete", {
        description: `${state?.stats.visibleClaims ?? 0} claims quote-grounded · ${state?.stats.unresolvedConflicts ?? 0} conflicts open`,
      });
    } catch {
      toast.error("Pipeline failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ================= Stage 02 — Reconstruct ================= */}
      {isReconstruct && (
        <>
          {/* Action header */}
          <Card className="border-primary/0 bg-gradient-to-br from-evidence/10 via-transparent to-transparent">
            <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold">Reconstruct project state</h2>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  Chronicle extracts decisions, unfinished work, risks, dependencies, contacts and
                  first-7-days actions chronologically from the evidence.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {state?.project.lastReconstructedAt ? (
                    <>Last reconstructed {fmtDate(state.project.lastReconstructedAt, true)}</>
                  ) : (
                    "Pre-seeded reconstruction is ready."
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={runPipeline} disabled={busy} className="shrink-0">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {busy ? "Reconstructing…" : "Reconstruct & Verify Project State"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Visible sources" value={state?.stats.visibleSources ?? 0} hint={`${state?.stats.totalSources ?? 0} total`} />
            <StatTile label="Claims" value={state?.stats.visibleClaims ?? 0} hint={`${state?.stats.withheldClaims ?? 0} withheld by role`} />
            <StatTile label="Quote grounded" value={`${coverage}%`} accent="text-verified" hint={`${verifiedCount} verified`} />
            <StatTile label="Missing evidence" value={missingCount} accent="text-missing" hint="incl. exit interviews" />
            <StatTile label="Conflicts" value={state?.stats.conflicts ?? 0} accent="text-conflict" hint={`${state?.stats.unresolvedConflicts ?? 0} unresolved`} />
            <StatTile label="Open gaps" value={state?.stats.openGaps ?? 0} accent="text-missing" hint="3-question interviews" />
          </div>

          {/* Timeline */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="text-sm">Chronological timeline</CardTitle>
                  <CardDescription>Ordered by source timestamp, oldest to newest.</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setCategory("ALL")}
                    className={`h-9 rounded-md px-3 text-xs font-medium transition-colors ${
                      category === "ALL" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    All
                  </button>
                  {CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={`h-9 rounded-md px-3 text-xs font-medium transition-colors ${
                        category === c ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {CATEGORY_LABEL[c]}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="relative space-y-2.5 pl-4 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-px before:bg-border">
                {filteredClaims.map((claim) => (
                  <div key={claim.id} className="relative rounded-lg border border-border bg-card p-3.5">
                    <div className="absolute -left-[18px] top-4 size-2.5 rounded-full bg-evidence ring-4 ring-background" />
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                        {fmtDate(claim.timestamp)}
                      </span>
                      <CategoryBadge category={claim.category} />
                      <span className="text-xs text-muted-foreground">{claim.author}</span>
                      <span className="ml-auto">
                        <ClaimStatusBadge status={claim.status} className="h-5 text-[11px]" />
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm font-medium">{claim.title}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{claim.summary}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <CitationBadges citations={claim.citations} />
                      <TierBadge tier={claim.accessTier} />
                    </div>
                  </div>
                ))}
              </div>
              {filteredClaims.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No claims in this category.</p>
              )}
            </CardContent>
          </Card>

          {/* Conflict radar */}
          {(state?.conflicts.length ?? 0) > 0 && (
            <Card>
              <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-md border border-conflict/30 bg-conflict/10 text-conflict">
                    <TriangleAlert className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {state?.stats.unresolvedConflicts} unresolved contradiction{state?.stats.unresolvedConflicts === 1 ? "" : "s"} detected
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {state?.conflicts.map((c) => c.subject).join(" · ")}, resolve them in Review.
                    </p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => setStage(4)}>
                  <ShieldQuestion className="size-4" />
                  Go to Review ({STAGES[3].label})
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ================= Stage 03 — Verify ================= */}
      {isVerify && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ScanSearch className="size-4 text-evidence" />
                  Programmatic citation grounding
                </CardTitle>
                <CardDescription>
                  Each citation must resolve to a source and its quote must be a normalized substring of
                  that source text.
                </CardDescription>
              </div>
              <div className="w-32">
                <Progress value={coverage} className="h-1.5" />
                <p className="mt-1 text-right text-[11px] text-muted-foreground">{coverage}% covered</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 lg:grid-cols-2">
              {claims.map((claim) => (
                <div key={claim.id} className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">{claim.id}</span>
                    <ClaimStatusBadge status={claim.status} className="h-5 text-[11px]" />
                  </div>
                  <p className="mt-1.5 text-[13px] font-medium leading-snug">{claim.title}</p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {claim.citations.map((citation) => (
                      <div key={citation.sourceId} className="flex items-start gap-2 text-xs">
                        {citation.verification === "VERIFIED" ? (
                          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-verified" />
                        ) : (
                          <CircleSlash2 className="mt-0.5 size-3.5 shrink-0 text-missing" />
                        )}
                        <span className="font-mono text-[11px] text-muted-foreground">{citation.sourceId}</span>
                        <span className="line-clamp-1 flex-1 text-muted-foreground">
                          “{citation.verbatimQuote}”
                        </span>
                        <Badge
                          variant="outline"
                          className={`h-5 shrink-0 font-mono text-[11px] ${
                            citation.verification === "VERIFIED"
                              ? "border-verified/30 bg-verified/10 text-verified"
                              : "border-missing/30 bg-missing/10 text-missing"
                          }`}
                        >
                          {citation.verification}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {claims.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No claims to verify.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
