"use client";

/**
 * Chronicle — client workspace context.
 * Holds stage progress, viewer role (shadow preview), workspace state and every
 * interaction handler that talks to the API routes.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type { AccessTier, ViewerRole, WorkspaceState } from "@/lib/types";
import { VIEWER_ROLES } from "@/lib/types";

export interface InspectedSource {
  sourceId: string;
  quotes: string[];
}

export type StageId = 1 | 2 | 3 | 4 | 5;

export interface StageMeta {
  id: StageId;
  label: string;
  short: string;
}

export const STAGES: StageMeta[] = [
  { id: 1, label: "Connect", short: "Sources" },
  { id: 2, label: "Reconstruct", short: "State" },
  { id: 3, label: "Verify", short: "Quotes" },
  { id: 4, label: "Review", short: "Conflicts" },
  { id: 5, label: "Handover", short: "Sign-off" },
];

interface WorkspaceContextValue {
  state: WorkspaceState | null;
  loading: boolean;
  stage: StageId;
  setStage: (stage: StageId) => void;
  role: ViewerRole;
  setRole: (role: ViewerRole) => void;
  tier: AccessTier;
  inspected: InspectedSource | null;
  openInspector: (sourceId: string, quotes?: string[]) => void;
  closeInspector: () => void;
  refresh: () => Promise<void>;
  ingest: (payload: {
    title: string;
    sourceType: "GITHUB_PR" | "SLACK_THREAD" | "JIRA_TICKET" | "NOTION_DOC";
    author: string;
    rawText: string;
    url?: string;
  }) => Promise<{ redactionCount: number; matchedTypes: string[]; sourceId: string }>;
  reconstruct: () => Promise<void>;
  verify: () => Promise<void>;
  resolveConflict: (conflictId: string, choice: "SOURCE_A" | "SOURCE_B" | "MANUAL_EDIT", note?: string) => Promise<void>;
  submitInterview: (gapId: string, answers: string[]) => Promise<void>;
  editClaim: (claimId: string, summary: string) => Promise<void>;
  lockSnapshot: () => Promise<void>;
  acknowledgeReceipt: () => Promise<void>;
  resetDemo: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function apiError(status: number): Error {
  return new Error(status === 409 ? "Action rejected by the workspace state." : "Request failed (status " + status + ").");
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<StageId>(1);
  const [role, setRoleState] = useState<ViewerRole>("t3-maintainer");
  const [inspected, setInspected] = useState<InspectedSource | null>(null);

  const tier = VIEWER_ROLES[role].tier;

  const fetchState = useCallback(
    async (tierValue: AccessTier): Promise<WorkspaceState> => {
      const res = await fetch("/api/reconstruct", {
        headers: { "x-viewer-tier": String(tierValue) },
        cache: "no-store",
      });
      if (!res.ok) throw apiError(res.status);
      const data = (await res.json()) as { state: WorkspaceState };
      return data.state;
    },
    []
  );

  useEffect(() => {
    let active = true;
    fetchState(tier)
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => {
        if (active) toast.error("Could not load workspace state");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchState, tier]);

  const refresh = useCallback(async () => {
    const next = await fetchState(tier);
    setState(next);
  }, [fetchState, tier]);

  const applyResponse = useCallback(async (res: Response) => {
    if (!res.ok) throw apiError(res.status);
    const data = (await res.json()) as { state?: WorkspaceState };
    if (data.state) setState(data.state);
  }, []);

  const setRole = useCallback(
    (nextRole: ViewerRole) => {
      if (nextRole === role) return;
      setRoleState(nextRole);
      window.setTimeout(() => {
        toast.success(`Role preview → ${VIEWER_ROLES[nextRole].label}`, {
          description: "Restricted sources and claims are filtered in real time.",
        });
      }, 0);
    },
    [role]
  );

  const ingest = useCallback(
    async (payload: {
      title: string;
      sourceType: "GITHUB_PR" | "SLACK_THREAD" | "JIRA_TICKET" | "NOTION_DOC";
      author: string;
      rawText: string;
      url?: string;
    }) => {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-viewer-tier": String(tier) },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? "Ingestion failed.");
      }
      const data = (await res.json()) as {
        source: { id: string };
        scrub: { redactionCount: number; matchedTypes: string[] };
        state: WorkspaceState;
      };
      setState(data.state);
      return { redactionCount: data.scrub.redactionCount, matchedTypes: data.scrub.matchedTypes, sourceId: data.source.id };
    },
    [tier]
  );

  const reconstruct = useCallback(async () => {
    const res = await fetch("/api/reconstruct", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-viewer-tier": String(tier) },
      body: JSON.stringify({ withVerify: false }),
    });
    await applyResponse(res);
  }, [applyResponse, tier]);

  const verify = useCallback(async () => {
    const res = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-viewer-tier": String(tier) },
      body: JSON.stringify({}),
    });
    await applyResponse(res);
  }, [applyResponse, tier]);

  const resolveConflict = useCallback(
    async (conflictId: string, choice: "SOURCE_A" | "SOURCE_B" | "MANUAL_EDIT", note?: string) => {
      const res = await fetch("/api/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-viewer-tier": String(tier) },
        body: JSON.stringify({ action: "resolve_conflict", conflictId, choice, note }),
      });
      await applyResponse(res);
    },
    [applyResponse, tier]
  );

  const submitInterview = useCallback(
    async (gapId: string, answers: string[]) => {
      const res = await fetch("/api/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-viewer-tier": String(tier) },
        body: JSON.stringify({ action: "submit_interview", gapId, answers }),
      });
      await applyResponse(res);
    },
    [applyResponse, tier]
  );

  const editClaim = useCallback(
    async (claimId: string, summary: string) => {
      const res = await fetch("/api/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-viewer-tier": String(tier) },
        body: JSON.stringify({ action: "edit_claim", claimId, summary }),
      });
      await applyResponse(res);
    },
    [applyResponse, tier]
  );

  const lockSnapshot = useCallback(async () => {
    const res = await fetch("/api/handover", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-viewer-tier": String(tier) },
      body: JSON.stringify({ action: "lock_snapshot" }),
    });
    await applyResponse(res);
  }, [applyResponse, tier]);

  const acknowledgeReceipt = useCallback(async () => {
    const res = await fetch("/api/handover", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-viewer-tier": String(tier) },
      body: JSON.stringify({ action: "acknowledge_receipt" }),
    });
    await applyResponse(res);
  }, [applyResponse, tier]);

  const resetDemo = useCallback(async () => {
    const res = await fetch("/api/handover", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-viewer-tier": String(tier) },
      body: JSON.stringify({ action: "reset_demo" }),
    });
    await applyResponse(res);
    setStage(1);
  }, [applyResponse, tier]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state,
      loading,
      stage,
      setStage,
      role,
      setRole,
      tier,
      inspected,
      openInspector: (sourceId, quotes) => setInspected({ sourceId, quotes: quotes ?? [] }),
      closeInspector: () => setInspected(null),
      refresh,
      ingest,
      reconstruct,
      verify,
      resolveConflict,
      submitInterview,
      editClaim,
      lockSnapshot,
      acknowledgeReceipt,
      resetDemo,
    }),
    [state, loading, stage, role, setRole, tier, inspected, refresh, ingest, reconstruct, verify, resolveConflict, submitInterview, editClaim, lockSnapshot, acknowledgeReceipt, resetDemo]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
