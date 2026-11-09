"use client";

import { TopNavStepper } from "@/components/top-nav-stepper";
import { StageConnect } from "@/components/stage-connect";
import { StageReconstructVerify } from "@/components/stage-reconstruct-verify";
import { StageReview } from "@/components/stage-review";
import { StageHandover } from "@/components/stage-handover";
import { CitationInspectorDrawer } from "@/components/citation-inspector-drawer";
import { useWorkspace, STAGES } from "@/lib/workspace-context";
import { Skeleton } from "@/components/ui/skeleton";

const GUIDANCE: Record<number, string> = {
  1: "Explore the 8 pre-loaded artifacts or paste a custom source; secrets are scrubbed on write — stored and served text is already scrubbed.",
  2: "Click “Reconstruct & Verify Project State” to extract the chronological claim graph from the evidence.",
  3: "Review programmatic quote grounding; every citation must resolve to a verbatim substring of its source.",
  4: "Resolve detected contradictions and answer the 3-question exit interviews to approve missing evidence.",
  5: "Lock Snapshot v1.0, acknowledge the handover receipt, and review the timestamped audit trail.",
};

function StageBody() {
  const { stage } = useWorkspace();
  switch (stage) {
    case 1:
      return <StageConnect />;
    case 2:
    case 3:
      return <StageReconstructVerify />;
    case 4:
      return <StageReview />;
    case 5:
      return <StageHandover />;
    default:
      return <StageConnect />;
  }
}

export function WorkspaceClient() {
  const { loading, stage } = useWorkspace();
  const activeStage = STAGES.find((s) => s.id === stage);

  return (
    <div className="flex min-h-screen flex-col">
      <TopNavStepper />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-5 lg:px-6">
          {/* Guidance ribbon */}
          <div className="mb-5 flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-evidence/15 font-mono text-[11px] text-evidence">
              {activeStage?.id}
            </span>
            <div>
              <p className="text-sm font-medium">Stage {activeStage?.id} · {activeStage?.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{GUIDANCE[stage]}</p>
            </div>
          </div>

          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-28 w-full" />
              <div className="grid gap-4 lg:grid-cols-3">
                <Skeleton className="h-64" />
                <Skeleton className="h-64" />
                <Skeleton className="h-64" />
              </div>
            </div>
          ) : (
            <StageBody />
          )}
        </div>
      </main>
      <footer className="border-t border-border px-4 py-3 lg:px-6">
        <p className="text-center text-[11px] text-muted-foreground">
          Chronicle · Evidence-Linked Project State Reconstruction &amp; Permissioned Handover · synthetic
          judge dataset · demo identities (no passwords)
        </p>
      </footer>
      <CitationInspectorDrawer />
    </div>
  );
}
