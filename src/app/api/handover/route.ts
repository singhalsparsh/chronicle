import { NextResponse } from "next/server";
import { HandoverRequestSchema } from "@/lib/schemas/handover-zod";
import { getProjectStore } from "@/lib/store/project-store";
import { isErrorResponse, jsonError, parseJsonBody, viewerTierFromRequest } from "@/lib/api/helpers";
import { toPublicState } from "@/lib/api/public-dto";

/**
 * GET /api/handover — returns the role-filtered handover bundle.
 * POST /api/handover — mutation actions: resolve_conflict | submit_interview |
 *   edit_claim | lock_snapshot | acknowledge_receipt | reset_demo.
 */
export async function GET(request: Request) {
  try {
    const store = getProjectStore();
    const state = await store.getViewerState(viewerTierFromRequest(request));
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
  const body = await parseJsonBody<unknown>(request);
  if (isErrorResponse(body)) return body;

  const parsed = HandoverRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_FAILED", "Handover payload failed validation.", parsed.error.flatten());
  }

  try {
    const tier = viewerTierFromRequest(request);
    const store = getProjectStore();
    const action = parsed.data.action;

    switch (action) {
      case "resolve_conflict":
        await store.resolveConflict(tier, parsed.data.conflictId, parsed.data.choice, parsed.data.note);
        break;
      case "submit_interview":
        await store.submitInterview(tier, parsed.data.gapId, parsed.data.answers);
        break;
      case "edit_claim":
        await store.editClaim(tier, parsed.data.claimId, parsed.data.summary);
        break;
      case "lock_snapshot":
        await store.lockSnapshot(tier);
        break;
      case "acknowledge_receipt":
        await store.acknowledgeReceipt(tier);
        break;
      case "reset_demo":
        await store.resetDemo(tier);
        break;
    }

    const state = await store.getViewerState(tier);
    return NextResponse.json({ ok: true, state: toPublicState(state) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[handover:post]", error);
    if (message.includes("not found") || message.includes("locked")) {
      return jsonError(409, "HANDOVER_CONFLICT", message);
    }
    return jsonError(500, "HANDOVER_FAILED", "Handover action failed.");
  }
}
