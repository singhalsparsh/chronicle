"use client";

/**
 * Chronicle — client workspace context.
 * Sources the signed-in viewer from GET /api/session (server-derived tier) and
 * drives every API interaction with `credentials: "include"`. No client-side
 * tier state exists: the viewer's tier is the single source of truth and is
 * never sent to the server as a header/body field.
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
import type { WorkspaceState } from "@/lib/types";
import type { Viewer } from "@/lib/auth/get-viewer";

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
  authLoading: boolean;
  viewer: Viewer | null;
  login: (userId: string) => Promise<void>;
  logout: () => Promise<void>;
  switchIdentity: (userId: string) => Promise<void>;
  stage: StageId;
  setStage: (stage: StageId) => void;
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
  const [authLoading, setAuthLoading] = useState(true);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [stage, setStage] = useState<StageId>(1);
  const [inspected, setInspected] = useState<InspectedSource | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/session", {
          cache: "no-store",
          credentials: "include",
        });
        const data = (await res.json()) as { user?: Viewer | null };
        if (active) setViewer(data.user ?? null);
      } catch {
        if (active) setViewer(null);
      } finally {
        if (active) setAuthLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const fetchState = useCallback(async (): Promise<WorkspaceState> => {
    const res = await fetch("/api/reconstruct", {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error("SESSION_REQUIRED");
      throw apiError(res.status);
    }
    const data = (await res.json()) as { state: WorkspaceState };
    return data.state;
  }, []);

  useEffect(() => {
    if (authLoading || !viewer) return;
    let active = true;
    fetchState()
      .then((next) => {
        if (active) setState(next);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof Error && error.message === "SESSION_REQUIRED") {
          setViewer(null);
          return;
        }
        toast.error("Could not load workspace state");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, viewer, fetchState]);

  const refresh = useCallback(async () => {
    const next = await fetchState();
    setState(next);
  }, [fetchState]);

  const applyResponse = useCallback(async (res: Response) => {
    if (!res.ok) throw apiError(res.status);
    const data = (await res.json()) as { state?: WorkspaceState };
    if (data.state) setState(data.state);
  }, []);

  const login = useCallback(async (userId: string) => {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
      credentials: "include",
    });
    if (!res.ok) throw apiError(res.status);
    const data = (await res.json()) as { user: Viewer };
    setViewer(data.user);
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/session/logout", {
      method: "POST",
      credentials: "include",
    });
    setViewer(null);
  }, []);

  const switchIdentity = useCallback(
    async (userId: string) => {
      if (userId === viewer?.id) return;
      await logout();
      await login(userId);
    },
    [logout, login, viewer]
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
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
    []
  );

  const reconstruct = useCallback(async () => {
    const res = await fetch("/api/reconstruct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ withVerify: false }),
      credentials: "include",
    });
    await applyResponse(res);
  }, [applyResponse]);

  const verify = useCallback(async () => {
    const res = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      credentials: "include",
    });
    await applyResponse(res);
  }, [applyResponse]);

  const resolveConflict = useCallback(
    async (conflictId: string, choice: "SOURCE_A" | "SOURCE_B" | "MANUAL_EDIT", note?: string) => {
      const res = await fetch("/api/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve_conflict", conflictId, choice, note }),
        credentials: "include",
      });
      await applyResponse(res);
    },
    [applyResponse]
  );

  const submitInterview = useCallback(
    async (gapId: string, answers: string[]) => {
      const res = await fetch("/api/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit_interview", gapId, answers }),
        credentials: "include",
      });
      await applyResponse(res);
    },
    [applyResponse]
  );

  const editClaim = useCallback(
    async (claimId: string, summary: string) => {
      const res = await fetch("/api/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit_claim", claimId, summary }),
        credentials: "include",
      });
      await applyResponse(res);
    },
    [applyResponse]
  );

  const lockSnapshot = useCallback(async () => {
    const res = await fetch("/api/handover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "lock_snapshot" }),
      credentials: "include",
    });
    await applyResponse(res);
  }, [applyResponse]);

  const acknowledgeReceipt = useCallback(async () => {
    const res = await fetch("/api/handover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "acknowledge_receipt" }),
      credentials: "include",
    });
    await applyResponse(res);
  }, [applyResponse]);

  const resetDemo = useCallback(async () => {
    const res = await fetch("/api/handover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset_demo" }),
      credentials: "include",
    });
    await applyResponse(res);
    setStage(1);
  }, [applyResponse]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state,
      loading,
      authLoading,
      viewer,
      login,
      logout,
      switchIdentity,
      stage,
      setStage,
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
    [state, loading, authLoading, viewer, login, logout, switchIdentity, stage, inspected, refresh, ingest, reconstruct, verify, resolveConflict, submitInterview, editClaim, lockSnapshot, acknowledgeReceipt, resetDemo]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
