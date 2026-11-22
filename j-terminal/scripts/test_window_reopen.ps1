# Exercise the real compositor and the profile-specific second-launch path.
param([string]$Exe = "$PSScriptRoot/../target/release/j-terminal.exe", [switch]$RequireGlass)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class ReopenScreen {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L, T, R, B; }
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr level);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect bounds);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll")] public static extern uint GetPixel(IntPtr dc, int x, int y);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr window, int index);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr window, int name, out int value, int bytes);
}
'@
[void][ReopenScreen]::SetThreadDpiAwarenessContext([IntPtr](-4))
$testData = Join-Path ([IO.Path]::GetTempPath()) ('j-terminal-reopen-' + [guid]::NewGuid())
$arguments = '--data "' + $testData + '"'
$backdrop = New-Object Windows.Forms.Form
$backdrop.FormBorderStyle = 'None'
$backdrop.StartPosition = 'Manual'
$backdrop.ShowInTaskbar = $false
$backdrop.TopMost = $true
$backdrop.BackColor = [Drawing.Color]::Black
$white = New-Object Windows.Forms.Panel
$white.BackColor = [Drawing.Color]::White
$backdrop.Controls.Add($white)
$backdrop.Show()
$backdrop.Activate()

function Read-Light($dc, [int]$x, [int]$y) {
    # Average five vertical pixels to smooth the acrylic grain at this x.
    $sum = 0
    foreach ($dy in -2..2) {
        $rgb = [ReopenScreen]::GetPixel($dc, $x, $y + $dy)
        if ($rgb -eq [uint32]::MaxValue) { throw "Desktop pixel unavailable at ($x,$y)" }
        $sum += $rgb -band 255
    }
    return $sum / 5
}

try {
    $app = Start-Process $Exe -ArgumentList $arguments -PassThru -WindowStyle Hidden
    foreach ($opening in 1..3) {
        if ($opening -gt 1) {
            $second = Start-Process $Exe -ArgumentList $arguments -PassThru -WindowStyle Hidden
            if (!$second.WaitForExit(5000)) { throw 'Second launch did not wake the test instance.' }
        }
        $deadline = [DateTime]::UtcNow.AddSeconds(12)
        do {
            [Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 100
            $app.Refresh()
            $window = $app.MainWindowHandle
        } until (($window.ToInt64() -and $app.MainWindowTitle -eq 'J-TerminaL') -or [DateTime]::UtcNow -ge $deadline)
        if ($app.MainWindowTitle -ne 'J-TerminaL') { throw "Launcher missing on opening $opening" }
        Start-Sleep -Milliseconds 350
        if ([ReopenScreen]::GetWindowLongW($window, -16) -band 0x00C00000) { throw "Native caption on opening $opening" }
        $origin = New-Object ReopenScreen+Point
        $size = New-Object ReopenScreen+Rect
        if (![ReopenScreen]::ClientToScreen($window, [ref]$origin) -or ![ReopenScreen]::GetClientRect($window, [ref]$size)) { throw 'Missing client bounds' }
        $scale = [ReopenScreen]::GetDpiForWindow($window) / 96
        $edge = [int](220 * $scale)
        $edgeX = $origin.X + $edge
        if (![ReopenScreen]::SetWindowPos($backdrop.Handle, [IntPtr](-1), $origin.X, $origin.Y,
                $size.R, $size.B, 0x50)) { throw 'Could not position backdrop' }
        [Windows.Forms.Application]::DoEvents()
        $white.Bounds = [Drawing.Rectangle]::new($edge, 0, $size.R - $edge, $size.B)
        $backdrop.Refresh()
        [Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 400
        $dc = [ReopenScreen]::GetDC([IntPtr]::Zero)
        try {
            $far = [int](80 * $scale)
            $near = [int](3 * $scale)
            $sampleY = $origin.Y + [int](200 * $scale)
            $blackRef = Read-Light $dc ($edgeX - $far) $sampleY
            $whiteRef = Read-Light $dc ($edgeX + $far) $sampleY
            if ($blackRef -gt 8 -or $whiteRef -lt 245) {
                throw "Calibration pattern missing on opening $opening ($blackRef, $whiteRef)."
            }
            if (![ReopenScreen]::SetWindowPos($backdrop.Handle, $window, 0, 0, 0, 0, 0x13)) { throw 'Could not lower backdrop' }
            [Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 650
            $lo = Read-Light $dc ($edgeX - $far) $sampleY
            $hi = Read-Light $dc ($edgeX + $far) $sampleY
            $left = Read-Light $dc ($edgeX - $near) $sampleY
            $right = Read-Light $dc ($edgeX + $near) $sampleY
            $material = 0
            [void][ReopenScreen]::DwmGetWindowAttribute($window, 38, [ref]$material, 4)
            if ($hi - $lo -gt 4) {
                if ($material -ne 3 -or $left -le $lo + 1 -or $right -ge $hi - 1 -or $hi -gt 100) {
                    throw "Expected dark acrylic with a softened edge, got material $material and luminances $lo, $left, $right, $hi"
                }
                Write-Output "Opening $opening shows a blurred transition ($lo, $left, $right, $hi)."
            } elseif ($RequireGlass) {
                throw "Acrylic not visible on opening $opening (material $material, luminances $lo, $left, $right, $hi, foreground $([ReopenScreen]::GetForegroundWindow()), launcher $window)."
            }
            elseif ($hi -gt 100 -or $lo -lt 10) { throw "Unreadable fallback surface on opening $opening" }
            else { Write-Output "Opening $opening shows the opaque fallback." }
            # The search header follows the body. An unexpected Win32 caption or a
            # transparent hole after a hide/show would reveal a different colour.
            $header = Read-Light $dc ($edgeX + $far) ($origin.Y + [int](8 * $scale))
            if ([math]::Abs($header - $hi) -gt 5) { throw "Search header differs from the surface on opening $opening" }
        } finally { [void][ReopenScreen]::ReleaseDC([IntPtr]::Zero, $dc) }
        $backdrop.Activate()
        [Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 400
        if ([ReopenScreen]::IsWindowVisible($window)) {
            [void][ReopenScreen]::PostMessage($window, 8, [IntPtr]::Zero, [IntPtr]::Zero) # WM_KILLFOCUS
            Start-Sleep -Milliseconds 400
        }
        if ([ReopenScreen]::IsWindowVisible($window)) { throw 'Focus loss did not hide the test launcher.' }
    }
} finally {
    if ($app -and !$app.HasExited) { $app.Kill(); $app.WaitForExit() }
    $backdrop.Dispose()
    if (Test-Path -LiteralPath $testData) {
        # Only the fresh profile above, and only its regular database and settings files.
        Get-ChildItem -LiteralPath $testData -File | Remove-Item
        Remove-Item -LiteralPath $testData
    }
}
