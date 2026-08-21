# Account Manager

Windows app for **your** Roblox accounts: cards, isolated login/signup, launch/focus/close by PID.

Private GitHub repo: [MajdIssaDev/Account-Manager](https://github.com/MajdIssaDev/Account-Manager)

## Run

```bat
cd /d "e:\Account manager"
npm install
npm run dev
```

Data is stored encrypted under `%APPDATA%\AccountManager`.

## Installer

```bat
npm run dist
```

Writes to `release\`:

- **`Account-Manager-Setup-1.0.0.exe`** — installer (Start Menu + desktop shortcut)
- **`Account-Manager-1.0.0-portable.exe`** — portable app
- **`win-unpacked\Account Manager.exe`** — unpacked app exe

`Open Account Manager.exe` in the project folder starts the installed (or unpacked) app.

## Invite people (private downloads)

The repo is **private**. Invite collaborators at
[Settings → Collaborators](https://github.com/MajdIssaDev/Account-Manager/settings/access).
They can download the installer from
[Releases](https://github.com/MajdIssaDev/Account-Manager/releases/latest).

## Updates

The app checks **GitHub Releases** on `MajdIssaDev/Account-Manager` for a newer version.

- Top-bar chip: **up to date**, **update available**, or download progress
- Settings: check on launch, auto-download (installed NSIS build only)
- Private in-app checks may need a fine-grained GitHub token with **Contents: Read** on this repo only

Publish a new installer:

```bat
npm run dist
gh release create v1.0.1 --title "Account Manager 1.0.1" --notes "..." release\Account-Manager-Setup-1.0.1.exe release\latest.yml release\Account-Manager-Setup-1.0.1.exe.blockmap
```

Or, with `GH_TOKEN` set: `npm run dist:publish`.

## Add accounts

- **Paste session** — paste `.ROBLOSECURITY`. The app checks `users.roblox.com/v1/users/authenticated` and the thumbnail API, then saves a card.
- **Log in / Sign up** — isolated WebView (its own partition). Captcha stays on the Roblox page for you to solve. There is no captcha solver.
- **Quick add** — username + password are filled on the official login page. If Roblox does not challenge you, the card is added when the session cookie appears. If captcha/2FA shows, finish it in the window.

Create-account is only the official signup page.

## Launch / Focus / Close

Launch fetches an authentication ticket for that cookie and starts `RobloxPlayerBeta.exe` with the ticket (not by swapping a global AppData cookie). The app tracks **that** PID.

- **Close** ends that PID only.
- **Focus** restores that PID’s window.

If the ticket fails, the error is shown on the card. The app does not fall back to whichever Roblox user Windows last used.

## Multi-client

This app does **not** kill Roblox’s single-instance mutex. Multiple clients only work if you already run more than one `RobloxPlayerBeta.exe`. The manager just tracks PIDs.

## Security

Session cookies never go to the renderer. WebView partitions are discarded after add succeeds or you cancel. No telemetry.
