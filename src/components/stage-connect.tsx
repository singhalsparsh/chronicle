"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Loader2, Paperclip, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace-context";
import { SourceTypeIcon, TierBadge, fmtDate } from "@/components/shared";
import type { SourceType } from "@/lib/types";

const TYPE_FILTERS: { value: SourceType | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "GITHUB_PR", label: "PRs" },
  { value: "SLACK_THREAD", label: "Slack" },
  { value: "JIRA_TICKET", label: "Jira" },
  { value: "NOTION_DOC", label: "Notion" },
];

function SourceRow({ sourceId, onOpen }: { sourceId: string; onOpen: (id: string) => void }) {
  const { state } = useWorkspace();
  const source = state?.sources.find((s) => s.id === sourceId);
  const redactions = useMemo(() => {
    if (!source) return 0;
    return source.metadata?.redactions?.count ?? 0;
  }, [source]);

  if (!source) return null;

  return (
    <button
      type="button"
      onClick={() => onOpen(source.id)}
      className="group w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-evidence/40 hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SourceTypeIcon type={source.type} className="size-3.5 text-muted-foreground" />
            <span className="font-mono text-[11px] text-muted-foreground">{source.id}</span>
            {redactions > 0 && (
              <Badge variant="outline" className="h-5 border-verified/30 bg-verified/10 px-1.5 font-mono text-[11px] text-verified">
                <ShieldCheck className="size-2.5 mr-0.5" />
                {redactions}
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-sm font-medium">{source.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {source.author} · {fmtDate(source.createdAt)}
          </p>
        </div>
        <TierBadge tier={source.accessTier} />
      </div>
    </button>
  );
}

export function StageConnect() {
  const { state, ingest, openInspector, loading, viewer } = useWorkspace();

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<SourceType | "ALL">("ALL");

  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("GITHUB_PR");
  const [author, setAuthor] = useState("@guest_judge");
  const [clearance, setClearance] = useState<1 | 2 | 3>(viewer?.tier ?? 2);
  const [url, setUrl] = useState("");
  const [rawText, setRawText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sourceId: string; redactionCount: number; matchedTypes: string[] } | null>(null);
  const [localScrub, setLocalScrub] = useState<{ redactionCount: number; matchedTypes: string[] } | null>(null);

  const sources = useMemo(() => state?.sources ?? [], [state]);

  const filtered = useMemo(() => {
    return sources.filter((s) => {
      const matchesType = typeFilter === "ALL" || s.type === typeFilter;
      const q = query.trim().toLowerCase();
      const matchesQuery =
        !q ||
        s.id.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        s.author.toLowerCase().includes(q) ||
        s.sanitizedContent.toLowerCase().includes(q);
      return matchesType && matchesQuery;
    });
  }, [sources, query, typeFilter]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { GITHUB_PR: 0, SLACK_THREAD: 0, JIRA_TICKET: 0, NOTION_DOC: 0 };
    for (const s of sources) counts[s.type] += 1;
    return counts;
  }, [sources]);

  const onSubmit = async () => {
    setError(null);
    setResult(null);
    if (title.trim().length < 3) {
      setError("Title must be at least 3 characters.");
      return;
    }
    if (rawText.trim().length < 10) {
      setError("Source content must be at least 10 characters.");
      return;
    }
    setBusy(true);
    try {
      const outcome = await ingest({
        title: title.trim(),
        sourceType,
        author: author.trim().startsWith("@") ? author.trim() : `@${author.trim()}`,
        rawText,
        url: url.trim() || undefined,
        accessTier: clearance,
      });
      setResult(outcome);
      setLocalScrub(null);
      setRawText("");
      setTitle("");
      setUrl("");
      if (outcome.factsExtracted === 0) {
        toast.warning("Source stored, but no project facts were extracted.", {
          description: "The source appears in the explorer; reconstruct may still surface work from other evidence.",
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ingestion failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
      {/* Left — explorer */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
          <div>
            <CardTitle>Source Explorer</CardTitle>
            <CardDescription>
              {sources.length} artifacts from 4 platforms · {filtered.length} shown
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {TYPE_FILTERS.filter((t) => t.value !== "ALL").map((t) => (
              <span key={t.value} className="rounded-md bg-muted px-1.5 py-0.5 font-mono">
                {typeCounts[t.value]} {t.label}
              </span>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search sources by id, title, author, content…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border p-1 bg-muted/30">
              {TYPE_FILTERS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTypeFilter(t.value)}
                  className={`h-9 rounded-md px-3 text-xs font-medium transition-colors ${
                    typeFilter === t.value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="mt-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/60" />
              ))}
            </div>
          ) : (
            <ScrollArea className="mt-4 h-[50vh] min-h-[360px] pr-3 lg:h-[520px]">
              <div className="space-y-2">
                {filtered.map((s) => (
                  <SourceRow key={s.id} sourceId={s.id} onOpen={openInspector} />
                ))}
                {filtered.length === 0 && (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No sources match this filter.
                  </p>
                )}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Right — ingest */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Paperclip className="size-4 text-evidence" />
            Ingest custom source
          </CardTitle>
          <CardDescription>
            Paste a GitHub PR, Slack thread, Jira ticket or Notion doc. Secrets are scrubbed by
            regex before storage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col space-y-4">
            {/* Title — full row */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="src-title" className="text-xs text-muted-foreground">Title</Label>
              <Input
                id="src-title"
                className="w-full"
                placeholder="e.g. fix: retry policy"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Type — full row */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="src-type" className="text-xs text-muted-foreground">Type</Label>
              <Select value={sourceType} onValueChange={(v) => setSourceType(v as SourceType)}>
                <SelectTrigger id="src-type" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GITHUB_PR">GitHub PR</SelectItem>
                  <SelectItem value="SLACK_THREAD">Slack thread</SelectItem>
                  <SelectItem value="JIRA_TICKET">Jira ticket</SelectItem>
                  <SelectItem value="NOTION_DOC">Notion doc</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Author + URL */}
            <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="src-author" className="text-xs text-muted-foreground">Author</Label>
                <Input
                  id="src-author"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="src-url" className="text-xs text-muted-foreground">URL (optional)</Label>
                <Input
                  id="src-url"
                  placeholder="https://…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
            </div>

            {/* Clearance */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="src-clearance" className="text-xs text-muted-foreground">
                Clearance level
              </Label>
              <Select value={String(clearance)} onValueChange={(v) => setClearance(Number(v) as 1 | 2 | 3)}>
                <SelectTrigger id="src-clearance" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">T1 · Restricted</SelectItem>
                  <SelectItem value="2">T2 · Internal</SelectItem>
                  <SelectItem value="3">T3 · Confidential</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Raw content */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="src-content" className="text-xs text-muted-foreground">Raw content</Label>
              <Textarea
                id="src-content"
                rows={9}
                className="font-mono text-xs leading-relaxed"
                placeholder="Paste raw source text here…"
                value={rawText}
                onChange={(e) => {
                  setRawText(e.target.value);
                  setLocalScrub(null);
                }}
              />
              {localScrub && (
                <p className="text-xs text-muted-foreground">
                  Live scrub preview:{" "}
                  <span className="font-mono text-verified">{localScrub.redactionCount} secret(s)</span>
                  {" · "}
                  {localScrub.matchedTypes.length > 0 ? localScrub.matchedTypes.join(", ") : "no matches"}
                </p>
              )}
            </div>

            {error && (
              <Alert variant="destructive" className="py-2.5">
                <AlertCircle className="size-4" />
                <AlertTitle className="text-xs">Could not ingest</AlertTitle>
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}

            <Button className="mt-6 w-full" onClick={onSubmit} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              Scrub & ingest
            </Button>

            {result && (
              <div className="rounded-lg border border-verified/30 bg-verified/10 p-3 text-xs">
                <p className="font-medium text-verified">Ingested {result.sourceId}</p>
                <p className="mt-1 text-muted-foreground">
                  {result.redactionCount} secret(s) redacted log {result.matchedTypes.length > 0
                    ? `— ${result.matchedTypes.join(", ")}`
                    : ""}
                </p>
                <p className="mt-1.5 break-words font-mono text-[11px] text-foreground/80">
                  {rawText ? "" : "Sanitized copy is stored; the source now appears in the explorer."}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
