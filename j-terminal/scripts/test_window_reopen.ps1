# Sample the composited desktop, including any glass painted by Windows.
param([string]$Exe = "$PSScriptRoot/../target/release/j-terminal.exe")
$ErrorActionPreference = 'Stop'
if (Get-Process -Name 'j-terminal','before-reopen-fix' -ErrorAction SilentlyContinue) {
    throw 'Close the running J-TerminaL before testing its single-instance reopen path.'
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ReopenScreen {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll")] public static extern uint GetPixel(IntPtr dc, int x, int y);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr window, int index);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
}
'@
[void][ReopenScreen]::SetProcessDPIAware()
$testData = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
$arguments = '--data "' + $testData + '"'
Add-Type -AssemblyName System.Windows.Forms
$backdrop = New-Object Windows.Forms.Form
$backdrop.StartPosition = 'Manual'
$backdrop.Bounds = [Windows.Forms.Screen]::FromPoint([Windows.Forms.Cursor]::Position).Bounds
$backdrop.FormBorderStyle = 'None'
$backdrop.BackColor = [Drawing.Color]::Magenta
$backdrop.Show()
$backdrop.Refresh()
$app = Start-Process $Exe -ArgumentList $arguments -PassThru
try {
    foreach ($opening in 1..3) {
        if ($opening -gt 1) {
            $second = Start-Process $Exe -ArgumentList $arguments -PassThru
            if (!$second.WaitForExit(5000)) { throw 'Second launch did not wake the first instance.' }
        }
        Start-Sleep -Milliseconds 800
        $app.Refresh()
        $window = $app.MainWindowHandle
        if (!$window.ToInt64()) { throw "Window missing on opening $opening" }
        if ([ReopenScreen]::GetWindowLongW($window, -16) -band 0x00C00000) {
            throw "Native caption style present on opening $opening"
        }
        $origin = New-Object ReopenScreen+Point
        if (![ReopenScreen]::ClientToScreen($window, [ref]$origin)) { throw 'Missing client origin' }
        $dc = [ReopenScreen]::GetDC([IntPtr]::Zero)
        try {
            $scale = [ReopenScreen]::GetDpiForWindow($window) / 96
            # Follow the center of the upper-left stroke on the composited desktop.
            foreach ($degrees in 0..90) {
                $angle = $degrees * [Math]::PI / 180
                $x = [Math]::Floor((16 - 14 * [Math]::Cos($angle)) * $scale)
                $y = [Math]::Floor((16 - 14 * [Math]::Sin($angle)) * $scale)
                $rgb = [ReopenScreen]::GetPixel($dc, $origin.X + $x, $origin.Y + $y)
                $red = $rgb -band 255
                if ($red -le 41 -or $red -gt 69 -or $rgb -ne $red * 65793) {
                    throw ('Gap in corner on opening {0} at ({1},{2}): {3:X6}' -f $opening,$x,$y,$rgb)
                }
            }
            foreach ($x in 200,240,280,320,360) {
                $rgb = [ReopenScreen]::GetPixel($dc, $origin.X + $x * $scale, $origin.Y + 19 * $scale)
                if ($rgb -ne 0) { throw ('Opening {0}, header at x={1}: expected black, got {2:X6}' -f $opening,$x,$rgb) }
            }
            # The calendar header is neutral gray, including its antialiased time labels.
            foreach ($x in 650,690,730,770,810) {
                $rgb = [ReopenScreen]::GetPixel($dc, $origin.X + $x * $scale, $origin.Y + 12 * $scale)
                if ($rgb -eq [uint32]::MaxValue -or ($rgb -band 255) -ne (($rgb -shr 8) -band 255) -or
                    ($rgb -band 255) -ne (($rgb -shr 16) -band 255)) { throw "Backdrop visible in calendar header on opening $opening." }
            }
        } finally { [void][ReopenScreen]::ReleaseDC([IntPtr]::Zero, $dc) }
        Write-Output "Opening $opening has an opaque black search field."
        [void][ReopenScreen]::PostMessage($window, 8, [IntPtr]::Zero, [IntPtr]::Zero) # WM_KILLFOCUS
        Start-Sleep -Milliseconds 400
        $app.Refresh()
        if ([ReopenScreen]::IsWindowVisible($window)) { throw 'Focus loss did not hide the test window.' }
    }
} finally {
    if (!$app.HasExited) { $app.Kill(); $app.WaitForExit() }
    $backdrop.Dispose()
}
