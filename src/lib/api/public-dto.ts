/**
 * Chronicle — Central outbound response mapper (E-1a).
 *
 * The stored artifact keeps an internal `rawContent` (scrubbed on write) for
 * server-side citation verification. No outbound payload may ever serialize
 * `rawContent`: every route that returns artifacts passes through here so a
 * route cannot forget to strip it.
 */
import type { SourceArtifact, WorkspaceState } from "@/lib/types";

export type PublicSource = Omit<SourceArtifact, "rawContent">;

export function toPublicSource(source: SourceArtifact): PublicSource {
  return {
    id: source.id,
    type: source.type,
    title: source.title,
    author: source.author,
    createdAt: source.createdAt,
    accessTier: source.accessTier,
    sanitizedContent: source.sanitizedContent,
    metadata: source.metadata,
  };
}

export type PublicState = Omit<WorkspaceState, "sources"> & { sources: PublicSource[] };

export function toPublicState(state: WorkspaceState): PublicState {
  return { ...state, sources: state.sources.map(toPublicSource) };
}
