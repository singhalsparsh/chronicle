import { NextResponse } from "next/server";
import { VerifyRequestSchema } from "@/lib/schemas/handover-zod";
import { getProjectStore } from "@/lib/store/project-store";
import { isErrorResponse, jsonError, parseJsonBody } from "@/lib/api/helpers";
import { toPublicState } from "@/lib/api/public-dto";
import { getViewer } from "@/lib/auth/get-viewer";

/**
 * POST /api/verify
 * Runs programmatic quote grounding on claims; downgrades unverified claims
 * to MISSING_EVIDENCE unless HUMAN_APPROVED. Requires a valid session; only
 * claims within the viewer's tier are targeted.
 */
export async function POST(request: Request) {
  const viewer = await getViewer(request);
  if (!viewer) return jsonError(401, "UNAUTHORIZED", "Sign in as a demo user first.");

  const body = await parseJsonBody<unknown>(request);
  if (isErrorResponse(body)) return body;

  const parsed = VerifyRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_FAILED", "Verify payload failed validation.", parsed.error.flatten());
  }

  try {
    const store = getProjectStore();
    const outcome = await store.verify(viewer.tier, parsed.data.claimIds, `${viewer.name} (${viewer.id})`);
    const state = await store.getViewerState(viewer.tier);
    return NextResponse.json({ ok: true, outcome, state: toPublicState(state) });
  } catch (error) {
    console.error("[verify]", error);
    return jsonError(500, "VERIFY_FAILED", "Verification failed.");
  }
}
