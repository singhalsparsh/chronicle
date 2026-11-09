import { NextResponse } from "next/server";
import { HandoverRequestSchema } from "@/lib/schemas/handover-zod";
import { getProjectStore } from "@/lib/store/project-store";
import { isErrorResponse, jsonError, parseJsonBody } from "@/lib/api/helpers";
import { toPublicState } from "@/lib/api/public-dto";
import { getViewer } from "@/lib/auth/get-viewer";

/**
 * GET /api/handover — returns the role-filtered handover bundle.
 * POST /api/handover — mutation actions: resolve_conflict | submit_interview |
 *   edit_claim | lock_snapshot | acknowledge_receipt | reset_demo.
 * Both require a valid signed session; tier comes from the session only.
 */
export async function GET(request: Request) {
  const viewer = await getViewer(request);
  if (!viewer) return jsonError(401, "UNAUTHORIZED", "Sign in as a demo user first.");
  try {
    const store = getProjectStore();
    const state = await store.getViewerState(viewer.tier);
    return NextResponse.json({
      ok: true,
      handover: state.handover,
      nextActions: state.nextActions,
      conflicts: state.conflicts,
      gaps: state.gaps,
      auditLog: state.auditLog.slice(-12).reverse(),
      stats: state.stats,
    });
  } catch (error) {
    console.error("[handover:get]", error);
    return jsonError(500, "HANDOVER_UNAVAILABLE", "Could not load handover bundle.");
  }
}

export async function POST(request: Request) {
  const viewer = await getViewer(request);
  if (!viewer) return jsonError(401, "UNAUTHORIZED", "Sign in as a demo user first.");

  const body = await parseJsonBody<unknown>(request);
  if (isErrorResponse(body)) return body;

  const parsed = HandoverRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_FAILED", "Handover payload failed validation.", parsed.error.flatten());
  }

  // E-5: snapshot lifecycle actions are maintainer-only. The lock, receipt, and
  // demo reset are trust-critical for the handover, so any tier below T3 is
  // rejected before the mutation runs.
  const action = parsed.data.action;
  if (
    (action === "lock_snapshot" || action === "acknowledge_receipt" || action === "reset_demo") &&
    viewer.tier < 3
  ) {
    return jsonError(403, "FORBIDDEN", "forbidden: action requires Tier 3 maintainer clearance");
  }

  try {
    const actor = `${viewer.name} (${viewer.id})`;
    const store = getProjectStore();

    switch (action) {
      case "resolve_conflict":
        await store.resolveConflict(viewer.tier, parsed.data.conflictId, parsed.data.choice, parsed.data.note, actor);
        break;
      case "submit_interview":
        await store.submitInterview(viewer.tier, parsed.data.gapId, parsed.data.answers, actor);
        break;
      case "edit_claim":
        await store.editClaim(viewer.tier, parsed.data.claimId, parsed.data.summary, actor);
        break;
      case "lock_snapshot":
        await store.lockSnapshot(viewer.tier, actor);
        break;
      case "acknowledge_receipt":
        await store.acknowledgeReceipt(viewer.tier, actor);
        break;
      case "reset_demo":
        await store.resetDemo(viewer.tier, actor);
        break;
    }

    const state = await store.getViewerState(viewer.tier);
    return NextResponse.json({ ok: true, state: toPublicState(state) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[handover:post]", error);
    if (message.startsWith("forbidden")) {
      return jsonError(403, "FORBIDDEN", message);
    }
    if (message.includes("unresolved conflicts")) {
      return jsonError(409, "UNRESOLVED_CONFLICTS", "Cannot lock snapshot while conflicts are unresolved.");
    }
    if (message.includes("not found") || message.includes("locked")) {
      return jsonError(409, "HANDOVER_CONFLICT", message);
    }
    return jsonError(500, "HANDOVER_FAILED", "Handover action failed.");
  }
}
