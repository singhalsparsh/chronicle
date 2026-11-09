import { NextResponse } from "next/server";
import { IngestRequestSchema } from "@/lib/schemas/handover-zod";
import { getProjectStore } from "@/lib/store/project-store";
import { isErrorResponse, jsonError, parseJsonBody } from "@/lib/api/helpers";
import { toPublicSource, toPublicState } from "@/lib/api/public-dto";
import { enrichGithubPr, isGithubPrUrl } from "@/lib/engine/github-ingest";
import { getViewer } from "@/lib/auth/get-viewer";

/**
 * POST /api/ingest
 * 1. If the input is a GitHub PR URL, fetch the real PR title/body from the
 *    GitHub public API (graceful fallback to local text on failure).
 * 2. Scrubs secrets (regex), validates via Zod, stores the source artifact.
 */
export async function POST(request: Request) {
  const viewer = await getViewer(request);
  if (!viewer) return jsonError(401, "UNAUTHORIZED", "Sign in as a demo user first.");

  const body = await parseJsonBody<{
    title?: unknown;
    sourceType?: unknown;
    author?: unknown;
    rawText?: unknown;
    accessTier?: unknown;
    url?: unknown;
  }>(request);
  if (isErrorResponse(body)) return body;

  let github = { fetched: false as boolean, reason: "not-a-github-pr-url" as string | undefined };

  if (
    body.sourceType === "GITHUB_PR" &&
    typeof body.url === "string" &&
    body.url.trim() &&
    isGithubPrUrl(body.url)
  ) {
    const enrichment = await enrichGithubPr(body.url);
    github = { fetched: enrichment.fetched, reason: enrichment.reason };

    if (enrichment.fetched) {
      const suppliedText = typeof body.rawText === "string" ? body.rawText.trim() : "";
      if (enrichment.body) {
        body.rawText = [enrichment.body, suppliedText].filter(Boolean).join("\n\n");
      }
      const suppliedTitle = typeof body.title === "string" ? body.title.trim() : "";
      if (!suppliedTitle && enrichment.title) body.title = enrichment.title;
      if (body.author === "@guest_judge" && enrichment.author) body.author = enrichment.author;
    }
  }

  const parsed = IngestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_FAILED", "Ingest payload failed validation.", parsed.error.flatten());
  }

  try {
    const store = getProjectStore();
    const input = parsed.data;
    const { source, scrub, factsExtracted } = await store.ingestSource(
      {
        title: input.title,
        sourceType: input.sourceType,
        author: input.author,
        rawText: input.rawText,
        accessTier: input.accessTier,
        url: input.url,
      },
      `${viewer.name} (${viewer.id})`
    );

    const state = await store.getViewerState(viewer.tier);
    return NextResponse.json({
      ok: true,
      source: toPublicSource(source),
      scrub,
      factsExtracted,
      github,
      state: toPublicState(state),
    });
  } catch (error) {
    console.error("[ingest]", error);
    return jsonError(500, "INGEST_FAILED", "Could not store the source artifact.");
  }
}
