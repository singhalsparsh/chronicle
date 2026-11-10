"use client";

import { Badge } from "@/components/ui/badge";
import {
  FileText,
  GitPullRequest,
  MessagesSquare,
  Ticket,
  CheckCircle2,
  CircleSlash2,
  CircleDashed,
  ShieldAlert,
  Archive,
} from "lucide-react";
import type { AccessTier, ClaimStatus, EvidenceCategory, SourceType } from "@/lib/types";
import { CATEGORY_LABEL, SOURCE_TYPE_LABEL, TIER_KEYS } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace-context";

/* ------------------------------------------------------------------ */
/* Formatting                                                           */
/* ------------------------------------------------------------------ */

export function fmtDate(iso: string, withTime = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (!withTime) return date;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

/* ------------------------------------------------------------------ */
/* Tier + type + status badges                                          */
/* ------------------------------------------------------------------ */

const TIER_LABEL: Record<AccessTier, string> = {
  1: "T1 · Restricted",
  2: "T2 · Internal",
  3: "T3 · Confidential",
};

export function TierBadge({ tier }: { tier: AccessTier }) {
  if (tier === 3) {
    return (
      <Badge variant="outline" className="border-evidence/40 bg-evidence/10 text-evidence">
        <ShieldAlert className="size-3 mr-1" data-icon="inline-start" />
        {TIER_LABEL[tier]}
      </Badge>
    );
  }
  if (tier === 2) {
    return (
      <Badge variant="secondary" className="font-mono">
        {TIER_LABEL[tier]}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-mono text-muted-foreground">
      {TIER_LABEL[tier]}
    </Badge>
  );
}

export const SOURCE_TYPE_ICON: Record<SourceType, typeof GitPullRequest> = {
  GITHUB_PR: GitPullRequest,
  SLACK_THREAD: MessagesSquare,
  JIRA_TICKET: Ticket,
  NOTION_DOC: FileText,
};

export function TypeBadge({ type }: { type: SourceType }) {
  const Icon = SOURCE_TYPE_ICON[type];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5" />
      {SOURCE_TYPE_LABEL[type]}
    </span>
  );
}

export function SourceTypeIcon({ type, className }: { type: SourceType; className?: string }) {
  const Icon = SOURCE_TYPE_ICON[type];
  return <Icon className={className ?? "size-4"} />;
}

const STATUS_META: Record<ClaimStatus, { icon: typeof CheckCircle2; label: string; className: string }> = {
  EVIDENCE_GATHERED: {
    icon: CircleDashed,
    label: "Evidence gathered",
    className: "bg-secondary text-secondary-foreground border-transparent",
  },
  VERIFIED: {
    icon: CheckCircle2,
    label: "Verified",
    className: "bg-verified/15 text-verified border-verified/30",
  },
  MISSING_EVIDENCE: {
    icon: CircleSlash2,
    label: "Missing evidence",
    className: "bg-missing/15 text-missing border-missing/30",
  },
  HUMAN_APPROVED: {
    icon: CheckCircle2,
    label: "Human approved",
    className: "bg-verified/15 text-verified border-verified/30",
  },
};

export function ClaimStatusBadge({ status, className, superseded }: { status: ClaimStatus; className?: string; superseded?: boolean }) {
  // Superseded claims are historical losers of resolved conflicts — never show
  // them as plain "Missing evidence" (H-002 / V-002).
  if (superseded) {
    return (
      <Badge variant="outline" className={`border-border bg-muted/60 text-muted-foreground ${className ?? ""}`}>
        <Archive className="size-3 mr-1" data-icon="inline-start" />
        Superseded
      </Badge>
    );
  }
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={`${meta.className} ${className ?? ""}`}>
      <Icon className="size-3 mr-1" data-icon="inline-start" />
      {meta.label}
    </Badge>
  );
}

export function CategoryBadge({ category }: { category: EvidenceCategory }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="size-1.5 rounded-full bg-evidence" />
      {CATEGORY_LABEL[category]}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Citation badges                                                       */
/* ------------------------------------------------------------------ */

export function CitationBadges({ citations }: { citations: { sourceId: string; verbatimQuote: string }[] }) {
  const { openInspector } = useWorkspace();
  return (
    <span className="inline-flex flex-wrap gap-1">
      {citations.map((citation) => (
        <button
          key={citation.sourceId}
          type="button"
          onClick={() => openInspector(citation.sourceId, [citation.verbatimQuote])}
          className="inline-flex min-h-8 items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-foreground/80 transition-colors hover:border-evidence/50 hover:bg-evidence/10 hover:text-evidence focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          title={`Open source in evidence inspector: ${citation.sourceId}`}
        >
          <span className="text-muted-foreground">[</span>
          {citation.sourceId}
          <span className="text-muted-foreground">]</span>
        </button>
      ))}
    </span>
  );
}

export function TierKeyLabel(tier: AccessTier): string {
  return TIER_KEYS[tier].replace("TIER_", "").replaceAll("_", " ");
}
