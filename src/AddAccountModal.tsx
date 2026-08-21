import { useState } from "react";
import type { LoginMode } from "../shared/types";

type Tab = "paste" | "login" | "signup" | "quick";

export default function AddAccountModal(props: {
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("paste");
  const [cookie, setCookie] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openWeb = async (mode: LoginMode) => {
    setBusy(true);
    setError(null);
    const creds =
      mode === "quick" ? { username: username.trim(), password } : undefined;
    if (mode === "quick" && (!creds?.username || !creds.password)) {
      setBusy(false);
      setError("Enter username and password for quick add.");
      return;
    }
    const res = await window.ram.openLogin(mode, creds);
    setBusy(false);
    if (res.ok) {
      props.onClose();
      return;
    }
    if (res.error && res.error !== "Add account cancelled.") {
      setError(res.error);
    } else {
      props.onClose();
    }
  };

  const paste = async () => {
    setBusy(true);
    setError(null);
    const res = await window.ram.addCookie(cookie);
    setBusy(false);
    if (res.ok) {
      props.onClose();
      return;
    }
    setError(res.error || "Could not add that session.");
  };

  return (
    <div className="overlay" onMouseDown={() => { if (!busy) props.onClose(); }}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Add account</h2>
        <p>
          Session cookies stay in the main process (encrypted on this PC). Captcha and 2FA stay
          in the Roblox page — this app does not solve them.
        </p>
        <div className="tabs">
          {(["paste", "login", "signup", "quick"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`btn ${tab === t ? "active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "paste" ? "Paste session" : t === "quick" ? "Quick add" : t === "signup" ? "Sign up" : "Log in"}
            </button>
          ))}
        </div>

        {tab === "paste" && (
          <>
            <label>.ROBLOSECURITY</label>
            <textarea
              rows={5}
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder="Paste the cookie value only"
            />
          </>
        )}

        {tab === "login" && (
          <p className="hint">
            Opens an isolated Roblox login page. When the session cookie appears, the card is added.
          </p>
        )}

        {tab === "signup" && (
          <p className="hint">
            Opens the official Roblox signup page only. You will almost always need to complete captcha there.
          </p>
        )}

        {tab === "quick" && (
          <>
            <p className="hint">
              Fills the official login page. If Roblox challenges you, finish it in the window.
            </p>
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        )}

        {error && <p className="error">{error}</p>}
        <div className="row-actions">
          <button className="btn" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          {tab === "paste" && (
            <button className="btn primary" disabled={busy || !cookie.trim()} onClick={() => void paste()}>
              Add
            </button>
          )}
          {tab === "login" && (
            <button className="btn primary" disabled={busy} onClick={() => void openWeb("login")}>
              Open login
            </button>
          )}
          {tab === "signup" && (
            <button className="btn primary" disabled={busy} onClick={() => void openWeb("signup")}>
              Open signup
            </button>
          )}
          {tab === "quick" && (
            <button className="btn primary" disabled={busy} onClick={() => void openWeb("quick")}>
              Quick add
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
