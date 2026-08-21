import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function focusScript(pid: number): string {
  // Keep this as one line-friendly script; EnumWindows finds the real Roblox HWND
  // because Get-Process.MainWindowHandle is often 0 for RobloxPlayerBeta.
  return `
$ErrorActionPreference = 'Stop'
$targetPid = ${pid}
if (-not (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)) { exit 1 }
$pidList = New-Object System.Collections.Generic.List[int]
[void]$pidList.Add($targetPid)
try {
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$targetPid" -ErrorAction SilentlyContinue | ForEach-Object {
    [void]$pidList.Add([int]$_.ProcessId)
  }
} catch {}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class RamFocus {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static IntPtr FindBest(int[] pids) {
    IntPtr best = IntPtr.Zero;
    long bestArea = -1;
    EnumWindows((hWnd, l) => {
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      bool match = false;
      for (int i = 0; i < pids.Length; i++) if (pids[i] == (int)pid) { match = true; break; }
      if (!match || !IsWindowVisible(hWnd)) return true;
      RECT r;
      if (!GetWindowRect(hWnd, out r)) return true;
      long area = Math.Max(0L, (long)(r.Right - r.Left) * (long)(r.Bottom - r.Top));
      if (area < 200 * 200) return true;
      int titled = GetWindowTextLength(hWnd);
      if (titled <= 0 && area < bestArea) return true;
      if (area > bestArea) { bestArea = area; best = hWnd; }
      return true;
    }, IntPtr.Zero);
    return best;
  }
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr extra);
  public static void Focus(IntPtr hWnd) {
    AllowSetForegroundWindow(-1);
    if (IsIconic(hWnd)) ShowWindow(hWnd, 9); else ShowWindow(hWnd, 5);
    BringWindowToTop(hWnd);
    IntPtr fg = GetForegroundWindow();
    uint fgPid;
    uint fgThread = GetWindowThreadProcessId(fg, out fgPid);
    uint cur = GetCurrentThreadId();
    if (fgThread != 0 && fgThread != cur) AttachThreadInput(cur, fgThread, true);
    // ALT tap helps Windows allow SetForegroundWindow from a background process.
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(hWnd);
    if (fgThread != 0 && fgThread != cur) AttachThreadInput(cur, fgThread, false);
  }
}
"@
$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 8 -and $hwnd -eq [IntPtr]::Zero; $i++) {
  $hwnd = [RamFocus]::FindBest([int[]]$pidList.ToArray())
  if ($hwnd -eq [IntPtr]::Zero) {
    $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { $hwnd = $p.MainWindowHandle }
  }
  if ($hwnd -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 250 }
}
if ($hwnd -eq [IntPtr]::Zero) { exit 2 }
[RamFocus]::Focus($hwnd)
exit 0
`.trim();
}

export async function focusPid(pid: number): Promise<void> {
  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", focusScript(pid)],
      { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 },
    );
  } catch (err) {
    const any = err as { code?: number | string; status?: number };
    const code = Number(any.code ?? any.status);
    if (code === 1) {
      throw new Error("That Roblox client is no longer running.");
    }
    if (code === 2) {
      throw new Error("Could not find that client's window to focus.");
    }
    throw new Error("Could not focus that client.");
  }
}
