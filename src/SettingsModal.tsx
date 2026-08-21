import { useState } from "react";
import type { AppSettings, UpdateState } from "../shared/types";
import { GITHUB_LATEST_RELEASE_URL, GITHUB_REPO_SLUG } from "../shared/github";

export default function SettingsModal(props: {
  settings: AppSettings;
  update: UpdateState | null;
  onClose: () => void;
  onSaved: (s: AppSettings) => void;
}) {
  const [robloxPlayerPath, setPath] = useState(props.settings.robloxPlayerPath);
  const [attachOnLaunch, setAttach] = useState(props.settings.attachOnLaunch);
  const [names, setNames] = useState(props.settings.potassiumProcessNames.join(", "));
  const [attachCommand, setCmd] = useState(props.settings.attachCommand);
  const [autoCheckUpdates, setAutoCheck] = useState(props.settings.autoCheckUpdates);
  const [autoDownloadUpdates, setAutoDownload] = useState(props.settings.autoDownloadUpdates);
  const [githubToken, setToken] = useState(props.settings.githubToken);
  const [status, setStatus] = useState<string>("");
  const [checking, setChecking] = useState(false);

  const save = async () => {
    const next = await window.ram.setSettings({
      robloxPlayerPath: robloxPlayerPath.trim(),
      attachOnLaunch,
      potassiumProcessNames: names.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean),
      attachCommand: attachCommand.trim(),
      autoCheckUpdates,
      autoDownloadUpdates,
      githubToken: githubToken.trim(),
    });
    props.onSaved(next);
    props.onClose();
  };

  const update = props.update;

  return (
    <div className="overlay" onMouseDown={props.onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <label>Roblox Player path (optional)</label>
        <input
          value={robloxPlayerPath}
          onChange={(e) => setPath(e.target.value)}
          placeholder="%LOCALAPPDATA%\Roblox\Versions\...\RobloxPlayerBeta.exe"
        />
        <label className="attach attach-block">
          <input
            type="checkbox"
            checked={attachOnLaunch}
            onChange={(e) => setAttach(e.target.checked)}
          />
          Attach Potassium on launch if Potassium is running
        </label>
        <label>Potassium process names</label>
        <input
          value={names}
          onChange={(e) => setNames(e.target.value)}
          placeholder="Potassium.exe"
        />
        <label>Attach command</label>
        <input
          value={attachCommand}
          onChange={(e) => setCmd(e.target.value)}
          placeholder={`"C:\\Path\\to\\potassium.exe" --attach {pid}`}
        />
        <p className="hint">Placeholders: {"{pid}"} and {"{account}"}.</p>

        <h2 className="modal-section">Updates</h2>
        <p className="hint">
          This build is <strong>v{update?.currentVersion || "…"}</strong>
          {update?.latestVersion ? ` · GitHub latest v${update.latestVersion}` : ""}.
          {" "}Version checks use the private GitHub repo <code>{GITHUB_REPO_SLUG}</code>.
          {" "}{update?.message}
        </p>
        <label className="attach">
          <input
            type="checkbox"
            checked={autoCheckUpdates}
            onChange={(e) => setAutoCheck(e.target.checked)}
          />
          Check GitHub for updates when the app starts
        </label>
        <label className="attach">
          <input
            type="checkbox"
            checked={autoDownloadUpdates}
            onChange={(e) => setAutoDownload(e.target.checked)}
          />
          Download updates automatically (installed app only)
        </label>
        <label>GitHub token (optional)</label>
        <input
          type="password"
          value={githubToken}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Fine-grained token with Contents: Read on this repo"
        />
        <p className="hint">
          Needed for in-app checks against this private repo. Invited people can also install from
          GitHub Releases: {GITHUB_LATEST_RELEASE_URL}
        </p>
        {update?.status === "downloading" && (
          <div className="progress">
            <div className="progress-bar" style={{ width: `${update.percent}%` }} />
          </div>
        )}

        <div className="row-actions">
          <button
            className="btn"
            onClick={async () => {
              const s = await window.ram.potassiumStatus();
              setStatus(
                s.running
                  ? `Potassium looks running (${s.names.join(", ") || "configured names"}).`
                  : "No matching Potassium process is running.",
              );
            }}
          >
            Check Potassium
          </button>
          <button
            className="btn"
            disabled={checking}
            onClick={async () => {
              await window.ram.setSettings({
                autoCheckUpdates,
                autoDownloadUpdates,
                githubToken: githubToken.trim(),
              });
              setChecking(true);
              try {
                await window.ram.checkUpdates();
              } finally {
                setChecking(false);
              }
            }}
          >
            Check GitHub
          </button>
          {update?.status === "available" && (
            <button className="btn primary" onClick={() => void window.ram.downloadUpdate()}>
              {update.canInstall ? "Download update" : "Get update"}
            </button>
          )}
          {update?.status === "ready" && (
            <button className="btn primary" onClick={() => void window.ram.installUpdate()}>
              Restart to update
            </button>
          )}
          <button className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void save()}>
            Save
          </button>
        </div>
        {status && <p className="hint">{status}</p>}
      </div>
    </div>
  );
}
