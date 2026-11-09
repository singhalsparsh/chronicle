/**
 * Chronicle — Handover packet renderer.
 *
 * Produces a perfectly formatted Markdown document for the locked v1.0 snapshot:
 * verified claims, who-to-ask, next actions, and the audit log.
 */
import type { EvidenceCategory, WorkspaceState } from "@/lib/types";
import { CATEGORY_LABEL, SOURCE_TYPE_LABEL } from "@/lib/types";

function esc(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function iso(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString();
}

export function buildHandoverMarkdown(state: WorkspaceState, viewerLabel: string): string {
  const lines: string[] = [];
  const h = state.handover;

  lines.push("# Chronicle — Handover Packet");
  lines.push("");
  lines.push(`**Project:** ${state.project.name}`);
  lines.push(`**Departing lead:** ${state.project.departingLead}`);
  lines.push(`**Snapshot:** ${h.version} · locked ${iso(h.lockedAt)}`);
  lines.push(`**Digest:** \`${h.digest || "unset"}\``);
  lines.push(`**Receipt:** ${h.receiptAcknowledged ? `acknowledged by ${h.ackActor ?? "—"} at ${iso(h.receiptAcknowledgedAt)}` : "not yet acknowledged"}`);
  lines.push(`**Exported for:** ${viewerLabel}`);
  lines.push(`**Generated at:** ${iso(new Date().toISOString())}`);
  lines.push("");

  lines.push("## 1. What-to-Ask");
  lines.push("");
  if (state.whoToAsk.length === 0) {
    lines.push("_No contacts extracted for this role._");
  } else {
    lines.push("| Handle | Name | Artifacts | Evidence facts | Topics |");
    lines.push("| --- | --- | ---: | ---: | --- |");
    for (const entry of state.whoToAsk) {
      lines.push(
        `| ${esc(entry.handle)} | ${esc(entry.displayName)} | ${entry.artifactCount} | ${entry.factCount} | ${esc(entry.topics.join(", ") || "—")} |`
      );
    }
  }
  lines.push("");

  lines.push("## 2. Verified claims");
  lines.push("");
  const verified = state.claims.filter(
    (c) => c.status === "VERIFIED" || c.status === "HUMAN_APPROVED"
  );
  const forCategory = new Map<EvidenceCategory, typeof verified>();
  for (const claim of verified) {
    const list = forCategory.get(claim.category) ?? [];
    list.push(claim);
    forCategory.set(claim.category, list);
  }
  if (verified.length === 0) {
    lines.push("_No verified claims for this role._");
  } else {
    for (const [category, claims] of forCategory) {
      lines.push(`### ${CATEGORY_LABEL[category]}`);
      lines.push("");
      for (const claim of claims) {
        lines.push(`- **${esc(claim.title)}** — ${claim.status} · authored by ${esc(claim.author)}`);
        for (const citation of claim.citations) {
          lines.push(`  - [${esc(citation.sourceId)}] "${esc(citation.verbatimQuote)}"`);
        }
        lines.push("");
      }
    }
  }

  lines.push("## 2.5 Exit interviews (missing-evidence flags)");
  lines.push("");
  const interviews = state.gaps;
  if (interviews.length === 0) {
    lines.push("_No exit interviews on file for this role._");
  } else {
    for (const gap of interviews) {
      lines.push(`### ${gap.title}`);
      lines.push("");
      lines.push(`- Status: ${gap.status}`);
      lines.push(`- Sources: ${gap.sourceIds.join(", ")}`);
      if (gap.approvedAt) lines.push(`- Approved at: ${iso(gap.approvedAt)}`);
      lines.push("");
      gap.questions.forEach((question, i) => {
        const answer = gap.answers[i]?.trim();
        lines.push(`**Q${i + 1}.** ${question}`);
        lines.push("");
        lines.push(answer ? `> ${answer}` : "> _(no answer recorded)_");
        lines.push("");
      });
    }
  }
  lines.push("");

  lines.push("## 3. First 7 days — next actions");
  lines.push("");
  if (state.nextActions.length === 0) {
    lines.push("_No open next actions for this role._");
  } else {
    lines.push("| Priority | Task | Ref |");
    lines.push("| --- | --- | --- |");
    for (const item of state.nextActions) {
      lines.push(`| ${item.priority} | ${esc(item.task)} | ${esc(item.ref)} |`);
    }
  }
  lines.push("");

  lines.push("## 4. Open flags");
  lines.push("");
  lines.push(`- Unresolved conflicts: ${state.stats.unresolvedConflicts}`);
  lines.push(`- Open exit interviews: ${state.stats.openGaps}`);
  lines.push(`- Missing-evidence claims: ${state.stats.missingEvidenceClaims}`);
  lines.push(`- Total claims: ${state.stats.visibleClaims} (of ${state.stats.totalClaims})`);
  lines.push("");

  lines.push("## 5. Evidence sources");
  lines.push("");
  lines.push("| Source | Type | Author | Created | Tier |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const source of state.sources) {
    lines.push(
      `| ${src(source.id)} | ${SOURCE_TYPE_LABEL[source.type]} | ${esc(source.author)} | ${iso(source.createdAt)} | ${source.accessTier} |`
    );
  }
  lines.push("");

  lines.push("## 6. Audit log (latest 30)");
  lines.push("");
  const audit = state.auditLog.slice(-30).reverse();
  lines.push("| Time | Actor | Action | Detail |");
  lines.push("| --- | --- | --- | --- |");
  for (const entry of audit) {
    lines.push(`| ${iso(entry.ts)} | ${esc(entry.actor)} | ${entry.action} | ${esc(entry.detail)} |`);
  }
  lines.push("");
  lines.push("---");
  lines.push(`_Generated by Chronicle · ${state.project.name} · snapshot ${h.version}_`);

  return lines.join("\n");
}

function src(value: string): string {
  return `\`${value}\``;
}
