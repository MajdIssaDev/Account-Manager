import { useEffect, useState } from "react";
import type { AccountPublic, HiveSendManyResult } from "../shared/types";
import { intersectItemNames } from "./hiveInventoryUtils";

const BAIT_OPTIONS = ["Normal", "Giant", "Swarm", "Magic"];

export default function HiveBackgroundFishModal(props: {
  accounts: AccountPublic[];
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const { accounts } = props;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rods, setRods] = useState<string[]>([]);
  const [selectedRod, setSelectedRod] = useState("");
  const [selectedBait, setSelectedBait] = useState("Normal");
  const [perAccount, setPerAccount] = useState<HiveSendManyResult[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      const listed = await window.ram.hiveSendMany({
        accountIds: accounts.map((a) => a.id),
        op: "inventory.list",
        payload: { kind: "rods" },
        timeoutMs: 20000,
      });
      if (cancelled) {
        return;
      }
      if (!listed.ok || !listed.data) {
        setError(listed.error || "Could not list fishing rods.");
        setLoading(false);
        return;
      }
      const okResults = listed.data.results.filter((r) => r.ok && !r.skipped);
      const shared = intersectItemNames(okResults, accounts.length);
      setRods(shared);
      setSelectedRod(shared[0] || "");
      setLoading(false);
      if (okResults.length === 0) {
        setError("No connected hive clients returned rod inventory.");
      } else if (shared.length === 0) {
        setError("No rod is owned by every selected client — each account needs the same rod.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accounts]);

  const run = async () => {
    if (!selectedRod) {
      return;
    }
    setBusy(true);
    setError(null);
    const sent = await window.ram.hiveSendMany({
      accountIds: accounts.map((a) => a.id),
      op: "jobs.start",
      payload: {
        job: "background_fish",
        config: { rod: selectedRod, bait: selectedBait },
      },
      timeoutMs: 30000,
    });
    setBusy(false);
    if (!sent.ok || !sent.data) {
      setError(sent.error || "Hive command failed.");
      return;
    }
    setPerAccount(sent.data.results);
    const okN = sent.data.results.filter((r) => r.ok).length;
    props.onDone(`Background fish ${okN}/${sent.data.results.length} ok · ${selectedRod}`);
  };

  return (
    <div className="overlay" onMouseDown={props.onClose}>
      <div className="modal modal-wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Background fishing</h2>
        <p className="hint">
          Only rods every connected client owns are listed (AND gate). Pick a shared rod, then start on all{" "}
          {accounts.length} client{accounts.length === 1 ? "" : "s"}.
        </p>
        {loading ? <p className="hint">Scanning rods…</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {!loading && rods.length > 0 ? (
          <div className="hive-bgfish-form">
            <label className="hive-bgfish-field">
              <span>Rod</span>
              <select
                value={selectedRod}
                disabled={busy}
                onChange={(e) => setSelectedRod(e.target.value)}
              >
                {rods.map((rod) => (
                  <option key={rod} value={rod}>
                    {rod}
                  </option>
                ))}
              </select>
            </label>
            <label className="hive-bgfish-field">
              <span>Bait</span>
              <select
                value={selectedBait}
                disabled={busy}
                onChange={(e) => setSelectedBait(e.target.value)}
              >
                {BAIT_OPTIONS.map((bait) => (
                  <option key={bait} value={bait}>
                    {bait}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {perAccount.length > 0 ? (
          <div className="but-results">
            {perAccount.map((row) => (
              <p key={row.userId} className="hint">
                {row.userId}: {row.ok ? "ok" : row.error || "fail"}
              </p>
            ))}
          </div>
        ) : null}
        <div className="row-actions">
          <button className="btn" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || loading || !selectedRod || rods.length === 0}
            onClick={() => void run()}
          >
            {busy ? "Starting…" : "Start background fishing"}
          </button>
        </div>
      </div>
    </div>
  );
}
