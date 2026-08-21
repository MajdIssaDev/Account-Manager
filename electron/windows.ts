import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function focusPid(pid: number): Promise<void> {
  const script = `
$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if (-not $p) { exit 1 }
$hwnd = $p.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { exit 2 }
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class RamNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@
if ([RamNative]::IsIconic($hwnd)) { [RamNative]::ShowWindow($hwnd, 9) | Out-Null }
[RamNative]::ShowWindow($hwnd, 5) | Out-Null
[RamNative]::BringWindowToTop($hwnd) | Out-Null
[RamNative]::SetForegroundWindow($hwnd) | Out-Null
`;
  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-STA", "-Command", script],
      { windowsHide: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not focus that client (${msg}).`);
  }
}
