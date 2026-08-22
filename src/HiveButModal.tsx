import { useEffect, useMemo, useState } from "react";
import type { AccountPublic, HiveSendManyResult } from "../shared/types";
import { itemsFromResult } from "./hiveInventoryUtils";

type UnionRow = {
  name: string;
  haveCount: number;
  missingCount: number;
  total: number;
  included: boolean;
};
export default function HiveButModal(props: {
  kind: "sell" | "eat";
  accounts: AccountPublic[];
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const { kind, accounts } = props;
  const accountIdsKey = useMemo(() => accounts.map((a) => a.id).sort().join(","), [accounts]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<UnionRow[]>([]);
  const [perAccount, setPerAccount] = useState<HiveSendManyResult[]>([]);

  const title = kind === "sell" ? "Sell all…" : "Eat all…";
  const verb = kind === "sell" ? "Sell" : "Eat";

  useEffect(() => {
    let cancelled = false;
    const accountIds = accountIdsKey;
    void (async () => {
      setLoading(true);
      setError(null);
      const listed = await window.ram.hiveSendMany({
        accountIds: accounts.map((a) => a.id),
        op: "inventory.list",
        payload: { kind: kind === "sell" ? "sellable" : "food" },
        timeoutMs: 20000,
      });
      if (cancelled) {
        return;
      }
      if (!listed.ok || !listed.data) {
        setError(listed.error || "Could not list inventory.");
        setLoading(false);
        return;
      }
      const okResults = listed.data.results.filter((r) => r.ok && !r.skipped);
      const names = new Map<string, { have: Set<number>; total: number }>();
      for (const result of okResults) {
        const seen = new Set<string>();
        for (const item of itemsFromResult(result)) {
          const name = String(item.name || "").trim();
          if (!name || seen.has(name)) {
            continue;
          }
          seen.add(name);
          const cur = names.get(name) || { have: new Set<number>(), total: 0 };
          cur.have.add(result.userId);
          cur.total += Number(item.amount ?? item.count ?? 0);
          names.set(name, cur);
        }
      }
      const next: UnionRow[] = Array.from(names.entries())
        .map(([name, info]) => ({
          name,
          haveCount: info.have.size,
          missingCount: Math.max(0, accounts.length - info.have.size),
          total: info.total,
          included: true,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setRows(next);
      setLoading(false);
      if (okResults.length === 0) {
        setError("No connected hive clients returned inventory.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountIdsKey, kind, accounts]);

  const excludeNames = useMemo(() => rows.filter((r) => !r.included).map((r) => r.name), [rows]);
  const includeCount = rows.filter((r) => r.included).length;

  const run = async () => {
    setBusy(true);
    setError(null);
    const sent = await window.ram.hiveSendMany({
      accountIds: accounts.map((a) => a.id),
      op: kind === "sell" ? "inventory.sell" : "inventory.eat",
      payload: kind === "sell"
        ? { excludeNames, mode: "continue" }
        : { excludeNames },
      timeoutMs: 30000,
    });
    setBusy(false);
    if (!sent.ok || !sent.data) {
      setError(sent.error || "Hive command failed.");
      return;
    }
    setPerAccount(sent.data.results);
    const okN = sent.data.results.filter((r) => r.ok).length;
    const skipN = sent.data.results.filter((r) => r.skipped || r.data?.skipped === true).length;
    props.onDone(`${verb} ${okN}/${sent.data.results.length} clients${skipN ? ` · ${skipN} skipped` : ""}`);
  };

  return (
    <div className="overlay" onMouseDown={props.onClose}>
      <div className="modal modal-wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="hint">
          Union of {accounts.length} connected client{accounts.length === 1 ? "" : "s"}. Uncheck an item to
          exclude it everywhere (clients that never had it skip that name).
        </p>
        {loading ? <p className="hint">Listing inventories…</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {!loading && rows.length > 0 ? (
          <div className="but-list">
            {rows.map((row) => (
              <label key={row.name} className="but-row">
                <input
                  type="checkbox"
                  checked={row.included}
                  onChange={() =>
                    setRows((cur) =>
                      cur.map((item) =>
                        item.name === row.name ? { ...item, included: !item.included } : item,
                      ),
                    )
                  }
                />
                <span className="but-name">{row.name}</span>
                <span className="but-meta">
                  {row.haveCount} have · {row.missingCount} missing
                  {row.total > 0 ? ` · ${row.total}` : ""}
                </span>
              </label>
            ))}
          </div>
        ) : null}
        {!loading && !error && rows.length === 0 ? (
          <p className="hint">No matching items on the selected clients.</p>
        ) : null}
        {perAccount.length > 0 ? (
          <div className="but-results">
            {perAccount.map((row) => (
              <p key={row.userId} className="hint">
                {row.userId}: {row.ok ? "ok" : row.error || "fail"}
                {typeof row.data?.sold === "number" ? ` · sold ${row.data.sold}` : ""}
                {typeof row.data?.eaten === "number" ? ` · eaten ${row.data.eaten}` : ""}
                {row.skipped || row.data?.skipped === true ? " · skipped" : ""}
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
            disabled={busy || loading || includeCount === 0 || accounts.length === 0}
            onClick={() => void run()}
          >
            {busy ? "Sending…" : `${verb} ${includeCount} item${includeCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
