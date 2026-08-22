import { useEffect, useState, type MouseEvent } from "react";
import {
  CHEST_FARM_SPEEDS,
  DEFAULT_FARMING_STACK,
  FARM_REJOIN_SECONDS_MAX,
  FARM_REJOIN_SECONDS_MIN,
  clampFarmRejoinSeconds,
  formatFarmRejoinSeconds,
  normalizeFarmingStack,
  type ChestFarmSpeed,
  type FarmingStackConfig,
} from "../shared/types";

const REJOIN_PRESETS = [
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "30m", seconds: 1800 },
  { label: "1h", seconds: 3600 },
  { label: "2h", seconds: 7200 },
];

function dismissOverlay(onClose: () => void) {
  return (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };
}

export default function HiveFarmStackModal(props: {
  onClose: () => void;
  onSaved: (cfg: FarmingStackConfig) => void;
}) {
  const [cfg, setCfg] = useState<FarmingStackConfig>(DEFAULT_FARMING_STACK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.ram.getSettings().then((settings) => {
      if (!cancelled) {
        setCfg(normalizeFarmingStack(settings.farmingStack));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = normalizeFarmingStack(cfg);
      await window.ram.setSettings({ farmingStack: next });
      props.onSaved(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save farm stack settings.");
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  const setRejoin = (value: number) => {
    setCfg((cur) => ({ ...cur, rejoinSeconds: clampFarmRejoinSeconds(value) }));
  };

  return (
    <div className="overlay" onMouseDown={dismissOverlay(props.onClose)}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Configure farm stack</h2>
        <p className="hint">
          Saved for Farming stack, server hops, and chest-farm rejoins. Chest farm always runs; fishing
          and passive income are optional.
        </p>
        <label>Chest farm speed</label>
        <div className="choice-row farm-speed-row">
          {CHEST_FARM_SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              className={`choice${cfg.speedPreset === speed ? " on" : ""}`}
              disabled={busy}
              onClick={() => setCfg((cur) => ({ ...cur, speedPreset: speed as ChestFarmSpeed }))}
            >
              {speed}
            </button>
          ))}
        </div>
        <label>Rejoin every</label>
        <div className="farm-rejoin-row">
          <input
            type="range"
            min={FARM_REJOIN_SECONDS_MIN}
            max={FARM_REJOIN_SECONDS_MAX}
            step={30}
            disabled={busy}
            value={cfg.rejoinSeconds}
            onChange={(e) => setRejoin(Number(e.target.value))}
          />
          <span className="farm-rejoin-value">{formatFarmRejoinSeconds(cfg.rejoinSeconds)}</span>
        </div>
        <div className="hive-perf-presets">
          {REJOIN_PRESETS.map((preset) => (
            <button
              key={preset.seconds}
              type="button"
              className={`btn${cfg.rejoinSeconds === preset.seconds ? " primary" : ""}`}
              disabled={busy}
              onClick={() => setRejoin(preset.seconds)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="hint">Chest farm hops to a new sea server on this timer, and also on death or bail.</p>
        <label className="attach">
          <input
            type="checkbox"
            checked={cfg.fish}
            disabled={busy}
            onChange={(e) => setCfg((cur) => ({ ...cur, fish: e.target.checked }))}
          />
          Background fishing
        </label>
        <label className="attach">
          <input
            type="checkbox"
            checked={cfg.passive}
            disabled={busy}
            onChange={(e) => setCfg((cur) => ({ ...cur, passive: e.target.checked }))}
          />
          Passive income
        </label>
        {error ? <p className="error">{error}</p> : null}
        <div className="row-actions">
          <button type="button" className="btn" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
