import { getProjectStore } from "@/lib/store/project-store";
import { buildHandoverMarkdown } from "@/lib/engine/handover-export";
import { jsonError } from "@/lib/api/helpers";
import { getViewer } from "@/lib/auth/get-viewer";
import { VIEWER_ROLES } from "@/lib/types";
import type { ViewerRole } from "@/lib/types";

/**
 * GET /api/handover/export
 * Returns the locked v1.0 snapshot as a Markdown packet (downloadable), rendered
 * strictly from the session viewer's filtered state — a T1 session can never
 * include T2/T3 sources, claims, quotes, handles, or audit lines.
 * 409 if the snapshot has not been locked yet.
 */
export async function GET(request: Request) {
  const viewer = await getViewer(request);
  if (!viewer) return jsonError(401, "UNAUTHORIZED", "Sign in as a demo user first.");

  try {
    const store = getProjectStore();
    const state = await store.getViewerState(viewer.tier);

    if (!state.handover.locked) {
      return jsonError(409, "SNAPSHOT_NOT_LOCKED", "Lock Snapshot v1.0 before exporting the handover packet.");
    }

    const role = (Object.keys(VIEWER_ROLES) as ViewerRole[]).find(
      (r) => VIEWER_ROLES[r].tier === viewer.tier
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
