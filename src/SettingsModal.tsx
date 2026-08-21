import { useState } from "react";
import type { AppSettings, ThemeId, UpdateState } from "../shared/types";
import { THEME_PRESETS } from "../shared/types";
import { GITHUB_LATEST_RELEASE_URL, GITHUB_REPO_SLUG } from "../shared/github";

export default function SettingsModal(props: {
  settings: AppSettings;
  update: UpdateState | null;
  onClose: () => void;
  onSaved: (s: AppSettings) => void;
  onReplayTutorial: () => void;
}) {
  const [robloxPlayerPath, setPath] = useState(props.settings.robloxPlayerPath);
  const [useDefaultRobloxFolder, setUseDefault] = useState(
    props.settings.useDefaultRobloxFolder !== false,
  );
  const [attachOnLaunch, setAttach] = useState(props.settings.attachOnLaunch);
  const [names, setNames] = useState(props.settings.potassiumProcessNames.join(", "));
  const [attachCommand, setCmd] = useState(props.settings.attachCommand);
  const [autoCheckUpdates, setAutoCheck] = useState(props.settings.autoCheckUpdates);
  const [autoDownloadUpdates, setAutoDownload] = useState(props.settings.autoDownloadUpdates);
  const [githubToken, setToken] = useState(props.settings.githubToken);
  const [themeId, setThemeId] = useState<ThemeId>(props.settings.themeId || "midnight");
  const [hiveWorkspacePath, setHivePath] = useState(props.settings.hiveWorkspacePath || "");
  const [hiveHeartbeatTtlMs, setHiveTtl] = useState(String(props.settings.hiveHeartbeatTtlMs || 5000));
  const [hiveRelaunchUi, setHiveRelaunch] = useState(props.settings.hiveRelaunchUi === true);
  const [status, setStatus] = useState<string>("");
  const [checking, setChecking] = useState(false);

  const save = async () => {
    const next = await window.ram.setSettings({
      robloxPlayerPath: robloxPlayerPath.trim(),
      useDefaultRobloxFolder,
      attachOnLaunch,
      potassiumProcessNames: names.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean),
      attachCommand: attachCommand.trim(),
      autoCheckUpdates,
      autoDownloadUpdates,
      githubToken: githubToken.trim(),
      themeId,
      hiveWorkspacePath: hiveWorkspacePath.trim(),
      hiveHeartbeatTtlMs: Number(hiveHeartbeatTtlMs) || 5000,
      hiveRelaunchUi,
    });
    props.onSaved(next);
    props.onClose();
  };

  const update = props.update;

  return (
    <div className="overlay" onMouseDown={props.onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <label>Roblox folder</label>
        <div className="choice-row">
          <button
            type="button"
            className={`choice${useDefaultRobloxFolder ? " on" : ""}`}
            onClick={() => setUseDefault(true)}
          >
            Default folder
          </button>
          <button
            type="button"
            className={`choice${!useDefaultRobloxFolder ? " on" : ""}`}
            onClick={() => setUseDefault(false)}
          >
            Custom folder
          </button>
        </div>
        {useDefaultRobloxFolder ? (
          <p className="hint">
            Launches the latest Roblox under %LOCALAPPDATA%\Roblox\Versions (the one the official app updates).
          </p>
        ) : (
          <>
            <p className="hint">
              Point at a specific Roblox version folder (the one that contains RobloxPlayerBeta.exe) when
              Potassium is behind the latest client. Switch back to Default folder after Potassium updates.
            </p>
            <div className="path-row">
              <input
                value={robloxPlayerPath}
                onChange={(e) => setPath(e.target.value)}
                placeholder="C:\path\to\Roblox version folder"
              />
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const folder = await window.ram.pickRobloxFolder();
                  if (folder) {
                    setPath(folder);
                    setUseDefault(false);
                  }
                }}
              >
                Browse
              </button>
            </div>
          </>
        )}
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

        <h2 className="modal-section">Hive / CloudFarm</h2>
        <p className="hint">
          Folder that contains <code>CloudFarmHive/</code> (Potassium writefile root). Session heartbeat older
          than the TTL is treated as stale and excluded from Sell all / Eat all.
        </p>
        <label>Hive workspace</label>
        <div className="path-row">
          <input
            value={hiveWorkspacePath}
            onChange={(e) => setHivePath(e.target.value)}
            placeholder="%LOCALAPPDATA%\Potassium\workspace\AO project"
          />
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const folder = await window.ram.pickHiveFolder();
              if (folder) {
                setHivePath(folder);
              }
            }}
          >
            Browse
          </button>
        </div>
        <label>Heartbeat TTL (ms)</label>
        <input
          value={hiveHeartbeatTtlMs}
          onChange={(e) => setHiveTtl(e.target.value)}
          placeholder="5000"
        />
        <label className="attach">
          <input
            type="checkbox"
            checked={hiveRelaunchUi}
            onChange={(e) => setHiveRelaunch(e.target.checked)}
          />
          Relaunch UI when hive goes offline (saved only — inject not wired yet)
        </label>

        <h2 className="modal-section">Appearance</h2>
        <p className="hint">Color presets apply to the whole app. Click one to preview, then Save.</p>
        <div className="theme-grid">
          {THEME_PRESETS.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className={`theme-card theme-${theme.id}${themeId === theme.id ? " on" : ""}`}
              onClick={() => {
                setThemeId(theme.id);
                document.documentElement.setAttribute("data-theme", theme.id);
              }}
            >
              <span className="theme-preview">
                <i />
                <i />
                <i />
              </span>
              {theme.name}
            </button>
          ))}
        </div>
        <button className="btn" onClick={props.onReplayTutorial}>
          Replay tutorial
        </button>

        <h2 className="modal-section">Updates</h2>
        <p className="hint">
          This build is <strong>v{update?.currentVersion || "…"}</strong>
          {update?.latestVersion ? ` · GitHub latest v${update.latestVersion}` : ""}.
          {" "}Version checks use the private GitHub repo <code>{GITHUB_REPO_SLUG}</code>.
          {" "}Updates replace files in this install and restart — they do not open the Setup wizard again.
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
          Apply new files automatically (installed app only)
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
                const checked = await window.ram.checkUpdates();
                if (checked.status === "available") {
                  await window.ram.downloadUpdate();
                }
              } finally {
                setChecking(false);
              }
            }}
          >
            Check GitHub
          </button>
          {update?.status === "available" && (
            <button className="btn primary" onClick={() => void window.ram.downloadUpdate()}>
              {update.canInstall ? "Apply update" : "Update unavailable"}
            </button>
          )}
          {update?.status === "ready" && (
            <button className="btn primary" onClick={() => void window.ram.installUpdate()}>
              Restart to apply
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
