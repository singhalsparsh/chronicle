import { NextResponse } from "next/server";
import { ReconstructRequestSchema } from "@/lib/schemas/handover-zod";
import { getProjectStore } from "@/lib/store/project-store";
import { isErrorResponse, jsonError, parseJsonBody, viewerTierFromRequest } from "@/lib/api/helpers";

/**
 * GET /api/reconstruct — returns the current role-filtered workspace state.
 * POST /api/reconstruct — re-runs temporal reconstruction (optionally followed by verification).
 */
export async function GET(request: Request) {
  try {
    const store = getProjectStore();
    const state = await store.getViewerState(viewerTierFromRequest(request));
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    console.error("[reconstruct:get]", error);
    return jsonError(500, "STATE_UNAVAILABLE", "Could not load workspace state.");
  }
}

export async function POST(request: Request) {
  const body = await parseJsonBody<unknown>(request);
  if (isErrorResponse(body)) return body;

  const parsed = ReconstructRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_FAILED", "Reconstruct payload failed validation.", parsed.error.flatten());
  }

  try {
    const tier = viewerTierFromRequest(request);
    const store = getProjectStore();
    await store.reconstruct(tier);
    if (parsed.data.withVerify) {
      await store.verify(tier);
    }
    const state = await store.getViewerState(tier);
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    console.error("[reconstruct:post]", error);
    return jsonError(500, "RECONSTRUCT_FAILED", "Reconstruction failed.");
  }
}
