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
  error?: string | null;
  onSelect: (on: boolean) => void;
  onLaunch: () => void;
  onFocus: () => void;
  onClose: () => void;
  onRemove: () => void;
  onToggleLabel: (labelId: string) => void;
  onToggleInactive: () => void;
}) {
  const { account: a, busy, error, labels, selected } = props;
  const initial = (a.displayName || a.username || "?").slice(0, 1).toUpperCase();
  return (
    <article className={`card${a.running ? " running" : ""}${selected ? " picked" : ""}`}>
      <div className="card-head">
        <label className="pick attach" title="Select for multi-launch">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => props.onSelect(e.target.checked)}
          />
        </label>
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
        {labels.map((label) => {
          const on = a.labelIds.includes(label.id);
          return (
            <button
              key={label.id}
              type="button"
              className={`chip${on ? " on" : ""}`}
              style={
                on
                  ? { borderColor: label.color, background: `${label.color}22`, color: label.color }
                  : undefined
              }
              onClick={() => props.onToggleLabel(label.id)}
            >
              <span className="dot" style={{ background: label.color }} />
              {label.name}
            </button>
          );
        })}
      </div>
      <div className="meta">{formatWhen(a.lastLoginAt)}</div>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {a.running ? (
          <>
            <button className="btn primary" disabled={busy} onClick={props.onFocus}>
              Focus
            </button>
            <button className="btn" disabled={busy} onClick={props.onClose}>
              Close
            </button>
          </>
        ) : (
          <button className="btn primary" disabled={busy} onClick={props.onLaunch}>
            Launch
          </button>
        )}
        <button className="btn" disabled={busy} onClick={props.onToggleInactive}>
          {a.inactive ? "Set Active" : "Set Inactive"}
        </button>
        <button className="btn danger" disabled={busy} onClick={props.onRemove}>
          Remove
        </button>
      </div>
    </article>
  );
}
