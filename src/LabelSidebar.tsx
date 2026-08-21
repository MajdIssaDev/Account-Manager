import { useState } from "react";
import type { AccountLabel } from "../shared/types";
import { LABEL_SWATCHES } from "../shared/types";

export default function LabelSidebar(props: {
  labels: AccountLabel[];
  selectedIds: string[];
  showInactive: boolean;
  onToggleLabel: (id: string) => void;
  onToggleInactive: () => void;
  onNewLabel: () => void;
  onUpdate: (id: string, patch: { name?: string; color?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  return (
    <aside className="sidebar" data-tour="labels">
      <div className="sidebar-head">
        <h2>Labels</h2>
        <button
          type="button"
          className="sidebar-add"
          data-tour="create-label"
          title="New label"
          onClick={props.onNewLabel}
        >
          +
        </button>
      </div>
      <p className="sidebar-hint">Multi-select uses OR — any matching label is shown.</p>
      <div className="label-list">
        {props.labels.map((label) => {
          const on = props.selectedIds.includes(label.id);
          const isEdit = editing === label.id;
          return (
            <div key={label.id} className={`label-row${on ? " on" : ""}`}>
              <button
                type="button"
                className="label-swatch"
                style={{ background: label.color }}
                title="Change color"
                onClick={() => {
                  const idx = LABEL_SWATCHES.indexOf(label.color.toLowerCase());
                  const next = LABEL_SWATCHES[(idx + 1) % LABEL_SWATCHES.length];
                  props.onUpdate(label.id, { color: next });
                }}
              />
              {isEdit ? (
                <input
                  className="label-rename"
                  value={editName}
                  autoFocus
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => {
                    if (editName.trim()) {
                      props.onUpdate(label.id, { name: editName.trim() });
                    }
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      (e.target as HTMLInputElement).blur();
                    }
                    if (e.key === "Escape") {
                      setEditing(null);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="label-name"
                  onClick={() => props.onToggleLabel(label.id)}
                  onDoubleClick={() => {
                    setEditing(label.id);
                    setEditName(label.name);
                  }}
                >
                  {label.name}
                </button>
              )}
              {!label.builtin && (
                <button
                  type="button"
                  className="label-x"
                  title="Delete label"
                  onClick={() => props.onDelete(label.id)}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className={`inactive-toggle${props.showInactive ? " on" : ""}`}
        data-tour="inactive"
        onClick={props.onToggleInactive}
      >
        Show Inactive
      </button>
      <p className="sidebar-hint">Click Inactive alone to list every hidden account.</p>
    </aside>
  );
}
