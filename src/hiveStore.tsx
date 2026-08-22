import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  HiveLiveness,
  HiveServerLedgerEntry,
  HiveSession,
  HiveSessionPatch,
} from "../shared/types";

type HiveStoreValue = {
  sessions: HiveSession[];
  ledger: HiveServerLedgerEntry[];
  patchSessions: (patches: HiveSessionPatch[]) => void;
  setSessions: (next: HiveSession[]) => void;
  setLedger: (next: HiveServerLedgerEntry[]) => void;
};

const HiveStoreContext = createContext<HiveStoreValue | null>(null);

function applySessionPatches(current: HiveSession[], patches: HiveSessionPatch[]): HiveSession[] {
  if (patches.length === 0) {
    return current;
  }
  const map = new Map(current.map((s) => [s.userId, s]));
  for (const patch of patches) {
    const existing = map.get(patch.userId);
    if (existing) {
      map.set(patch.userId, { ...existing, ...patch.fields, liveness: patch.fields.liveness ?? existing.liveness });
    } else if (patch.fields.liveness) {
      map.set(patch.userId, {
        userId: patch.userId,
        liveness: patch.fields.liveness,
        connected: patch.fields.liveness !== "offline",
        alive: patch.fields.liveness !== "offline",
        lastHeartbeatAt: null,
        path: "",
        jobId: patch.fields.jobId,
        placeId: patch.fields.placeId,
        serverVerdict: patch.fields.serverVerdict,
        threatLevel: patch.fields.threatLevel,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.userId - b.userId);
}

export function HiveStoreProvider(props: { children: ReactNode; enabled?: boolean }) {
  const [sessions, setSessionsState] = useState<HiveSession[]>([]);
  const [ledger, setLedgerState] = useState<HiveServerLedgerEntry[]>([]);

  const patchSessions = useCallback((patches: HiveSessionPatch[]) => {
    setSessionsState((cur) => applySessionPatches(cur, patches));
  }, []);

  const setSessions = useCallback((next: HiveSession[]) => {
    setSessionsState(next);
  }, []);

  const setLedger = useCallback((next: HiveServerLedgerEntry[]) => {
    setLedgerState(next);
  }, []);

  useEffect(() => {
    if (props.enabled === false) {
      return;
    }
    void window.ram.hiveStatus().then(setSessionsState);
    void window.ram.hiveLedger().then(setLedgerState);
    const offH = window.ram.onHiveChanged(setSessionsState);
    const offL = window.ram.onHiveLedgerChanged(setLedgerState);
    const offP = window.ram.onHiveSessionPatch(patchSessions);
    return () => {
      offH();
      offL();
      offP();
    };
  }, [props.enabled, patchSessions]);

  const value = useMemo(
    () => ({ sessions, ledger, patchSessions, setSessions, setLedger }),
    [sessions, ledger, patchSessions, setSessions, setLedger],
  );

  return <HiveStoreContext.Provider value={value}>{props.children}</HiveStoreContext.Provider>;
}

export function useHiveStore(): HiveStoreValue {
  const ctx = useContext(HiveStoreContext);
  if (!ctx) {
    throw new Error("useHiveStore requires HiveStoreProvider");
  }
  return ctx;
}

export function useHiveLivenessMap(): Map<number, HiveLiveness> {
  const { sessions } = useHiveStore();
  return useMemo(() => new Map(sessions.map((s) => [s.userId, s.liveness])), [sessions]);
}

export function patchAccountsHiveStatus<T extends { userId: number; hiveStatus: HiveLiveness }>(
  accounts: T[],
  deltas: { userId: number; hiveStatus: HiveLiveness }[],
): T[] {
  if (deltas.length === 0) {
    return accounts;
  }
  const map = new Map(deltas.map((d) => [d.userId, d.hiveStatus]));
  let changed = false;
  const next = accounts.map((a) => {
    const status = map.get(a.userId);
    if (status && status !== a.hiveStatus) {
      changed = true;
      return { ...a, hiveStatus: status };
    }
    return a;
  });
  return changed ? next : accounts;
}
