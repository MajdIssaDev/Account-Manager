import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AccountPublic,
  HiveCatalogControl,
  HiveSendManyResult,
  HiveServerLedgerEntry,
  HiveSession,
} from "../shared/types";
import { HIVE_STARTABLE_JOBS } from "../shared/types";
import HiveBackgroundFishModal from "./HiveBackgroundFishModal";
import HiveButModal from "./HiveButModal";
import HiveCatalogSlider from "./HiveCatalogSlider";
import HiveFanoutResults from "./HiveFanoutResults";
import { applyFpsCap, loadFpsCapState, startFarmingStackWithDedupe, startPlaylistWithDedupe } from "./hiveCoordination";
import { useHiveStore } from "./hiveStore";
import { useHiveTarget } from "./useHiveTarget";

type TabId = "overview" | "jobs" | "catalog" | "inventory" | "servers";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "jobs", label: "Jobs" },
  { id: "catalog", label: "Catalog" },
  { id: "inventory", label: "Inventory" },
  { id: "servers", label: "Servers" },
];

function accountNameMap(accounts: AccountPublic[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const a of accounts) {
    m.set(a.userId, a.displayName || a.username);
  }
  return m;
}

const CatalogTab = memo(function CatalogTab(props: {
  hidden: boolean;
  connectedIdsKey: string;
  firstAccountId: string | undefined;
  connected: AccountPublic[];
  busy: boolean;
  sendMany: ReturnType<typeof useHiveTarget>["sendMany"];
}) {
  const [controls, setControls] = useState<HiveCatalogControl[]>([]);
  const [sliderValues, setSliderValues] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [localBatch, setLocalBatch] = useState<HiveSendManyResult[] | null>(null);
  const loadedKeyRef = useRef("");

  const load = useCallback(async () => {
    if (!props.firstAccountId) {
      return;
    }
    setLoading(true);
    setError(null);
    const snap = await window.ram.hiveSend({
      accountId: props.firstAccountId,
      op: "catalog.snapshot",
      payload: { ensure: true },
      timeoutMs: 45000,
    });
    if (snap.ok && snap.data?.data) {
      const rawControls = snap.data.data.controls;
      const list = Array.isArray(rawControls) ? (rawControls as HiveCatalogControl[]) : [];
      const sliders = snap.data.data.sliders;
      setControls(list);
      setSliderValues(typeof sliders === "object" && sliders ? (sliders as Record<string, number>) : {});
      setLoading(false);
      return;
    }
    const res = await window.ram.hiveSend({
      accountId: props.firstAccountId,
      op: "catalog.list",
      payload: { ensure: true },
      timeoutMs: 45000,
    });
    setLoading(false);
    if (!res.ok || !res.data?.data) {
      setError(res.error || res.data?.error || "catalog.list failed");
      return;
    }
    const raw = res.data.data.controls;
    const list = Array.isArray(raw) ? (raw as HiveCatalogControl[]) : [];
    setControls(list);
    setSliderValues({});
  }, [props.firstAccountId]);

  useEffect(() => {
    if (!props.firstAccountId || loadedKeyRef.current === props.connectedIdsKey) {
      return;
    }
    loadedKeyRef.current = props.connectedIdsKey;
    void load();
  }, [props.connectedIdsKey, props.firstAccountId, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return controls;
    }
    return controls.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    );
  }, [controls, query]);

  const byCategory = useMemo(() => {
    const map = new Map<string, HiveCatalogControl[]>();
    for (const c of filtered) {
      const cat = c.category || "Misc";
      const arr = map.get(cat) || [];
      arr.push(c);
      map.set(cat, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const fan = async (op: string, payload: Record<string, unknown>) => {
    const batch = await props.sendMany(op, payload);
    if (batch) {
      setLocalBatch(batch.results);
    }
  };

  return (
    <div className="hive-tab-body" hidden={props.hidden}>
      <div className="hive-toolbar">
        <input
          className="hive-search"
          placeholder="Search controls…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn" disabled={loading || props.busy} onClick={() => void load()}>
          Reload
        </button>
      </div>
      {loading ? <p className="hint">Loading catalog…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && controls.length > 0 ? (
        <p className="hint">{controls.length} controls from first connected client</p>
      ) : null}
      <div className="hive-catalog">
        {byCategory.map(([cat, items]) => {
          const open = openCats.has(cat);
          return (
            <div key={cat} className="hive-catalog-cat">
              <button
                type="button"
                className="hive-catalog-cat-head"
                onClick={() =>
                  setOpenCats((prev) => {
                    const next = new Set(prev);
                    if (next.has(cat)) {
                      next.delete(cat);
                    } else {
                      next.add(cat);
                    }
                    return next;
                  })
                }
              >
                {open ? "▾" : "▸"} {cat} ({items.length})
              </button>
              {open ? (
                <div className="hive-catalog-rows">
                  {items.map((c) => (
                    <div
                      key={c.id}
                      className={`hive-catalog-row${c.remote === "unsupported" ? " disabled" : ""}`}
                    >
                      <span className="hive-catalog-label" title={c.id}>
                        {c.label}
                      </span>
                      {c.remote === "toggle" ? (
                        <label className="hive-toggle">
                          <input
                            type="checkbox"
                            disabled={props.busy}
                            onChange={(e) => void fan("toggle.set", { key: c.id, on: e.target.checked })}
                          />
                        </label>
                      ) : null}
                      {c.remote === "slider" ? (
                        <HiveCatalogSlider
                          control={c}
                          accountId={props.firstAccountId}
                          initialValue={sliderValues[c.id]}
                          lazy={!open}
                          busy={props.busy}
                          onCommit={(id, value) => void fan("slider.set", { id, value })}
                        />
                      ) : null}
                      {c.remote === "button" ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={props.busy}
                          onClick={() => void fan("button.click", { id: c.primaryButtonId || c.id })}
                        >
                          Run
                        </button>
                      ) : null}
                      {c.remote === "job" && c.jobId ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={props.busy}
                          onClick={() => void fan("jobs.start", { job: c.jobId })}
                        >
                          Start
                        </button>
                      ) : null}
                      {c.remote === "unsupported" ? (
                        <span className="hive-muted">unsupported</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {localBatch ? (
        <HiveFanoutResults batch={{ dropped: 0, results: localBatch }} />
      ) : null}
    </div>
  );
});

const ServersTab = memo(function ServersTab(props: {
  ledger: HiveServerLedgerEntry[];
  sessions: HiveSession[];
  connected: AccountPublic[];
  busy: boolean;
  sendMany: ReturnType<typeof useHiveTarget>["sendMany"];
}) {
  const [badOnly, setBadOnly] = useState(false);
  const activeJobIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of props.sessions) {
      if (s.jobId && props.connected.some((a) => a.userId === s.userId)) {
        set.add(s.jobId);
      }
    }
    return set;
  }, [props.sessions, props.connected]);

  const rows = useMemo(() => {
    let list = [...props.ledger].sort((a, b) => b.updatedAt - a.updatedAt);
    if (badOnly) {
      list = list.filter((r) => r.verdict === "bad");
    }
    return list;
  }, [props.ledger, badOnly]);

  return (
    <div className="hive-tab-body">
      <p className="hint">
        Peer server memory from clients that left a jobId. Bad servers are skipped on hop when
        alternatives exist.
      </p>
      <label className="attach">
        <input type="checkbox" checked={badOnly} onChange={(e) => setBadOnly(e.target.checked)} />
        Show bad only
      </label>
      <button
        type="button"
        className="btn"
        disabled={props.busy || props.connected.length === 0}
        onClick={() => void props.sendMany("travel.hop", { quiet: true })}
      >
        Hop selected away
      </button>
      {rows.length === 0 ? <p className="hint">No server reports yet.</p> : null}
      <div className="hive-server-table">
        {rows.map((row) => (
          <div
            key={`${row.placeId}-${row.jobId}`}
            className={`hive-server-row${activeJobIds.has(row.jobId) ? " active" : ""}`}
          >
            <span className={`server-verdict server-verdict-${row.verdict}`}>{row.verdict}</span>
            <span className="hive-server-job" title={row.jobId}>
              {row.jobId.slice(0, 8)}…
            </span>
            <span className="hive-muted">place {row.placeId}</span>
            <span className="hive-muted">
              +{row.good} / −{row.bad}
            </span>
            <span className="hive-server-reason">{row.latestReason || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

function PerformanceSection(props: {
  firstAccountId: string | undefined;
  busy: boolean;
  sendMany: ReturnType<typeof useHiveTarget>["sendMany"];
}) {
  const [enabled, setEnabled] = useState(false);
  const [cap, setCap] = useState(20);
  const [warn, setWarn] = useState<string | null>(null);

  useEffect(() => {
    if (!props.firstAccountId) {
      return;
    }
    void loadFpsCapState(props.firstAccountId).then((state) => {
      setEnabled(state.enabled);
      setCap(state.cap);
      setWarn(null);
    });
  }, [props.firstAccountId]);

  const apply = async (nextEnabled: boolean, nextCap: number) => {
    const batch = await applyFpsCap(props.sendMany, nextEnabled, nextCap);
    if (batch) {
      setEnabled(nextEnabled);
      setCap(nextCap);
    }
  };

  return (
    <div className="hive-perf">
      <h3 className="hive-perf-title">Performance</h3>
      <p className="hint">
        FPS cap via script toggles (works on background clients). Use 15–20 for multi-box farming.
      </p>
      <label className="hive-perf-row attach">
        <input
          type="checkbox"
          checked={enabled}
          disabled={props.busy || !props.firstAccountId}
          onChange={(e) => void apply(e.target.checked, cap)}
        />
        Cap FPS on connected clients
      </label>
      <div className="hive-perf-row">
        <span className="hive-perf-cap">{cap} FPS</span>
        <input
          type="range"
          className="hive-slider hive-perf-slider"
          min={15}
          max={60}
          step={1}
          value={cap}
          disabled={props.busy || !enabled}
          onChange={(e) => setCap(Number(e.target.value))}
          onMouseUp={(e) => void apply(enabled, Number((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => void apply(enabled, Number((e.target as HTMLInputElement).value))}
        />
      </div>
      <div className="hive-perf-presets">
        {[15, 20, 30].map((n) => (
          <button
            key={n}
            type="button"
            className="btn"
            disabled={props.busy || !props.firstAccountId}
            onClick={() => void apply(true, n)}
          >
            {n} FPS
          </button>
        ))}
        <button
          type="button"
          className="btn"
          disabled={props.busy || !props.firstAccountId}
          onClick={() => void apply(false, cap)}
        >
          Uncap
        </button>
      </div>
      {warn ? <p className="hint">{warn}</p> : null}
    </div>
  );
}

export default function HivePanel(props: {
  accounts: AccountPublic[];
  selectedIds: string[];
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const [tab, setTab] = useState<TabId>("overview");
  const [butKind, setButKind] = useState<"sell" | "eat" | null>(null);
  const [bgFishOpen, setBgFishOpen] = useState(false);
  const { sessions, ledger } = useHiveStore();

  const hive = useHiveTarget(props.accounts, props.selectedIds);
  const names = useMemo(() => accountNameMap(props.accounts), [props.accounts]);
  const firstAccountId = hive.connected[0]?.id;

  useEffect(() => {
    void window.ram.setHivePanelOpen(true);
    return () => {
      void window.ram.setHivePanelOpen(false);
    };
  }, []);

  const [stackBusy, setStackBusy] = useState(false);

  const toastBatch = (label: string, batch: Awaited<ReturnType<typeof hive.sendMany>>) => {
    if (batch) {
      props.onToast(`${label}: ${batch.results.filter((r) => r.ok).length}/${batch.results.length} ok`);
    }
  };

  const runFarmingStack = async () => {
    if (stackBusy) {
      props.onToast("Farming stack is already running — wait for hops to finish.");
      return;
    }
    setStackBusy(true);
    try {
      toastBatch(
        "farming_stack",
        await startFarmingStackWithDedupe(hive.connected, hive.sendMany, props.onToast),
      );
    } finally {
      setStackBusy(false);
    }
  };

  const runPreset = async (name: string) => {
    if (name === "farming_stack") {
      await runFarmingStack();
      return;
    }
    if (name === "stop_all") {
      await window.ram.setFarmingStackIntent({ userIds: [], active: false });
    }
    toastBatch(name, await hive.sendMany("preset.apply", { name }));
  };

  const runOp = async (op: string, payload: Record<string, unknown> = {}) => {
    toastBatch(op, await hive.sendMany(op, payload));
  };

  const startJob = async (jobId: string) => {
    if (jobId === "afk_playlist") {
      toastBatch(
        "Start afk_playlist",
        await startPlaylistWithDedupe(hive.connected, hive.sendMany, props.onToast),
      );
      return;
    }
    if (jobId === "background_fish") {
      setBgFishOpen(true);
      return;
    }
    toastBatch(`Start ${jobId}`, await hive.sendMany("jobs.start", { job: jobId }));
  };

  const stopJob = async (jobId: string) => {
    toastBatch(`Stop ${jobId}`, await hive.sendMany("jobs.stop", { job: jobId }));
  };

  return createPortal(
    <div className="hive-shell">
      <div className="hive-backdrop" onMouseDown={props.onClose} />
      <aside className="hive-drawer" onMouseDown={(e) => e.stopPropagation()}>
        <header className="hive-drawer-head">
          <div>
            <h2>Hive Control</h2>
            <p className="hint">
              {hive.connected.length} connected
              {hive.droppedCount > 0 ? ` · ${hive.droppedCount} skipped` : ""}
            </p>
          </div>
          <button type="button" className="btn" onClick={props.onClose}>
            Close
          </button>
        </header>

        <nav className="hive-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`hive-tab${tab === t.id ? " on" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="hive-tab-body" hidden={tab !== "overview"}>
            <div className="hive-actions">
              <button
                type="button"
                className="btn primary"
                disabled={hive.busy || stackBusy}
                onClick={() => void runPreset("farming_stack")}
              >
                {stackBusy ? "Farming stack…" : "Farming stack"}
              </button>
              <button type="button" className="btn danger" disabled={hive.busy} onClick={() => void runPreset("stop_all")}>
                Stop all
              </button>
              <button type="button" className="btn" disabled={hive.busy} onClick={() => void runOp("travel.hop", { quiet: true })}>
                Hop
              </button>
              <button type="button" className="btn" disabled={hive.busy} onClick={() => void runOp("travel.rejoin")}>
                Rejoin
              </button>
              <button type="button" className="btn" disabled={hive.busy} onClick={() => void runOp("ping")}>
                Ping
              </button>
              <button type="button" className="btn" disabled={hive.busy} onClick={() => void runOp("status")}>
                Status
              </button>
            </div>
            <PerformanceSection firstAccountId={firstAccountId} busy={hive.busy} sendMany={hive.sendMany} />
            <HiveFanoutResults batch={hive.lastBatch} accountNames={names} />
        </div>

        <div className="hive-tab-body" hidden={tab !== "jobs"}>
            <div className="hive-job-list">
              {HIVE_STARTABLE_JOBS.map((job) => (
                <div key={job.id} className="hive-job-row">
                  <span>{job.label}</span>
                  <div className="hive-job-btns">
                    <button type="button" className="btn" disabled={hive.busy} onClick={() => void startJob(job.id)}>
                      {job.id === "background_fish" ? "Start…" : "Start"}
                    </button>
                    <button type="button" className="btn" disabled={hive.busy} onClick={() => void stopJob(job.id)}>
                      Stop
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="btn danger" disabled={hive.busy} onClick={() => void runOp("jobs.stopAll")}>
              Stop all jobs
            </button>
            <HiveFanoutResults batch={hive.lastBatch} accountNames={names} />
        </div>

        <CatalogTab
          hidden={tab !== "catalog"}
          connectedIdsKey={hive.connectedKey}
          firstAccountId={firstAccountId}
          connected={hive.connected}
          busy={hive.busy}
          sendMany={hive.sendMany}
        />

        <div className="hive-tab-body" hidden={tab !== "inventory"}>
            <p className="hint">Union inventory across connected clients, then exclude names to sell/eat.</p>
            <div className="hive-actions">
              <button
                type="button"
                className="btn"
                disabled={hive.connected.length === 0}
                onClick={() => setButKind("sell")}
              >
                Sell all…
              </button>
              <button
                type="button"
                className="btn"
                disabled={hive.connected.length === 0}
                onClick={() => setButKind("eat")}
              >
                Eat all…
              </button>
            </div>
        </div>

        <div hidden={tab !== "servers"}>
          <ServersTab
            ledger={ledger}
            sessions={sessions}
            connected={hive.connected}
            busy={hive.busy}
            sendMany={hive.sendMany}
          />
        </div>
      </aside>

      {butKind ? (
        <HiveButModal
          kind={butKind}
          accounts={hive.connected}
          onClose={() => setButKind(null)}
          onDone={(summary) => {
            props.onToast(summary);
            setButKind(null);
          }}
        />
      ) : null}
      {bgFishOpen ? (
        <HiveBackgroundFishModal
          accounts={hive.connected}
          onClose={() => setBgFishOpen(false)}
          onDone={(summary) => {
            props.onToast(summary);
            setBgFishOpen(false);
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}
