import type { HiveFanoutBatch } from "./useHiveTarget";

export default function HiveFanoutResults(props: {
  batch: HiveFanoutBatch | null;
  accountNames?: Map<number, string>;
}) {
  const { batch, accountNames } = props;
  if (!batch || batch.results.length === 0) {
    return null;
  }
  const okN = batch.results.filter((r) => r.ok).length;
  return (
    <div className="hive-results">
      <p className="hint hive-results-head">
        {okN}/{batch.results.length} ok
        {batch.dropped > 0 ? ` · ${batch.dropped} skipped offline/stale` : ""}
      </p>
      <div className="hive-result-rows">
        {batch.results.map((row) => (
          <p key={row.userId} className={`hive-result-row${row.ok ? " ok" : " fail"}`}>
            {accountNames?.get(row.userId) || row.userId}:{" "}
            {row.skipped ? "offline" : row.ok ? "ok" : row.error || "fail"}
          </p>
        ))}
      </div>
    </div>
  );
}
