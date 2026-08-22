import { useState } from "react";
import { LABEL_SWATCHES } from "../shared/types";

export default function NewLabelModal(props: {
  onClose: () => void;
  onCreate: (name: string, color: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_SWATCHES[2]);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    props.onCreate(trimmed, color);
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="modal modal-sm" onMouseDown={(e) => e.stopPropagation()}>
        <h2>New label</h2>
        <label>Name</label>
        <input
          value={name}
          autoFocus
          placeholder="e.g. Ban, Farm, Main"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              save();
            }
            if (e.key === "Escape") {
              props.onClose();
            }
          }}
        />
        <label>Color</label>
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
        <div className="row-actions">
          <button className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>
            Create label
          </button>
        </div>
      </div>
    </div>
  );
}
