import { useEffect, useState } from "react";
import type { AccountPublic, AppSettings, UpdateState } from "../shared/types";
import AddAccountModal from "./AddAccountModal";
import SettingsModal from "./SettingsModal";
import AccountCard from "./AccountCard";

function updateChip(state: UpdateState | null): { label: string; kind: string } {
  if (!state) {
    return { label: "v…", kind: "muted" };
  }
  const v = `v${state.currentVersion}`;
  switch (state.status) {
    case "checking":
      return { label: `${v} · checking`, kind: "muted" };
    case "up-to-date":
      return { label: `${v} · up to date`, kind: "ok" };
    case "available":
      return { label: `${v} · update ${state.latestVersion}`, kind: "warn" };
    case "downloading":
      return { label: `${v} · ${state.percent}%`, kind: "warn" };
    case "ready":
      return { label: `${v} · restart to update`, kind: "warn" };
    case "error":
      return { label: `${v} · update error`, kind: "bad" };
    default:
      return { label: v, kind: "muted" };
  }
}

export default function App() {
  const [accounts, setAccounts] = useState<AccountPublic[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    void window.ram.listAccounts().then(setAccounts);
    void window.ram.getSettings().then(setSettings);
    void window.ram.getUpdateState().then(setUpdate);
    const offA = window.ram.onAccountsChanged(setAccounts);
    const offT = window.ram.onToast((msg) => {
      setToast(msg);
      window.setTimeout(() => setToast(null), 5000);
    });
    const offU = window.ram.onUpdateState(setUpdate);
    return () => {
      offA();
      offT();
      offU();
    };
  }, []);

  const show = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 5000);
  };

  const run = async (
    id: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
    onCard = false,
  ) => {
    setBusyId(id);
    if (onCard) {
      setCardErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
    try {
      const res = await fn();
      if (!res.ok && res.error) {
        if (onCard) {
          setCardErrors((prev) => ({ ...prev, [id]: res.error! }));
        }
        show(res.error);
      }
    } finally {
      setBusyId(null);
    }
  };

  const chip = updateChip(update);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>Account Manager</strong>
          <span>your accounts, locally</span>
        </div>
        <button
          className={`ver-chip ${chip.kind}`}
          title={update?.message || "Check for updates"}
          onClick={() => {
            if (update?.status === "ready") {
              void window.ram.installUpdate();
              return;
            }
            if (update?.status === "available") {
              void window.ram.downloadUpdate();
              return;
            }
            void window.ram.checkUpdates();
          }}
        >
          {chip.label}
        </button>
        <label className="attach">
          <input
            type="checkbox"
            checked={!!settings?.attachOnLaunch}
            onChange={async (e) => {
              const next = await window.ram.setSettings({ attachOnLaunch: e.target.checked });
              setSettings(next);
            }}
          />
          Attach Potassium on launch
        </label>
        <button className="btn" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
        <button className="btn primary" onClick={() => setAddOpen(true)}>
          Add account
        </button>
      </header>

      {accounts.length === 0 ? (
        <div className="empty">
          <h3>No accounts yet</h3>
          <p>Add one with a session cookie, Roblox login, signup, or quick add.</p>
        </div>
      ) : (
        <div className="grid">
          {accounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              busy={busyId === a.id}
              error={cardErrors[a.id]}
              onLaunch={() => run(a.id, () => window.ram.launch(a.id), true)}
              onFocus={() => run(a.id, () => window.ram.focus(a.id))}
              onClose={() => run(a.id, () => window.ram.close(a.id))}
              onRemove={() => run(a.id, () => window.ram.remove(a.id))}
            />
          ))}
        </div>
      )}

      {addOpen && <AddAccountModal onClose={() => setAddOpen(false)} />}
      {settingsOpen && settings && (
        <SettingsModal
          settings={settings}
          update={update}
          onClose={() => setSettingsOpen(false)}
          onSaved={setSettings}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
