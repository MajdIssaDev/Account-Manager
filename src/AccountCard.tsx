import type { MouseEvent, PointerEvent } from "react";
import type { AccountLabel, AccountPublic } from "../shared/types";

function formatWhen(iso: string | null): string {
  if (!iso) {
    return "Never launched";
  }
  try {
    return `Last launched ${new Date(iso).toLocaleString()}`;
  } catch {
    return "Last launched unknown";
  }
}

export default function AccountCard(props: {
  account: AccountPublic;
  labels: AccountLabel[];
  busy: boolean;
  selected: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  error?: string | null;
  onPick: (e: MouseEvent) => void;
  onContextMenu: (e: MouseEvent) => void;
  onPointerDown: (e: PointerEvent) => void;
  onLaunch: () => void;
  onSetActive: () => void;
  onFocus: () => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  const { account: a, busy, error, labels, selected } = props;
  const initial = (a.displayName || a.username || "?").slice(0, 1).toUpperCase();
  const assigned = labels.filter((label) => a.labelIds.includes(label.id));
  return (
    <article
      className={`card${a.running ? " running" : ""}${selected ? " picked" : ""}${props.dragging ? " dragging" : ""}${props.dropTarget ? " drop-target" : ""}`}
      data-account-id={a.id}
      onClick={(e) => {
        if (e.button !== 0) {
          return;
        }
        props.onPick(e);
      }}
      onPointerDown={props.onPointerDown}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onContextMenu(e);
      }}
      onAuxClick={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="card-x"
        title="Remove"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          props.onRemove();
        }}
        onContextMenu={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        ×
      </button>
      <div className="card-head">
        {a.avatarUrl ? (
          <img className="avatar" src={a.avatarUrl} alt="" />
        ) : (
          <div className="avatar ph">{initial}</div>
        )}
        <div className="names">
          <div className="display">
            <span>{a.displayName}</span>
            {a.running && <span className="badge">running</span>}
            {a.inactive && <span className="badge inactive">inactive</span>}
          </div>
          <div className="tag">@{a.username}</div>
        </div>
      </div>
      <div className="card-labels">
        {assigned.map((label) => (
          <span
            key={label.id}
            className="chip on"
            style={{ borderColor: label.color, background: `${label.color}22`, color: label.color }}
          >
            <span className="dot" style={{ background: label.color }} />
            {label.name}
          </span>
        ))}
      </div>
      <div className="meta">{formatWhen(a.lastLoginAt)}</div>
      {error && <p className="error">{error}</p>}
      <div className="actions" onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        {a.running ? (
          <>
            <button className="btn primary" disabled={busy} onClick={props.onFocus}>
              Focus
            </button>
            <button className="btn" disabled={busy} onClick={props.onClose}>
              Close
            </button>
          </>
        ) : a.inactive ? (
          <button className="btn primary" disabled={busy} onClick={props.onSetActive}>
            Set Active
          </button>
        ) : (
          <button className="btn primary" disabled={busy} onClick={props.onLaunch}>
            Launch
          </button>
        )}
      </div>
    </article>
  );
}
