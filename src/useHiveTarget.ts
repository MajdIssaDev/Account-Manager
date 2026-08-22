import { useCallback, useMemo, useState } from "react";
import type { AccountPublic, HiveSendManyResult } from "../shared/types";

export type HiveFanoutBatch = {
  dropped: number;
  results: HiveSendManyResult[];
};

export function useHiveTarget(accounts: AccountPublic[], selectedIds: string[]) {
  const [busy, setBusy] = useState(false);
  const [lastBatch, setLastBatch] = useState<HiveFanoutBatch | null>(null);

  const selected = useMemo(
    () => accounts.filter((a) => selectedIds.includes(a.id)),
    [accounts, selectedIds],
  );

  const connectedKey = useMemo(
    () =>
      selected
        .filter((a) => a.hiveStatus === "connected")
        .map((a) => a.id)
        .sort()
        .join(","),
    [selected],
  );

  const connected = useMemo(
    () => selected.filter((a) => a.hiveStatus === "connected"),
    [connectedKey, selected],
  );

  const connectedIds = useMemo(() => connected.map((a) => a.id), [connectedKey, connected]);

  const droppedCount = useMemo(
    () => selected.filter((a) => a.hiveStatus !== "connected").length,
    [connectedKey, selected],
  );

  const sendMany = useCallback(
    async (
      op: string,
      payload: Record<string, unknown> = {},
      timeoutMs = 25000,
    ): Promise<HiveFanoutBatch | null> => {
      if (connectedIds.length === 0) {
        return null;
      }
      setBusy(true);
      try {
        const res = await window.ram.hiveSendMany({
          accountIds: connectedIds,
          op,
          payload,
          timeoutMs,
        });
        if (!res.ok || !res.data) {
          setLastBatch({ dropped: droppedCount, results: [] });
          return null;
        }
        const batch: HiveFanoutBatch = {
          dropped: res.data.dropped + droppedCount,
          results: res.data.results,
        };
        setLastBatch(batch);
        return batch;
      } finally {
        setBusy(false);
      }
    },
    [connectedIds, droppedCount],
  );

  return {
    selected,
    connected,
    connectedIds,
    connectedKey,
    droppedCount,
    busy,
    lastBatch,
    sendMany,
    clearResults: () => setLastBatch(null),
  };
}
