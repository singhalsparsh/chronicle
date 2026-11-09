"use client";

import { useState } from "react";
import { Archive, Check, Moon, RotateCcw, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STAGES, useWorkspace } from "@/lib/workspace-context";
import { DEMO_USERS } from "@/lib/auth/demo-users";
import type { DemoUserId } from "@/lib/auth/demo-users";

const SESSION_OPTIONS: { id: DemoUserId; tag: string; label: string }[] = (
  Object.keys(DEMO_USERS) as DemoUserId[]
).map((id) => ({
  id,
  tag: `T${DEMO_USERS[id].tier}`,
  label: DEMO_USERS[id].role,
}));

const TRIGGER_BASE =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

function ThemeToggle() {
  const [dark, setDark] = useState(true);

  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("chronicle-theme", next ? "dark" : "light");
    } catch {
      // ignore
    }
    setDark(next);
  };

  return (
    <Tooltip>
      <TooltipTrigger
        className={`grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${TRIGGER_BASE}`}
        onClick={toggle}
        aria-label="Toggle theme"
      >
        {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </TooltipTrigger>
      <TooltipContent>{dark ? "Switch to light" : "Switch to dark"}</TooltipContent>
    </Tooltip>
  );
}

function SessionSwitcher() {
  const { viewer, switchIdentity, state } = useWorkspace();
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
      {SESSION_OPTIONS.map((opt) => {
        const active = viewer?.id === opt.id;
        return (
          <Tooltip key={opt.id}>
            <TooltipTrigger
              className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${TRIGGER_BASE} ${
                active
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
              onClick={() => switchIdentity(opt.id)}
              aria-pressed={active}
            >
              <span className="font-mono text-[11px] opacity-70">{opt.tag}</span>
              <span className="hidden lg:inline">{opt.label}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Switch session to {DEMO_USERS[opt.id].name} — {DEMO_USERS[opt.id].role} ({opt.tag})
            </TooltipContent>
          </Tooltip>
        );
      })}
      {viewer && (
        <span className="ml-1 hidden text-[11px] text-muted-foreground xl:inline">
          {viewer.name} · {viewer.role}
        </span>
      )}
      {state && state.stats.withheldSources + state.stats.withheldClaims > 0 && (
        <Badge variant="outline" className="ml-1 h-6 font-mono text-[11px] text-missing border-missing/30 bg-missing/10">
          {state.stats.withheldSources}+{state.stats.withheldClaims} hidden
        </Badge>
      )}
    </div>
  );
}

export function TopNavStepper() {
  const { state, stage, setStage, resetDemo, viewer } = useWorkspace();
  const isMaintainer = viewer?.tier === 3;
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 lg:px-6">
        {/* Brand */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="grid size-8 shrink-0 place-items-center rounded-md border border-evidence/40 bg-evidence/10 text-evidence">
            <Archive className="size-4" />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-semibold tracking-tight">Chronicle</p>
            <p className="truncate text-xs text-muted-foreground">
              Core-Payments-Service · handover of @alex_dev
            </p>
          </div>
        </div>

        {/* Persistence mode */}
        {state && (
          <Tooltip>
            <TooltipTrigger className={TRIGGER_BASE}>
              <Badge
                variant="outline"
                className={`hidden h-5 font-mono text-[11px] sm:inline-flex ${
                  state.mode === "supabase"
                    ? "border-verified/30 bg-verified/10 text-verified"
                    : state.persistenceError
                      ? "border-conflict/30 bg-conflict/10 text-conflict"
                      : "text-muted-foreground"
                }`}
              >
                {state.mode === "supabase" ? "db · supabase" : "db · memory"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              {state.mode === "supabase" ? (
                "State persists to Supabase (chronicle_state); it survives refresh & cold starts."
              ) : state.persistenceError ? (
                <>
                  Supabase connection failed; running in memory.
                  <span className="mt-1 block font-mono text-[11px] text-background/80">{state.persistenceError}</span>
                </>
              ) : (
                "In-memory demo store; create .env.local and restart the server to enable Supabase persistence."
              )}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Stepper */}
        <nav className="hidden md:flex flex-1 items-center justify-center" aria-label="Workflow stages">
          <ol className="flex items-center gap-1">
            {STAGES.map((step, index) => {
              const active = stage === step.id;
              const done = stage > step.id;
              return (
                <li key={step.id} className="flex items-center">
                  {index > 0 && (
                    <span className={`mx-1.5 h-px w-4 ${done ? "bg-evidence/60" : "bg-border"}`} />
                  )}
                  <button
                    type="button"
                    onClick={() => setStage(step.id)}
                    aria-current={active ? "step" : undefined}
                    className={`group inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${TRIGGER_BASE} ${
                      active
                        ? "bg-evidence/10 text-evidence"
                        : done
                          ? "text-foreground/80 hover:bg-accent"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <span
                      className={`grid size-4.5 place-items-center rounded-full text-[11px] font-mono ${
                        done || active
                          ? "bg-evidence text-evidence-foreground"
                          : "border border-border text-muted-foreground"
                      }`}
                    >
                      {done ? <Check className="size-3" /> : String(step.id).padStart(2, "0")}
                    </span>
                    {step.label}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Mobile stepper (compact, touch-sized) */}
        <nav className="order-last relative mt-1 flex w-full items-center md:hidden" aria-label="Workflow stages (compact)">
          <div className="absolute left-5 right-5 top-1/2 h-px -translate-y-1/2 bg-border" aria-hidden="true" />
          <ol className="relative flex w-full items-center justify-between">
            {STAGES.map((step) => {
              const active = stage === step.id;
              const done = stage > step.id;
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => setStage(step.id)}
                    aria-label={step.label}
                    aria-current={active ? "step" : undefined}
                    className={`grid size-9 place-items-center rounded-full border text-[11px] font-mono transition-colors ${TRIGGER_BASE} ${
                      active || done
                        ? "border-evidence/50 bg-evidence/15 text-evidence"
                        : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    {done ? <Check className="size-3.5" /> : step.id}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-1.5 md:flex-1 md:justify-end">
          <SessionSwitcher />
          <ThemeToggle />
          <Tooltip>
            <TooltipTrigger
              className={`grid size-9 place-items-center rounded-md transition-colors ${TRIGGER_BASE} ${
                isMaintainer
                  ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                  : "cursor-not-allowed text-muted-foreground/40"
              }`}
              onClick={() => {
                if (isMaintainer) setConfirmReset(true);
              }}
              aria-label={isMaintainer ? "Reset demo" : "Reset demo (Maintainers only)"}
              aria-disabled={!isMaintainer}
            >
              <RotateCcw className="size-4" />
            </TooltipTrigger>
            <TooltipContent>
              {isMaintainer ? "Reset demo workspace" : "Only Maintainers can reset the demo."}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset demo workspace?</DialogTitle>
            <DialogDescription>
              Restores the original 28-artifact synthetic dataset and wipes all resolutions,
              interviews, approvals and audit entries.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setConfirmReset(false);
                await resetDemo();
              }}
            >
              Reset workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
