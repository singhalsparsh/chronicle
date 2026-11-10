"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  GitMerge,
  Loader2,
  Mic,
  MicOff,
  Pencil,
  PencilLine,
  Plus,
  ShieldQuestion,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace-context";
import { CategoryBadge, CitationBadges, ClaimStatusBadge, TierBadge, fmtDate } from "@/components/shared";
import type { ConflictCandidate } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Conflict card                                                         */
/* ------------------------------------------------------------------ */

function SourceQuote({ label, side, quote, isWinner }: { label: string; side: string; quote: string; isWinner: boolean }) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        isWinner ? "border-verified/30 bg-verified/10" : "border-border bg-muted/30"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{side}</span>
        {isWinner && (
          <Badge variant="outline" className="h-5 border-verified/30 bg-verified/10 font-mono text-[11px] text-verified">
            accepted
          </Badge>
        )}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/90">“{quote}”</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function ConflictCard({ conflict }: { conflict: ConflictCandidate }) {
  const { state, resolveConflict } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualNote, setManualNote] = useState("");

  const sourceA = state?.sources.find((s) => s.id === conflict.sourceA.sourceId);
  const sourceB = state?.sources.find((s) => s.id === conflict.sourceB.sourceId);

  const choose = async (choice: "SOURCE_A" | "SOURCE_B" | "MANUAL_EDIT", note?: string) => {
    setBusy(true);
    try {
      await resolveConflict(conflict.id, choice, note);
      toast.success(`Conflict resolved: ${choice === "SOURCE_B" ? "Source B accepted" : choice === "SOURCE_A" ? "Source A kept" : "Manual edit saved"}`);
    } catch {
      toast.error("Could not resolve conflict.");
    } finally {
      setBusy(false);
      setManualOpen(false);
      setManualNote("");
    }
  };

  if (conflict.resolution !== "UNRESOLVED") {
    const label =
      conflict.resolution === "SOURCE_B"
        ? `${conflict.sourceB.sourceId} accepted`
        : conflict.resolution === "SOURCE_A"
          ? `${conflict.sourceA.sourceId} kept`
          : "Manual resolution";
    return (
      <Card className="opacity-80">
        <CardContent className="flex items-center justify-between gap-3 py-3.5">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-verified" />
            <span className="font-medium">{conflict.subject}</span>
            <span className="text-xs text-muted-foreground">· resolved · {label}</span>
          </div>
          <Badge variant="outline" className="h-5 font-mono text-[11px] text-verified border-verified/30 bg-verified/10">
            {fmtDate(conflict.resolvedAt ?? "")}
          </Badge>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-conflict/30">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <TriangleAlert className="size-4 text-conflict" />
            CONFLICT DETECTED
          </CardTitle>
          <span className="font-mono text-[11px] text-muted-foreground">{conflict.id}</span>
        </div>
        <CardDescription className="text-xs">Contradictory evidence for “{conflict.subject}”.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <SourceQuote
            label={`${sourceA?.type ?? ""} · ${sourceA?.title ?? conflict.sourceA.sourceId} · ${fmtDate(sourceA?.createdAt ?? "")}`}
            side={conflict.sourceA.sourceId}
            quote={conflict.sourceA.quote}
            isWinner={false}
          />
          <SourceQuote
            label={`${sourceB?.type ?? ""} · ${sourceB?.title ?? conflict.sourceB.sourceId} · ${fmtDate(sourceB?.createdAt ?? "")}`}
            side={conflict.sourceB.sourceId}
            quote={conflict.sourceB.quote}
            isWinner={false}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="h-9" onClick={() => choose("SOURCE_B", conflict.recommendation === "SOURCE_B" ? "newer source accepted" : undefined)} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            Accept Source B ({conflict.sourceB.sourceId})
          </Button>
          <Button size="sm" variant="outline" className="h-9" onClick={() => choose("SOURCE_A")} disabled={busy}>
            Keep Source A ({conflict.sourceA.sourceId})
          </Button>
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setManualOpen((v) => !v)} disabled={busy}>
            <PencilLine className="size-3.5" />
            Manual Edit
          </Button>
          {conflict.corroboratingB.length > 0 && (
            <span className="ml-auto text-[11px] text-muted-foreground">
              Corroborated by {conflict.corroboratingB.join(", ")}
            </span>
          )}
        </div>

        {manualOpen && (
          <div className="space-y-2">
            <Textarea
              rows={2}
              placeholder="Document the manual resolution note…"
              value={manualNote}
              onChange={(e) => setManualNote(e.target.value)}
            />
            <Button size="sm" variant="outline" className="h-9" onClick={() => choose("MANUAL_EDIT", manualNote)} disabled={busy || !manualNote.trim()}>
              <Plus className="size-3.5" />
              Save manual resolution
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Missing evidence / exit interview                                     */
/* ------------------------------------------------------------------ */

function getSpeechRecognitionCtor(): { new (): SpeechRecognition } | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

function GapCard({ gapId }: { gapId: string }) {
  const { state, submitInterview } = useWorkspace();
  const gap = state?.gaps.find((g) => g.id === gapId);
  const [answers, setAnswers] = useState<(string | null)[]>(Array(gap?.questions.length ?? 3).fill(null));
  const [busy, setBusy] = useState(false);
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  if (!gap) return null;

  const answered = answers.every((a) => Boolean(a && a.trim()));

  const setAnswer = (index: number, value: string) => {
    setAnswers((prev) => prev.map((a, i) => (i === index ? value : a)));
  };

  const toggleMicrophone = (index: number) => {
    const RecognitionCtor = getSpeechRecognitionCtor();
    if (!RecognitionCtor) {
      toast.error("Voice input not supported in this browser", {
        description: "Type your answer instead; transcription falls back to text.",
      });
      return;
    }

    if (recordingIndex === index) {
      recognitionRef.current?.stop();
      return;
    }

    recognitionRef.current?.abort();
    const recognition = new RecognitionCtor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) {
        setAnswer(index, answers[index] ? `${answers[index]} ${transcript}` : transcript);
      }
    };
    recognition.onerror = () => {
      setRecordingIndex(null);
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      setRecordingIndex(null);
      recognitionRef.current = null;
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setRecordingIndex(index);
    } catch {
      setRecordingIndex(null);
      recognitionRef.current = null;
      toast.error("Could not start voice input");
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      await submitInterview(gap.id, answers.map((a) => a ?? ""));
      toast.success("Exit interview complete", {
        description: `${gap.title} → HUMAN_APPROVED`,
      });
    } catch {
      toast.error("Could not submit interview.");
    } finally {
      setBusy(false);
    }
  };

  if (gap.status === "HUMAN_APPROVED") {
    const linkedClaims = state?.claims.filter((c) => c.gapId === gap.id).map((c) => c.id) ?? [];
    return (
      <Card>
        <CardContent className="py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-verified" />
              <span className="font-medium">{gap.title}</span>
            </div>
            <Badge variant="outline" className="h-5 border-verified/30 bg-verified/10 font-mono text-[11px] text-verified">
              HUMAN_APPROVED
            </Badge>
          </div>
          {linkedClaims.length > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Linked claim{linkedClaims.length > 1 ? "s" : ""}:{" "}
              <span className="font-mono">{linkedClaims.join(", ")}</span>
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {gap.answers.map((a, i) => (
              <span key={i} className="block">
                <span className="font-mono text-verified">Q{i + 1}</span> {a}
              </span>
            ))}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-missing/40">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldQuestion className="size-4 text-missing" />
            MISSING EVIDENCE
          </CardTitle>
          <Badge variant="outline" className="h-5 font-mono text-[11px] text-missing border-missing/30 bg-missing/10">
            exit micro-interview
          </Badge>
        </div>
        <CardDescription className="text-xs">{gap.title}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Sources: <span className="font-mono">{gap.sourceIds.join(", ")}</span>
        </p>
        {gap.questions.map((question, i) => (
          <div key={i} className="space-y-1.5">
            <label className="block text-xs font-medium">
              <span className="mr-1 font-mono text-muted-foreground">Q{i + 1}.</span>
              {question}
            </label>
            <div className="flex items-center gap-1.5">
              <Input
                className="flex-1"
                value={answers[i] ?? ""}
                onChange={(e) => setAnswer(i, e.target.value)}
                placeholder="Type answer…"
              />
              <Button
                type="button"
                size="icon"
                variant={recordingIndex === i ? "default" : "outline"}
                className="size-9 shrink-0"
                onClick={() => toggleMicrophone(i)}
                aria-label={recordingIndex === i ? "Stop voice input" : "Record answer by voice"}
                aria-pressed={recordingIndex === i}
              >
                {recordingIndex === i ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
              </Button>
            </div>
            {recordingIndex === i && (
              <p className="text-[11px] text-evidence">Listening… speak your answer aloud.</p>
            )}
            {gap.suggestedAnswers[i] && (
              <button
                type="button"
                onClick={() => setAnswer(i, gap.suggestedAnswers[i])}
                className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-evidence/50 hover:text-evidence"
              >
                <Pencil className="size-3" />
                Quick-fill: {gap.suggestedAnswers[i]}
              </button>
            )}
          </div>
        ))}
        <Button className="w-full" onClick={submit} disabled={busy || !answered}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          Submit interview → approve evidence
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Review editor                                                         */
/* ------------------------------------------------------------------ */

function ClaimEditorRow({ claimId }: { claimId: string }) {
  const { state, editClaim } = useWorkspace();
  const claim = state?.claims.find((c) => c.id === claimId);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(claim?.summary ?? "");
  const [busy, setBusy] = useState(false);

  if (!claim) return null;

  const save = async () => {
    setBusy(true);
    try {
      await editClaim(claim.id, value.trim());
      toast.success("Claim updated");
      setEditing(false);
    } catch {
      toast.error("Could not update claim.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[11px] text-muted-foreground">{claim.id}</span>
        <CategoryBadge category={claim.category} />
        <span className="text-xs text-muted-foreground">{claim.author} · {fmtDate(claim.timestamp)}</span>
        <span className="ml-auto">
          <ClaimStatusBadge status={claim.status} className="h-5 text-[11px]" superseded={claim.superseded} />
        </span>
      </div>
      <p className="mt-1.5 text-sm font-medium">{claim.title}</p>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-9" onClick={save} disabled={busy || value.trim().length < 5}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" className="h-9" onClick={() => { setEditing(false); setValue(claim.summary); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex items-start justify-between gap-3">
          <p className="text-[13px] leading-relaxed text-muted-foreground">{claim.summary}</p>
          <Button size="icon" variant="ghost" className="size-9 shrink-0" onClick={() => { setValue(claim.summary); setEditing(true); }} aria-label={`Edit ${claim.id}`}>
            <Pencil className="size-3.5" />
          </Button>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CitationBadges citations={claim.citations} />
        <TierBadge tier={claim.accessTier} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stage                                                                 */
/* ------------------------------------------------------------------ */

export function StageReview() {
  const { state } = useWorkspace();
  const conflicts = state?.conflicts ?? [];
  const gaps = state?.gaps ?? [];
  const claims = state?.claims ?? [];

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_440px]">
      {/* Left — review editor */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Review editor</CardTitle>
          <CardDescription>
            {claims.length} claims · edit summaries manually; edits count as human approval for
            missing-evidence claims.
          </CardDescription>
          <CardDescription className="text-[11px]">
            Status model: Evidence gathered → Verified (all quotes grounded) → Human approved;
            superseded claims are historical losers of resolved conflicts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[60vh] min-h-[420px] pr-3 xl:h-[600px]">
            <div className="space-y-2.5">
              {claims.map((claim) => (
                <ClaimEditorRow key={claim.id} claimId={claim.id} />
              ))}
              {claims.length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">No visible claims.</p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Right — conflicts + gaps */}
      <div className="space-y-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <GitMerge className="size-4 text-conflict" />
              Conflict resolver
            </h3>
            <Badge variant="outline" className="h-5 font-mono text-[11px] text-conflict border-conflict/30 bg-conflict/10">
              {conflicts.filter((c) => c.resolution === "UNRESOLVED").length} open
            </Badge>
          </div>
          {conflicts.map((conflict) => (
            <ConflictCard key={conflict.id} conflict={conflict} />
          ))}
          {conflicts.length === 0 && (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No contradictions in the visible evidence.
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldQuestion className="size-4 text-missing" />
              Missing evidence flags
            </h3>
            <Badge variant="outline" className="h-5 font-mono text-[11px] text-missing border-missing/30 bg-missing/10">
              {gaps.filter((g) => g.status === "MISSING_EVIDENCE").length} open
            </Badge>
          </div>
          {gaps.map((gap) => (
            <GapCard key={gap.id} gapId={gap.id} />
          ))}
          {gaps.length === 0 && (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No open gaps.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
