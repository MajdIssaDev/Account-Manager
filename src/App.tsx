import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import type { AccountPublic, AppSettings, UpdateState } from "../shared/types";
import { DEFAULT_LABELS } from "../shared/types";
import AddAccountModal from "./AddAccountModal";
import HiveButModal from "./HiveButModal";
import SettingsModal from "./SettingsModal";
import AccountCard from "./AccountCard";
import ConfirmDialog from "./ConfirmDialog";
import LabelSidebar from "./LabelSidebar";
import Tutorial from "./Tutorial";
import TitleBarControls from "./TitleBarControls";
import ContextMenu, { type CtxItem } from "./ContextMenu";
import NewLabelModal from "./NewLabelModal";
import HivePanel from "./HivePanel";
import { HiveStoreProvider, patchAccountsHiveStatus } from "./hiveStore";
import { DebugMonitorShell } from "./DebugMonitorShell";
import { IconAddUser, IconGear, IconInfo, IconStop } from "./icons";

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
  const [launchBusyIds, setLaunchBusyIds] = useState<string[]>([]);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [filterLabels, setFilterLabels] = useState<string[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [removeIds, setRemoveIds] = useState<string[] | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourSkip, setTourSkip] = useState(true);
  const skipPickRef = useRef(false);
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [newLabelFor, setNewLabelFor] = useState<string[] | null>(null);
  const [hiveOpen, setHiveOpen] = useState(false);
  const [hiveButKind, setHiveButKind] = useState<"sell" | "eat" | null>(null);

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
    void window.ram.getLaunchBusy().then(setLaunchBusyIds);
    const offA = window.ram.onAccountsChanged(setAccounts);
    const offHiveLive = window.ram.onHiveLivenessChanged((deltas) => {
      setAccounts((prev) => patchAccountsHiveStatus(prev, deltas));
    });
    const offS = window.ram.onSettingsChanged((s) => {
      setSettings(s);
      applyTheme(s.themeId);
    });
    const offT = window.ram.onToast((msg) => {
      setToast(msg);
      window.setTimeout(() => setToast(null), 5000);
    });
    const offU = window.ram.onUpdateState(setUpdate);
    const offL = window.ram.onLaunchBusy(setLaunchBusyIds);
    return () => {
      offA();
      offHiveLive();
      offS();
      offT();
      offU();
      offL();
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

  const queueBusy = launchBusyIds.length > 0;
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
    return [...filtered].sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        (a.displayName || a.username).localeCompare(b.displayName || b.username),
    );
  }, [accounts, filterLabels, showInactive]);

  const selectedVisible = selectedIds.filter((id) => visible.some((a) => a.id === id));
  const selectedConnected = useMemo(
    () => visible.filter((a) => selectedIds.includes(a.id) && a.hiveStatus === "connected"),
    [visible, selectedIds],
  );
  const chip = updateChip(update);

  const [dragIds, setDragIds] = useState<string[] | null>(null);
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null);
  const [floatSize, setFloatSize] = useState<{ w: number; h: number } | null>(null);
  const dragMoved = useRef(false);
  const dragStart = useRef<{ x: number; y: number; id: string } | null>(null);
  const dragIdsRef = useRef<string[] | null>(null);
  const previewRef = useRef<string[] | null>(null);
  const floatOffset = useRef({ x: 0, y: 0 });
  const floatElRef = useRef<HTMLDivElement>(null);
  const previewRaf = useRef(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(visible);
  const accountsRef = useRef(accounts);
  const selectedRef = useRef(selectedIds);
  visibleRef.current = visible;
  accountsRef.current = accounts;
  selectedRef.current = selectedIds;

  const displayList = useMemo(() => {
    const order = previewOrder || visible.map((a) => a.id);
    const byId = new Map(visible.map((a) => [a.id, a]));
    return order.map((id) => byId.get(id)).filter(Boolean) as AccountPublic[];
  }, [visible, previewOrder]);

  const idleByLabel = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const label of labels) {
      counts[label.id] = accounts.filter(
        (a) => !a.inactive && !a.running && a.labelIds.includes(label.id),
      ).length;
    }
    return counts;
  }, [accounts, labels]);

  const connectedByLabel = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const label of labels) {
      counts[label.id] = visible.filter(
        (a) => a.hiveStatus === "connected" && a.labelIds.includes(label.id),
      ).length;
    }
    return counts;
  }, [visible, labels]);

  const runningVisibleCount = useMemo(() => visible.filter((a) => a.running).length, [visible]);

  const selectLabelAccounts = (labelId: string) => {
    const ids = visible.filter((a) => a.labelIds.includes(labelId)).map((a) => a.id);
    setSelectedIds(ids);
    if (ids.length > 0) {
      setAnchorId(ids[0]);
    }
  };

  const openHiveForLabel = (labelId: string) => {
    const ids = visible
      .filter((a) => a.hiveStatus === "connected" && a.labelIds.includes(labelId))
      .map((a) => a.id);
    if (!ids.length) {
      show(`No hive-connected accounts with that label.`);
      return;
    }
    setSelectedIds(ids);
    setAnchorId(ids[0]);
    setHiveOpen(true);
  };

  const selectRunning = () => {
    const ids = visible.filter((a) => a.running).map((a) => a.id);
    setSelectedIds(ids);
    if (ids.length > 0) {
      setAnchorId(ids[0]);
    }
  };

  const launchLabel = (labelId: string) => {
    const label = labels.find((row) => row.id === labelId);
    const ids = accounts
      .filter((a) => !a.inactive && !a.running && a.labelIds.includes(labelId))
      .map((a) => a.id);
    if (!ids.length) {
      show(`No idle ${label?.name || "labeled"} accounts to launch.`);
      return;
    }
    void run("__many__", () => window.ram.launchMany(ids), false);
  };

  const pick = (id: string, e: MouseEvent) => {
    if (e.button !== 0 || skipPickRef.current) {
      return;
    }
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
    skipPickRef.current = true;
    window.setTimeout(() => {
      skipPickRef.current = false;
    }, 400);
    const ids = selectedIds.includes(id) && selectedIds.length > 0 ? selectedIds : [id];
    setMenu({ x: e.clientX, y: e.clientY, ids });
  };

  const contiguousBlockFor = (id: string): string[] | null => {
    const order = visibleRef.current.map((a) => a.id);
    const selected = selectedRef.current.filter((x) => order.includes(x));
    if (selected.includes(id) && selected.length > 1) {
      const idxs = selected.map((x) => order.indexOf(x)).sort((a, b) => a - b);
      const contiguous = idxs.every((v, i) => i === 0 || v === idxs[i - 1] + 1);
      if (contiguous) {
        return idxs.map((i) => order[i]);
      }
      return null;
    }
    return [id];
  };

  const buildPreview = (block: string[], clientX: number, clientY: number): string[] => {
    const visIds = visibleRef.current.map((a) => a.id);
    const without = visIds.filter((id) => !block.includes(id));
    if (!without.length) {
      return [...block];
    }
    const grid = gridRef.current;
    let insertAt = without.length;
    if (grid) {
      const slots = Array.from(grid.querySelectorAll<HTMLElement>("[data-slot-id]"));
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < slots.length; i++) {
        const id = slots[i].dataset.slotId;
        if (!id || block.includes(id)) {
          continue;
        }
        const r = slots[i].getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = Math.hypot(clientX - cx, clientY - cy);
        if (d < best) {
          best = d;
          const idx = without.indexOf(id);
          if (idx < 0) {
            continue;
          }
          insertAt = clientX < cx || (Math.abs(clientX - cx) < 12 && clientY < cy) ? idx : idx + 1;
        }
      }
      if (slots.length === 0) {
        insertAt = 0;
      }
    }
    insertAt = Math.max(0, Math.min(without.length, insertAt));
    const next = [...without];
    next.splice(insertAt, 0, ...block);
    return next;
  };

  const startCardPointer = (id: string, e: PointerEvent) => {
    if (e.button !== 0 || e.ctrlKey || e.shiftKey) {
      return;
    }
    if ((e.target as HTMLElement).closest("button, .actions, .card-x")) {
      return;
    }
    dragMoved.current = false;
    const card = (e.currentTarget as HTMLElement).closest(".card") as HTMLElement | null;
    const rect = card?.getBoundingClientRect();
    floatOffset.current = rect
      ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
      : { x: 40, y: 24 };
    if (rect) {
      setFloatSize({ w: rect.width, h: rect.height });
    }
    dragStart.current = { x: e.clientX, y: e.clientY, id };
  };

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || !previewOrder) {
      return;
    }
    const nodes = Array.from(grid.querySelectorAll<HTMLElement>("[data-slot-id]"));
    const first = new Map<string, DOMRect>();
    for (const node of nodes) {
      const id = node.dataset.slotId;
      if (id) {
        first.set(id, node.getBoundingClientRect());
      }
    }
    return () => {
      for (const node of Array.from(grid.querySelectorAll<HTMLElement>("[data-slot-id]"))) {
        const id = node.dataset.slotId;
        if (!id) {
          continue;
        }
        const prev = first.get(id);
        if (!prev) {
          continue;
        }
        const next = node.getBoundingClientRect();
        const dx = prev.left - next.left;
        const dy = prev.top - next.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
          continue;
        }
        node.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
          { duration: 160, easing: "ease-out" },
        );
      }
    };
  }, [previewOrder]);

  useEffect(() => {
    const onMove = (e: globalThis.PointerEvent) => {
      const start = dragStart.current;
      if (!start) {
        return;
      }
      const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      let moving = dragIdsRef.current;
      if (!moving) {
        if (dist < 8) {
          return;
        }
        const block = contiguousBlockFor(start.id);
        if (!block) {
          dragStart.current = null;
          show("Select cards that sit next to each other to drag them together.");
          return;
        }
        dragMoved.current = true;
        skipPickRef.current = true;
        moving = block;
        dragIdsRef.current = block;
        setDragIds(block);
        const fx = e.clientX - floatOffset.current.x;
        const fy = e.clientY - floatOffset.current.y;
        window.requestAnimationFrame(() => {
          if (floatElRef.current) {
            floatElRef.current.style.transform = `translate3d(${fx}px, ${fy}px, 0)`;
          }
        });
        if (!selectedRef.current.includes(start.id) || selectedRef.current.length === 1) {
          setSelectedIds(block);
          setAnchorId(start.id);
        }
      }
      const nextOrder = buildPreview(moving, e.clientX, e.clientY);
      previewRef.current = nextOrder;
      const fx = e.clientX - floatOffset.current.x;
      const fy = e.clientY - floatOffset.current.y;
      if (floatElRef.current) {
        floatElRef.current.style.transform = `translate3d(${fx}px, ${fy}px, 0)`;
      }
      if (!previewRaf.current) {
        previewRaf.current = window.requestAnimationFrame(() => {
          previewRaf.current = 0;
          if (previewRef.current) {
            setPreviewOrder([...previewRef.current]);
          }
        });
      }
    };

    const onUp = () => {
      const start = dragStart.current;
      const moving = dragIdsRef.current;
      const order = previewRef.current;
      const didMove = dragMoved.current;
      dragStart.current = null;
      dragIdsRef.current = null;
      previewRef.current = null;
      if (previewRaf.current) {
        window.cancelAnimationFrame(previewRaf.current);
        previewRaf.current = 0;
      }
      setDragIds(null);
      setPreviewOrder(null);
      setFloatSize(null);
      if (!start || !moving || !didMove || !order) {
        return;
      }
      window.setTimeout(() => {
        skipPickRef.current = false;
      }, 50);
      void (async () => {
        const visIds = visibleRef.current.map((a) => a.id);
        const same =
          order.length === visIds.length && order.every((id, i) => id === visIds[i]);
        if (same) {
          return;
        }
        const allIds = [...accountsRef.current]
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
          .map((a) => a.id);
        const visSet = new Set(visIds);
        let vi = 0;
        const nextAll = allIds.map((id) => (visSet.has(id) ? order[vi++] : id));
        const res = await window.ram.reorderAccounts(nextAll);
        if (!res.ok && res.error) {
          show(res.error);
        }
      })();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

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
        keepOpen: true,
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
        keepOpen: true,
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
    <HiveStoreProvider>
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
          aria-label="Close all Roblox"
          title="Close all Roblox"
          disabled={busyId === "__many__" || queueBusy}
          onClick={() =>
            void run(
              "__many__",
              async () => {
                const res = await window.ram.closeAll();
                if (res.ok) {
                  const n = res.data?.closed ?? 0;
                  show(n ? `Closed ${n} Roblox client${n === 1 ? "" : "s"}.` : "No Roblox clients were running.");
                }
                return res;
              },
              false,
            )
          }
        >
          <IconStop />
        </button>
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
          className="btn hive-head-btn"
          data-tour="hive"
          disabled={selectedConnected.length === 0}
          title={selectedConnected.length === 0 ? "Select connected hive clients" : "Hive control"}
          onClick={() => setHiveOpen(true)}
        >
          Hive{selectedConnected.length > 0 ? ` (${selectedConnected.length})` : ""}
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
          idleByLabel={idleByLabel}
          connectedByLabel={connectedByLabel}
          launchBusy={busyId === "__many__" || queueBusy}
          runningCount={runningVisibleCount}
          onToggleLabel={(id) =>
            setFilterLabels((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
          }
          onToggleInactive={() => setShowInactive((v) => !v)}
          onLaunchLabel={(id) => void launchLabel(id)}
          onSelectLabel={selectLabelAccounts}
          onHiveLabel={openHiveForLabel}
          onSelectRunning={selectRunning}
          onNewLabel={() => setNewLabelFor([])}
          onUpdate={(id, patch) => void window.ram.updateLabel(id, patch)}
          onDelete={(id) => void window.ram.deleteLabel(id)}
        />
        <div className="main">
          <div
            className={`cards-stage${selectedVisible.length > 0 || tourOpen ? " has-launch-bar" : ""}`}
            data-tour="cards"
            onMouseDown={(e) => {
              if (e.button !== 0) {
                return;
              }
              if ((e.target as HTMLElement).closest(".card, .launch-bar")) {
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
              <div className={`grid${dragIds ? " dragging-grid" : ""}`} ref={gridRef}>
                {displayList.map((a) => {
                  const isLifted = Boolean(dragIds?.includes(a.id));
                  if (isLifted) {
                    return (
                      <div
                        key={a.id}
                        className="card-slot"
                        data-slot-id={a.id}
                        style={floatSize ? { minHeight: floatSize.h } : undefined}
                      />
                    );
                  }
                  return (
                    <AccountCard
                      key={a.id}
                      account={a}
                      labels={labels}
                      busy={busyId === a.id || busyId === "__many__" || launchBusyIds.includes(a.id)}
                      selected={selectedIds.includes(a.id)}
                      error={cardErrors[a.id]}
                      onPick={(e) => pick(a.id, e)}
                      onPointerDown={(e) => startCardPointer(a.id, e)}
                      onContextMenu={(e) => openMenu(a.id, e)}
                      onLaunch={() => run(a.id, () => window.ram.launch(a.id), true)}
                      onSetActive={() => void setInactiveFor([a.id], false)}
                      onFocus={() => run(a.id, () => window.ram.focus(a.id))}
                      onClose={() => run(a.id, () => window.ram.close(a.id))}
                      onRemove={() => setRemoveIds([a.id])}
                    />
                  );
                })}
              </div>
            )}
          </div>
          {dragIds && floatSize ? (
            <div
              className="drag-float"
              ref={floatElRef}
              style={{
                width: floatSize.w,
                transform: "translate3d(-9999px, -9999px, 0)",
              }}
            >
              {dragIds.map((id, i) => {
                const a = visible.find((row) => row.id === id) || accounts.find((row) => row.id === id);
                if (!a) {
                  return null;
                }
                return (
                  <div
                    key={id}
                    className="drag-float-item"
                    style={{ transform: `translate(${i * 6}px, ${i * 6}px)` }}
                  >
                    <AccountCard
                      account={a}
                      labels={labels}
                      busy={false}
                      selected
                      floating
                      error={null}
                      onPick={() => undefined}
                      onPointerDown={() => undefined}
                      onContextMenu={() => undefined}
                      onLaunch={() => undefined}
                      onSetActive={() => undefined}
                      onFocus={() => undefined}
                      onClose={() => undefined}
                      onRemove={() => undefined}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}
          {selectedVisible.length > 0 || tourOpen ? (
            <div className="launch-bar" data-tour="launch-selected">
              <span>
                {selectedVisible.length} selected
                {showInactive ? " · inactive view" : ""}
              </span>
              <button className="btn" onClick={() => setSelectedIds([])}>
                Clear
              </button>
              <button className="btn" disabled={runningVisibleCount === 0} onClick={selectRunning}>
                Select running
              </button>
              <button
                className="btn primary"
                disabled={busyId === "__many__" || queueBusy || selectedVisible.length === 0}
                onClick={() =>
                  run("__many__", () => window.ram.launchMany(selectedVisible), false)
                }
              >
                Launch selected
              </button>
              <button
                className="btn"
                disabled={selectedConnected.length === 0}
                onClick={() => setHiveOpen(true)}
              >
                Hive
              </button>
              <button
                className="btn"
                disabled={selectedConnected.length === 0}
                onClick={() => setHiveButKind("sell")}
              >
                Sell all…
              </button>
              <button
                className="btn"
                disabled={selectedConnected.length === 0}
                onClick={() => setHiveButKind("eat")}
              >
                Eat all…
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {addOpen && <AddAccountModal onClose={() => setAddOpen(false)} />}
      {settingsOpen && settings && (
        <SettingsModal
          settings={settings}
          update={update}
          onClose={() => setSettingsOpen(false)}
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
      {hiveOpen ? (
        <HivePanel
          accounts={accounts}
          selectedIds={selectedIds}
          onClose={() => setHiveOpen(false)}
          onToast={show}
        />
      ) : null}
      {hiveButKind ? (
        <HiveButModal
          kind={hiveButKind}
          accounts={selectedConnected}
          onClose={() => setHiveButKind(null)}
          onDone={(summary) => {
            show(summary);
            setHiveButKind(null);
          }}
        />
      ) : null}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.ids)} onClose={() => setMenu(null)} />}
      {tourOpen && <Tutorial allowSkip={tourSkip} onEnd={() => void endTour()} />}
      {toast && <div className="toast">{toast}</div>}
      <DebugMonitorShell />
    </div>
    </HiveStoreProvider>
  );
}
