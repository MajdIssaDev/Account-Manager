import { useEffect, useMemo, useState } from "react";
import type { AccountPublic, AppSettings, UpdateState } from "../shared/types";
import { DEFAULT_LABELS } from "../shared/types";
import AddAccountModal from "./AddAccountModal";
import SettingsModal from "./SettingsModal";
import AccountCard from "./AccountCard";
import ConfirmDialog from "./ConfirmDialog";
import LabelSidebar from "./LabelSidebar";
import Tutorial from "./Tutorial";

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

function applyTheme(themeId: string | undefined): void {
  document.documentElement.setAttribute("data-theme", themeId || "midnight");
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filterLabels, setFilterLabels] = useState<string[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<AccountPublic | null>(null);
  const [tourOpen, setTourOpen] = useState(false);

  useEffect(() => {
    void window.ram.listAccounts().then(setAccounts);
    void window.ram.getSettings().then((s) => {
      setSettings(s);
      applyTheme(s.themeId);
      if (!s.tutorialDone) {
        window.setTimeout(() => setTourOpen(true), 400);
      }
    });
    void window.ram.getUpdateState().then(setUpdate);
    const offA = window.ram.onAccountsChanged(setAccounts);
    const offS = window.ram.onSettingsChanged((s) => {
      setSettings(s);
      applyTheme(s.themeId);
    });
    const offT = window.ram.onToast((msg) => {
      setToast(msg);
      window.setTimeout(() => setToast(null), 5000);
    });
    const offU = window.ram.onUpdateState(setUpdate);
    return () => {
      offA();
      offS();
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

  const labels = settings?.labels?.length ? settings.labels : DEFAULT_LABELS;

  const visible = useMemo(() => {
    const filtered = accounts.filter((a) => {
      if (showInactive) {
        if (!a.inactive) {
          return false;
        }
        if (filterLabels.length === 0) {
          return true;
        }
        return a.labelIds.some((id) => filterLabels.includes(id));
      }
      if (a.inactive) {
        return false;
      }
      if (filterLabels.length === 0) {
        return true;
      }
      return a.labelIds.some((id) => filterLabels.includes(id));
    });
    const rank = (a: AccountPublic) => {
      let min = 999;
      for (const id of a.labelIds) {
        const i = labels.findIndex((l) => l.id === id);
        if (i >= 0 && i < min) {
          min = i;
        }
      }
      return min;
    };
    return filtered.sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d !== 0) {
        return d;
      }
      return (a.displayName || a.username).localeCompare(b.displayName || b.username);
    });
  }, [accounts, filterLabels, showInactive, labels]);

  const selectedVisible = selectedIds.filter((id) => visible.some((a) => a.id === id));

  const chip = updateChip(update);

  const endTour = async () => {
    setTourOpen(false);
    const next = await window.ram.setSettings({ tutorialDone: true });
    setSettings(next);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>Account Manager</strong>
          <span>your accounts, locally</span>
        </div>
        <button
          className={`ver-chip ${chip.kind}`}
          data-tour="updates"
          title={update?.message || "Check for updates"}
          onClick={() => {
            void (async () => {
              if (update?.status === "ready" || update?.status === "available") {
                const next = await window.ram.downloadUpdate();
                setUpdate(next);
                show(next.message);
                return;
              }
              setUpdate((prev) =>
                prev
                  ? { ...prev, status: "checking", message: "Checking GitHub…" }
                  : prev,
              );
              const checked = await window.ram.checkUpdates();
              setUpdate(checked);
              if (checked.status === "available" || checked.status === "error") {
                const next = await window.ram.downloadUpdate();
                setUpdate(next);
                show(next.message);
                return;
              }
              show(checked.message);
            })();
          }}
        >
          {chip.label}
        </button>
        <label className="attach" data-tour="attach">
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
        <button className="btn" data-tour="help" onClick={() => setTourOpen(true)}>
          Tutorial
        </button>
        <button className="btn" data-tour="settings" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
        <button className="btn primary" data-tour="add-account" onClick={() => setAddOpen(true)}>
          Add account
        </button>
      </header>

      <div className="shell">
        <LabelSidebar
          labels={labels}
          selectedIds={filterLabels}
          showInactive={showInactive}
          onToggleLabel={(id) =>
            setFilterLabels((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
          }
          onToggleInactive={() => setShowInactive((v) => !v)}
          onCreate={(name, color) => void window.ram.createLabel(name, color)}
          onUpdate={(id, patch) => void window.ram.updateLabel(id, patch)}
          onDelete={(id) => void window.ram.deleteLabel(id)}
        />
        <div className="main">
          {selectedVisible.length > 0 || tourOpen ? (
            <div className="launch-bar" data-tour="launch-selected">
              <span>
                {selectedVisible.length} selected
                {showInactive ? " · inactive view" : ""}
              </span>
              <button className="btn" disabled={selectedVisible.length === 0} onClick={() => setSelectedIds([])}>
                Clear
              </button>
              <button
                className="btn primary"
                disabled={busyId === "__many__" || selectedVisible.length === 0}
                onClick={() =>
                  run("__many__", () => window.ram.launchMany(selectedVisible), false)
                }
              >
                Launch selected
              </button>
            </div>
          ) : null}
          {accounts.length === 0 ? (
            <div className="empty" data-tour="cards">
              <h3>No accounts yet</h3>
              <p>Add one with a session cookie, Roblox login, signup, or quick add.</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty" data-tour="cards">
              <h3>{showInactive ? "No inactive accounts" : "Nothing matches"}</h3>
              <p>
                {showInactive
                  ? "Mark a card Inactive to hide it from the main list. Click Show Inactive alone to see all of them."
                  : "Clear labels or pick different ones. Inactive accounts stay hidden until you click Show Inactive."}
              </p>
            </div>
          ) : (
            <div className="grid" data-tour="cards">
              {visible.map((a) => (
                <AccountCard
                  key={a.id}
                  account={a}
                  labels={labels}
                  busy={busyId === a.id || busyId === "__many__"}
                  selected={selectedIds.includes(a.id)}
                  error={cardErrors[a.id]}
                  onSelect={(on) =>
                    setSelectedIds((prev) =>
                      on ? [...prev, a.id] : prev.filter((id) => id !== a.id),
                    )
                  }
                  onLaunch={() => run(a.id, () => window.ram.launch(a.id), true)}
                  onFocus={() => run(a.id, () => window.ram.focus(a.id))}
                  onClose={() => run(a.id, () => window.ram.close(a.id))}
                  onRemove={() => setRemoveTarget(a)}
                  onToggleLabel={(labelId) => {
                    const next = a.labelIds.includes(labelId)
                      ? a.labelIds.filter((id) => id !== labelId)
                      : [...a.labelIds, labelId];
                    void window.ram.patchAccount(a.id, { labelIds: next });
                  }}
                  onToggleInactive={() =>
                    void window.ram.patchAccount(a.id, { inactive: !a.inactive })
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {addOpen && <AddAccountModal onClose={() => setAddOpen(false)} />}
      {settingsOpen && settings && (
        <SettingsModal
          settings={settings}
          update={update}
          onClose={() => {
            setSettingsOpen(false);
            applyTheme(settings.themeId);
          }}
          onSaved={(s) => {
            setSettings(s);
            applyTheme(s.themeId);
          }}
          onReplayTutorial={() => {
            applyTheme(settings.themeId);
            setSettingsOpen(false);
            setTourOpen(true);
          }}
        />
      )}
      {removeTarget && (
        <ConfirmDialog
          title="Remove this account?"
          body={`Remove @${removeTarget.username} from Account Manager? The saved session is deleted from this PC. You can add it again later.`}
          confirmLabel="Remove"
          danger
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => {
            const id = removeTarget.id;
            setRemoveTarget(null);
            setSelectedIds((prev) => prev.filter((x) => x !== id));
            void run(id, () => window.ram.remove(id));
          }}
        />
      )}
      {tourOpen && <Tutorial onEnd={() => void endTour()} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
