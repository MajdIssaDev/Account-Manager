import { useState } from "react";
import type { AccountLabel } from "../shared/types";
import { LABEL_SWATCHES } from "../shared/types";

export default function LabelSidebar(props: {
  labels: AccountLabel[];
  selectedIds: string[];
  showInactive: boolean;
  onToggleLabel: (id: string) => void;
  onToggleInactive: () => void;
  onCreate: (name: string, color: string) => void;
  onUpdate: (id: string, patch: { name?: string; color?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_SWATCHES[2]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    props.onCreate(trimmed, color);
    setName("");
  };

  return (
    <aside className="sidebar" data-tour="labels">
      <div className="sidebar-head">
        <h2>Labels</h2>
        <p>Multi-select uses OR — any matching label is shown.</p>
      </div>
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
      <div className="new-label" data-tour="create-label">
        <label>New label</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              add();
            }
          }}
        />
        <div className="swatches">
          {LABEL_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch${color === c ? " on" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            title="Custom color"
          />
        </div>
        <button className="btn primary" disabled={!name.trim()} onClick={add}>
          Add label
        </button>
      </div>
    </aside>
  );
}
