import { getProjectStore } from "@/lib/store/project-store";
import { buildHandoverMarkdown } from "@/lib/engine/handover-export";
import { jsonError, viewerTierFromRequest } from "@/lib/api/helpers";
import { VIEWER_ROLES } from "@/lib/types";
import type { ViewerRole } from "@/lib/types";

/**
 * GET /api/handover/export
 * Returns the locked v1.0 snapshot as a Markdown packet (downloadable).
 * 409 if the snapshot has not been locked yet.
 */
export async function GET(request: Request) {
  try {
    const tier = viewerTierFromRequest(request);
    const store = getProjectStore();
    const state = await store.getViewerState(tier);

    if (!state.handover.locked) {
      return jsonError(409, "SNAPSHOT_NOT_LOCKED", "Lock Snapshot v1.0 before exporting the handover packet.");
    }

    const role = (Object.keys(VIEWER_ROLES) as ViewerRole[]).find(
      (r) => VIEWER_ROLES[r].tier === tier
    );
    const viewerLabel = role ? VIEWER_ROLES[role].label : "Maintainer / Admin";

    const markdown = buildHandoverMarkdown(state, viewerLabel);
    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="chronicle-handover-${state.handover.version}.md"`,
      },
    });
  } catch (error) {
    console.error("[handover:export]", error);
    return jsonError(500, "EXPORT_FAILED", "Could not generate the handover packet.");
  }
}
