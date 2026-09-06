# Capture one Scrollr window to a PNG, pixel-exact, without the screen.
#
#   powershell -File scripts/dev/capture-window.ps1 -Title "Scrollr Ticker" -Out shot.png
#   powershell -File scripts/dev/capture-window.ps1 -Title "Scrollr" -Out app.png
#
# The Windows half of what `screencapture -l <windowID>` did on the Mac:
# find the window by title in the running scrollr-desktop process and ask
# it to paint itself into a bitmap (PrintWindow with PW_RENDERFULLCONTENT,
# which is what makes WebView2's composited surface come out instead of
# black). No screen grab, so other windows on top do not matter and the
# result is the window's own pixels at the display's physical DPI.
#
# -List prints the process's windows and exits. -Screen grabs the window's
# rectangle off the screen instead (the fallback if PrintWindow ever
# returns an empty frame for a window type it cannot render).
param(
  [string]$Title = "Scrollr Ticker",
  [string]$Out = "",
  [string]$Process = "scrollr-desktop",
  [switch]$List,
  [switch]$Screen
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
# Per-monitor-v2, not system-DPI: with mixed scaling (a 300 % screen next
# to 100 % ones) a system-aware process sees other screens' windows
# virtualised to a third of their size and PrintWindow paints them at
# that DPI, leaving the rest of the bitmap blank. Falls back on old Windows.
if (-not [Win]::SetProcessDpiAwarenessContext([IntPtr]::op_Explicit(-4))) { [void][Win]::SetProcessDPIAware() }

$pids = @(Get-Process -Name $Process -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
if ($pids.Count -eq 0) { throw "no process named $Process is running" }

$found = New-Object System.Collections.ArrayList
$cb = [Win+EnumProc]{
  param($h, $l)
  [uint32]$wpid = 0; [void][Win]::GetWindowThreadProcessId($h, [ref]$wpid)
  if ($pids -notcontains $wpid) { return $true }
  $sb = New-Object System.Text.StringBuilder 256
  [void][Win]::GetWindowText($h, $sb, 256)
  $rc = New-Object Win+RECT; [void][Win]::GetWindowRect($h, [ref]$rc)
  [void]$found.Add(@{ h = $h; title = $sb.ToString(); visible = [Win]::IsWindowVisible($h); rect = $rc })
  return $true
}
[void][Win]::EnumWindows($cb, [IntPtr]::Zero)

if ($List) {
  $found | ForEach-Object { "{0}`t{1}`t{2}x{3} @ {4},{5}`t{6}" -f $_.h, $(if ($_.visible) { "visible" } else { "hidden " }), ($_.rect.R - $_.rect.L), ($_.rect.B - $_.rect.T), $_.rect.L, $_.rect.T, $_.title }
  exit 0
}
$vis = $found | Where-Object { $_.visible }
$win = $vis | Where-Object { $_.title -eq $Title } | Select-Object -First 1
if (-not $win) { $win = $vis | Where-Object { $_.title -like "$Title*" } | Select-Object -First 1 }
if (-not $win) { throw ("no visible window titled '{0}' (have: {1}; -List shows all)" -f $Title, (($vis | ForEach-Object { $_.title }) -join ", ")) }
if (-not $Out) { throw "-Out <file.png> is required" }
$h = $win.h

# The frame the user sees: DWM's extended bounds exclude the invisible
# resize borders a decorated window carries; for the undecorated ticker
# they equal the window rect.
$full = New-Object Win+RECT; [void][Win]::GetWindowRect($h, [ref]$full)
$dwm = New-Object Win+RECT
if ([Win]::DwmGetWindowAttribute($h, 9, [ref]$dwm, [System.Runtime.InteropServices.Marshal]::SizeOf($dwm)) -ne 0) { $dwm = $full }
$w = $dwm.R - $dwm.L; $hgt = $dwm.B - $dwm.T
if ($w -le 0 -or $hgt -le 0) { throw "window has no size (minimized?)" }

$bmp = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($bmp)
if ($Screen) {
  $g.CopyFromScreen($dwm.L, $dwm.T, 0, 0, $bmp.Size)
} else {
  # Paint the whole window rect, then keep the DWM frame out of it.
  $fw = $full.R - $full.L; $fh = $full.B - $full.T
  $whole = New-Object System.Drawing.Bitmap $fw, $fh
  $gw = [System.Drawing.Graphics]::FromImage($whole)
  $dc = $gw.GetHdc()
  $ok = [Win]::PrintWindow($h, $dc, 2)   # PW_RENDERFULLCONTENT
  $gw.ReleaseHdc($dc); $gw.Dispose()
  if (-not $ok) { throw "PrintWindow failed; try -Screen" }
  $src = New-Object System.Drawing.Rectangle ($dwm.L - $full.L), ($dwm.T - $full.T), $w, $hgt
  $g.DrawImage($whole, (New-Object System.Drawing.Rectangle 0, 0, $w, $hgt), $src, [System.Drawing.GraphicsUnit]::Pixel)
  $whole.Dispose()
}
$g.Dispose()
$dir = Split-Path -Parent ([System.IO.Path]::GetFullPath($Out))
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
$bmp.Save([System.IO.Path]::GetFullPath($Out), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"{0}`t{1}x{2}`t{3}" -f $win.title, $w, $hgt, $Out
