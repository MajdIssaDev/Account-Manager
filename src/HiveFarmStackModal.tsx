import { useEffect, useState } from "react";
import {
  CHEST_FARM_SPEEDS,
  DEFAULT_FARMING_STACK,
  normalizeFarmingStack,
  type ChestFarmSpeed,
  type FarmingStackConfig,
} from "../shared/types";

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

  return (
    <div className="overlay" onMouseDown={props.onClose}>
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
          <button className="btn" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
