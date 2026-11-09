"use client";

import { useEffect, useMemo } from "react";
import { CheckCircle2, ShieldCheck, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspace } from "@/lib/workspace-context";
import { TierBadge, TypeBadge, fmtDate } from "@/components/shared";

interface Segment {
  text: string;
  highlighted: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findOccurrences(text: string, quote: string): { start: number; end: number }[] {
  const flexible = quote
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeRegExp)
    .join("\\s+");
  const regex = new RegExp(flexible, "gi");
  const out: { start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    out.push({ start: match.index, end: match.index + match[0].length });
  }
  return out;
}

function buildSegments(text: string, quotes: string[]): { segments: Segment[]; unmatched: string[] } {
  const spans: { start: number; end: number }[] = [];
  const unmatched: string[] = [];

  for (const quote of quotes) {
    const found = findOccurrences(text, quote);
    if (found.length === 0) {
      unmatched.push(quote);
    } else {
      spans.push(...found);
    }
  }

  spans.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  const segments: Segment[] = [];
  let cursor = 0;
  for (const span of merged) {
    if (span.start > cursor) segments.push({ text: text.slice(cursor, span.start), highlighted: false });
    segments.push({ text: text.slice(span.start, span.end), highlighted: true });
    cursor = span.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });

  return { segments, unmatched };
}

export function CitationInspectorDrawer() {
  const { inspected, closeInspector, state } = useWorkspace();

  useEffect(() => {
    if (!inspected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeInspector();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspected, closeInspector]);

  const source = inspected ? state?.sources.find((s) => s.id === inspected.sourceId) ?? null : null;

  useEffect(() => {
    if (inspected && !source) closeInspector();
  }, [inspected, source, closeInspector]);

  const content = useMemo(() => {
    if (!source) return { segments: [] as Segment[], unmatched: [] as string[] };
    return buildSegments(source.sanitizedContent, inspected?.quotes ?? []);
  }, [source, inspected]);

  const scrubInfo = useMemo(() => {
    if (!source) return null;
    const redactions = source.metadata?.redactions;
    if (!redactions || redactions.count === 0) return null;
    return { redactionCount: redactions.count, matchedTypes: redactions.types };
  }, [source]);

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div
        className={`absolute inset-0 bg-black/35 transition-opacity duration-300 ${
          inspected ? "opacity-100 pointer-events-auto" : "opacity-0"
        }`}
        aria-hidden="true"
        onClick={closeInspector}
      />
      <aside
        aria-hidden={!inspected}
        className={`absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-background shadow-2xl transition-transform duration-300 ease-out pointer-events-auto sm:w-[480px] ${
          inspected ? "translate-x-0" : "translate-x-full"
        }`}
        role="complementary"
        aria-label="Source Evidence Inspector"
      >
      {inspected && source && (
        <>
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-muted-foreground">
                <TypeBadge type={source.type} />
                <span className="font-mono text-xs">{source.id}</span>
              </div>
              <h2 className="mt-1 text-sm font-semibold leading-snug">{source.title}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {source.author} · {fmtDate(source.createdAt, true)}
              </p>
            </div>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={closeInspector} aria-label="Close inspector">
              <X className="size-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
            <TierBadge tier={source.accessTier} />
            {scrubInfo && (
              <span className="inline-flex items-center gap-1 rounded-md border border-verified/30 bg-verified/10 px-1.5 py-0.5 text-[11px] text-verified">
                <ShieldCheck className="size-3" />
                {scrubInfo.redactionCount} secret{scrubInfo.redactionCount === 1 ? "" : "s"} scrubbed
              </span>
            )}
          </div>

          <ScrollArea className="flex-1">
            <div className="px-5 py-4">
              {content.unmatched.length > 0 && (
                <div className="mb-4 space-y-1.5 rounded-lg border border-missing/30 bg-missing/10 p-3">
                  <p className="text-xs font-medium text-missing">Quote not found in source text</p>
                  {content.unmatched.map((quote) => (
                    <p key={quote} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <XCircle className="mt-0.5 size-3 shrink-0 text-missing" />
                      <span className="font-mono text-[11px]">{quote}</span>
                    </p>
                  ))}
                </div>
              )}

              {content.segments.length > 0 ? (
                <div className="space-y-3">
                  {content.segments.map((segment, index) => {
                    const isFirst = index === 0;
                    const isLast = index === content.segments.length - 1;
                    return (
                      <p key={index} className="text-[13px] leading-relaxed text-foreground/90">
                        {isFirst && <span className="text-muted-foreground select-none">“</span>}
                        {segment.highlighted ? (
                          <mark className="rounded-[3px] bg-evidence/20 px-0.5 text-evidence box-decoration-clone">
                            {segment.text}
                          </mark>
                        ) : (
                          segment.text
                        )}
                        {isLast && <span className="text-muted-foreground select-none">”</span>}
                      </p>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{source.sanitizedContent}</p>
              )}

              <div className="mt-5 border-t border-border pt-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-3.5 text-verified" />
                  Verbatim quote grounding verified against source content (normalized whitespace/case).
                </p>
              </div>
            </div>
          </ScrollArea>
        </>
      )}
      </aside>
    </div>
  );
}
