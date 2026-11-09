import { NextResponse } from "next/server";
import { ReconstructRequestSchema } from "@/lib/schemas/handover-zod";
import { getProjectStore } from "@/lib/store/project-store";
import { isErrorResponse, jsonError, parseJsonBody } from "@/lib/api/helpers";
import { toPublicState } from "@/lib/api/public-dto";
import { getViewer } from "@/lib/auth/get-viewer";

/**
 * GET /api/reconstruct — returns the current role-filtered workspace state.
 * POST /api/reconstruct — re-runs temporal reconstruction (optionally followed by verification).
 * Both require a valid signed session; tier comes from the session only.
 */
export async function GET(request: Request) {
  const viewer = await getViewer(request);
  if (!viewer) return jsonError(401, "UNAUTHORIZED", "Sign in as a demo user first.");
  try {
    const store = getProjectStore();
    const state = await store.getViewerState(viewer.tier);
    return NextResponse.json({ ok: true, state: toPublicState(state) });
  } catch (error) {
    console.error("[reconstruct:get]", error);
    return jsonError(500, "STATE_UNAVAILABLE", "Could not load workspace state.");
  }
}

export async function POST(request: Request) {
  const viewer = await getViewer(request);
  if (!viewer) return jsonError(401, "UNAUTHORIZED", "Sign in as a demo user first.");

  const body = await parseJsonBody<unknown>(request);
  if (isErrorResponse(body)) return body;

  const parsed = ReconstructRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_FAILED", "Reconstruct payload failed validation.", parsed.error.flatten());
  }

  try {
    const actor = `${viewer.name} (${viewer.id})`;
    const store = getProjectStore();
    await store.reconstruct(viewer.tier, actor);
    if (parsed.data.withVerify) {
      await store.verify(viewer.tier, undefined, actor);
    }
    const state = await store.getViewerState(viewer.tier);
    return NextResponse.json({ ok: true, state: toPublicState(state) });
  } catch (error) {
    console.error("[reconstruct:post]", error);
    return jsonError(500, "RECONSTRUCT_FAILED", "Reconstruction failed.");
  }
}
