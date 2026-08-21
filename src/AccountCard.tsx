import type { AccountPublic } from "../shared/types";

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
  busy: boolean;
  error?: string | null;
  onLaunch: () => void;
  onFocus: () => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  const { account: a, busy, error } = props;
  const initial = (a.displayName || a.username || "?").slice(0, 1).toUpperCase();
  return (
    <article className={`card${a.running ? " running" : ""}`}>
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
          </div>
          <div className="tag">@{a.username}</div>
        </div>
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
        <button className="btn danger" disabled={busy} onClick={props.onRemove}>
          Remove
        </button>
      </div>
    </article>
  );
}
