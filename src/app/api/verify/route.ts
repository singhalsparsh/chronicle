import { NextResponse } from "next/server";
import { VerifyRequestSchema } from "@/lib/schemas/handover-zod";
import { getProjectStore } from "@/lib/store/project-store";
import { isErrorResponse, jsonError, parseJsonBody, viewerTierFromRequest } from "@/lib/api/helpers";

/**
 * POST /api/verify
 * Runs programmatic quote grounding on claims; downgrades unverified claims
 * to MISSING_EVIDENCE unless HUMAN_APPROVED.
 */
export async function POST(request: Request) {
  const body = await parseJsonBody<unknown>(request);
  if (isErrorResponse(body)) return body;

  const parsed = VerifyRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_FAILED", "Verify payload failed validation.", parsed.error.flatten());
  }

  try {
    const tier = viewerTierFromRequest(request);
    const store = getProjectStore();
    const outcome = await store.verify(tier, parsed.data.claimIds);
    const state = await store.getViewerState(tier);
    return NextResponse.json({ ok: true, outcome, state });
  } catch (error) {
    console.error("[verify]", error);
    return jsonError(500, "VERIFY_FAILED", "Verification failed.");
  }
}
