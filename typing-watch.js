// Where are you typing? (main process). A hidden PowerShell process polls Windows every 150 ms for
// the last-input time, the text caret (GetGUIThreadInfo) and, where there's no system caret
// (Chrome, Electron apps), the focused text field (UI Automation). Input while the mouse didn't move
// counts as typing (avoid.js); while you type, the brain keeps the robot out of the typing zone.
// Read-only: it never sees what you type, only where the caret is.
const { spawn } = require('child_process');
const { screen } = require('electron');
const { TypingDetector, typingZone } = require('./avoid');

const PROBE = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OrbitTyping {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO { public int cbSize; public int flags; public IntPtr hwndActive; public IntPtr hwndFocus; public IntPtr hwndCapture; public IntPtr hwndMenuOwner; public IntPtr hwndMoveSize; public IntPtr hwndCaret; public RECT rcCaret; }
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public int cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO info);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static uint LastInput() { var i = new LASTINPUTINFO(); i.cbSize = Marshal.SizeOf(i); GetLastInputInfo(ref i); return i.dwTime; }
  public static int[] Caret() {
    uint pid; uint tid = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    var g = new GUITHREADINFO(); g.cbSize = Marshal.SizeOf(g);
    if (!GetGUIThreadInfo(tid, ref g) || g.hwndCaret == IntPtr.Zero) return null;
    var p = new POINT(); p.X = g.rcCaret.L; p.Y = g.rcCaret.T;
    if (!ClientToScreen(g.hwndCaret, ref p)) return null;
    int w = g.rcCaret.R - g.rcCaret.L, h = g.rcCaret.B - g.rcCaret.T;
    if (h <= 0) return null;
    return new int[] { p.X, p.Y, Math.Max(w, 1), h };
  }
}
'@
[OrbitTyping]::SetProcessDPIAware() | Out-Null
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$last = [OrbitTyping]::LastInput()
while ($true) {
  $tick = [OrbitTyping]::LastInput()
  $c = [OrbitTyping]::Caret()
  $f = $null
  if (-not $c -and $tick -ne $last) {
    try {
      $e = [System.Windows.Automation.AutomationElement]::FocusedElement
      $ct = $e.Current.ControlType
      if ($ct -eq [System.Windows.Automation.ControlType]::Edit -or $ct -eq [System.Windows.Automation.ControlType]::Document) {
        $r = $e.Current.BoundingRectangle
        if (-not $r.IsEmpty) { $f = @([int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height) }
      }
    } catch {}
  }
  $last = $tick
  [Console]::Out.WriteLine((@{ tick = $tick; caret = $c; field = $f } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 150
}
`;

/** Physical screen px [x, y, w, h] → DIP {x, y, w, h} (Electron's coordinates). */
function toDip(r) {
  if (!Array.isArray(r) || r.length !== 4) return null;
  const d = screen.screenToDipRect(null, { x: r[0], y: r[1], width: r[2], height: r[3] });
  return { x: d.x, y: d.y, w: d.width, h: d.height };
}

/**
 * Start watching. onZone(zone | null) is called whenever the area to keep clear changes.
 * Returns stop(). Restarts the probe if it dies (at most a few times a minute).
 */
function startTypingWatch(onZone) {
  const detector = new TypingDetector();
  let child = null;
  let stopped = false;
  let zone = null; // last known while typing (the field is only looked up on new input)
  let restarts = [];
  const set = (z) => {
    if (JSON.stringify(z) === JSON.stringify(zone)) return;
    zone = z;
    onZone(z);
  };

  const onLine = (line) => {
    let s;
    try {
      s = JSON.parse(line);
    } catch {
      return;
    }
    const typing = detector.update(s.tick, screen.getCursorScreenPoint(), performance.now() / 1000);
    if (!typing) return set(null);
    const z = typingZone({ caret: toDip(s.caret), field: toDip(s.field) });
    if (z) set(z);
  };

  const run = () => {
    if (stopped) return;
    const encoded = Buffer.from(PROBE, 'utf16le').toString('base64');
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i).trim());
        buf = buf.slice(i + 1);
      }
    });
    child.on('exit', () => {
      child = null;
      set(null);
      const now = Date.now();
      restarts = restarts.filter((t) => now - t < 60000).concat(now);
      if (!stopped && restarts.length <= 3) setTimeout(run, 2000);
    });
  };
  run();

  return () => {
    stopped = true;
    child?.kill();
    child = null;
    set(null);
  };
}

module.exports = { startTypingWatch };
