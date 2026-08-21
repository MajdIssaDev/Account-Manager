import { useEffect, useMemo, useState, type MouseEvent } from "react";
import type { AccountPublic, AppSettings, UpdateState } from "../shared/types";
import { DEFAULT_LABELS } from "../shared/types";
import AddAccountModal from "./AddAccountModal";
import SettingsModal from "./SettingsModal";
import AccountCard from "./AccountCard";
import ConfirmDialog from "./ConfirmDialog";
import LabelSidebar from "./LabelSidebar";
import Tutorial from "./Tutorial";
import TitleBarControls from "./TitleBarControls";
import ContextMenu, { type CtxItem } from "./ContextMenu";
import NewLabelModal from "./NewLabelModal";
import { IconAddUser, IconGear, IconInfo } from "./icons";

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
      return { label: `${v} · restart to apply`, kind: "warn" };
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
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [filterLabels, setFilterLabels] = useState<string[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [removeIds, setRemoveIds] = useState<string[] | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourSkip, setTourSkip] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [newLabelFor, setNewLabelFor] = useState<string[] | null>(null);

  useEffect(() => {
    void window.ram.listAccounts().then(setAccounts);
    void window.ram.getSettings().then((s) => {
      setSettings(s);
      applyTheme(s.themeId);
      if (!s.tutorialDone) {
        setTourSkip(false);
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

  const pick = (id: string, e: MouseEvent) => {
    const ids = visible.map((a) => a.id);
    const idx = ids.indexOf(id);
    if (idx < 0) {
      return;
    }
    if (e.shiftKey && anchorId) {
      const from = ids.indexOf(anchorId);
      if (from >= 0) {
        const start = Math.min(from, idx);
        const end = Math.max(from, idx);
        const range = ids.slice(start, end + 1);
        setSelectedIds((prev) =>
          e.ctrlKey ? Array.from(new Set([...prev, ...range])) : range,
        );
        return;
      }
    }
    if (e.ctrlKey) {
      setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
      setAnchorId(id);
      return;
    }
    setSelectedIds([id]);
    setAnchorId(id);
  };

  const openMenu = (id: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ids = selectedIds.includes(id) && selectedIds.length > 0 ? selectedIds : [id];
    if (!selectedIds.includes(id)) {
      setSelectedIds([id]);
      setAnchorId(id);
    }
    setMenu({ x: e.clientX, y: e.clientY, ids });
  };

  const targets = (ids: string[]) => accounts.filter((a) => ids.includes(a.id));

  const addLabelTo = async (ids: string[], labelId: string) => {
    const snap = accounts;
    for (const id of ids) {
      const acc = snap.find((a) => a.id === id);
      if (!acc || acc.labelIds.includes(labelId)) {
        continue;
      }
      await window.ram.patchAccount(id, { labelIds: [...acc.labelIds, labelId] });
    }
  };

  const removeLabelFrom = async (ids: string[], labelId: string) => {
    const snap = accounts;
    for (const id of ids) {
      const acc = snap.find((a) => a.id === id);
      if (!acc || !acc.labelIds.includes(labelId)) {
        continue;
      }
      await window.ram.patchAccount(id, { labelIds: acc.labelIds.filter((x) => x !== labelId) });
    }
  };

  const setInactiveFor = async (ids: string[], inactive: boolean) => {
    for (const id of ids) {
      await window.ram.patchAccount(id, { inactive });
    }
  };

  const createLabel = async (name: string, color: string, applyTo: string[]) => {
    const res = await window.ram.createLabel(name, color);
    setNewLabelFor(null);
    if (!res.ok || !res.data) {
      show(res.error || "Could not create label.");
      return;
    }
    if (applyTo.length) {
      await addLabelTo(applyTo, res.data.id);
    }
  };

  const menuItems = (ids: string[]): CtxItem[] => {
    const rows = targets(ids);
    const n = rows.length;
    const anyRunning = rows.some((a) => a.running);
    const anyIdle = rows.some((a) => !a.running);
    const anyActive = rows.some((a) => !a.inactive);
    const anyInactive = rows.some((a) => a.inactive);
    const usedLabelIds = new Set(rows.flatMap((a) => a.labelIds));
    const addChildren: CtxItem[] = [
      ...labels.map((label) => ({
        type: "item" as const,
        label: label.name,
        checked: n > 0 && rows.every((a) => a.labelIds.includes(label.id)),
        onClick: () => void addLabelTo(ids, label.id),
      })),
      { type: "sep" as const },
      {
        type: "item" as const,
        label: "New label",
        onClick: () => setNewLabelFor(ids),
      },
    ];
    const removeChildren: CtxItem[] = labels
      .filter((label) => usedLabelIds.has(label.id))
      .map((label) => ({
        type: "item" as const,
        label: label.name,
        onClick: () => void removeLabelFrom(ids, label.id),
      }));
    const items: CtxItem[] = [
      {
        type: "item",
        label: n > 1 ? `Launch selected (${n})` : "Launch",
        disabled: !anyIdle,
        onClick: () =>
          void run(
            "__many__",
            () => window.ram.launchMany(rows.filter((a) => !a.running).map((a) => a.id)),
            false,
          ),
      },
    ];
    if (anyRunning) {
      if (n === 1) {
        items.push({
          type: "item",
          label: "Focus",
          onClick: () => void run(rows[0].id, () => window.ram.focus(rows[0].id)),
        });
      }
      items.push({
        type: "item",
        label: n > 1 ? "Close selected clients" : "Close",
        onClick: () => {
          void (async () => {
            for (const row of rows.filter((a) => a.running)) {
              await window.ram.close(row.id);
            }
          })();
        },
      });
    }
    items.push({ type: "sep" });
    items.push({ type: "item", label: "Add label", children: addChildren });
    if (removeChildren.length) {
      items.push({ type: "item", label: "Remove label", children: removeChildren });
    }
    items.push({ type: "sep" });
    if (anyActive) {
      items.push({
        type: "item",
        label: n > 1 ? "Set Inactive" : "Set Inactive",
        onClick: () => void setInactiveFor(ids, true),
      });
    }
    if (anyInactive) {
      items.push({
        type: "item",
        label: "Set Active",
        onClick: () => void setInactiveFor(ids, false),
      });
    }
    items.push({ type: "sep" });
    items.push({
      type: "item",
      label: n > 1 ? `Remove ${n} accounts` : "Remove",
      danger: true,
      onClick: () => setRemoveIds(ids),
    });
    return items;
  };

  const endTour = async () => {
    setTourOpen(false);
    const next = await window.ram.setSettings({ tutorialDone: true });
    setSettings(next);
  };

  const removePreview = removeIds
    ? removeIds.map((id) => accounts.find((a) => a.id === id)?.username || id)
    : [];

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
              if (update?.status === "ready") {
                const next = await window.ram.installUpdate();
                setUpdate(next);
                show(next.message);
                return;
              }
              if (update?.status === "available") {
                const next = await window.ram.downloadUpdate();
                setUpdate(next);
                show(next.message);
                return;
              }
              if (update?.status === "downloading") {
                return;
              }
              setUpdate((prev) =>
                prev
                  ? { ...prev, status: "checking", message: "Checking GitHub…" }
                  : prev,
              );
              const checked = await window.ram.checkUpdates();
              setUpdate(checked);
              if (checked.status === "available") {
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
        <button
          type="button"
          className="icon-btn"
          data-tour="help"
          aria-label="Tutorial"
          onClick={() => {
            setTourSkip(true);
            setTourOpen(true);
          }}
        >
          <IconInfo />
        </button>
        <button
          type="button"
          className="icon-btn"
          data-tour="settings"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <IconGear />
        </button>
        <button
          type="button"
          className="icon-btn primary"
          data-tour="add-account"
          aria-label="Add account"
          onClick={() => setAddOpen(true)}
        >
          <IconAddUser />
        </button>
        <TitleBarControls />
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
          onNewLabel={() => setNewLabelFor([])}
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
              <button className="btn" onClick={() => setSelectedIds([])}>
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
          <div
            className="cards-stage"
            data-tour="cards"
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest(".card")) {
                return;
              }
              setSelectedIds([]);
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {accounts.length === 0 ? (
              <div className="empty">
                <h3>No accounts yet</h3>
                <p>Add one with a session cookie, Roblox login, signup, or quick add.</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="empty">
                <h3>{showInactive ? "No inactive accounts" : "Nothing matches"}</h3>
                <p>
                  {showInactive
                    ? "Mark a card Inactive to hide it from the main list. Click Show Inactive alone to see all of them."
                    : "Clear labels or pick different ones. Inactive accounts stay hidden until you click Show Inactive."}
                </p>
              </div>
            ) : (
              <div className="grid">
                {visible.map((a) => (
                  <AccountCard
                    key={a.id}
                    account={a}
                    labels={labels}
                    busy={busyId === a.id || busyId === "__many__"}
                    selected={selectedIds.includes(a.id)}
                    error={cardErrors[a.id]}
                    onPick={(e) => pick(a.id, e)}
                    onContextMenu={(e) => openMenu(a.id, e)}
                    onLaunch={() => run(a.id, () => window.ram.launch(a.id), true)}
                    onFocus={() => run(a.id, () => window.ram.focus(a.id))}
                    onClose={() => run(a.id, () => window.ram.close(a.id))}
                  />
                ))}
              </div>
            )}
          </div>
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
            setTourSkip(true);
            setTourOpen(true);
          }}
        />
      )}
      {newLabelFor && (
        <NewLabelModal
          onClose={() => setNewLabelFor(null)}
          onCreate={(name, color) => void createLabel(name, color, newLabelFor)}
        />
      )}
      {removeIds && (
        <ConfirmDialog
          title={removeIds.length > 1 ? `Remove ${removeIds.length} accounts?` : "Remove this account?"}
          body={
            removeIds.length > 1
              ? `Remove ${removePreview.map((n) => `@${n}`).join(", ")} from Account Manager? Saved sessions are deleted from this PC.`
              : `Remove @${removePreview[0] || ""} from Account Manager? The saved session is deleted from this PC. You can add it again later.`
          }
          confirmLabel="Remove"
          danger
          onCancel={() => setRemoveIds(null)}
          onConfirm={() => {
            const ids = removeIds;
            setRemoveIds(null);
            setSelectedIds((prev) => prev.filter((x) => !ids.includes(x)));
            void (async () => {
              for (const id of ids) {
                await run(id, () => window.ram.remove(id));
              }
            })();
          }}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.ids)} onClose={() => setMenu(null)} />}
      {tourOpen && <Tutorial allowSkip={tourSkip} onEnd={() => void endTour()} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
