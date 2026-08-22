export default function ConfirmDialog(props: {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div className="modal modal-sm" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{props.title}</h2>
        <p className="hint">{props.body}</p>
        <div className="row-actions">
          <button className="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            className={`btn ${props.danger ? "danger" : "primary"}`}
            onClick={props.onConfirm}
          >
            {props.confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
