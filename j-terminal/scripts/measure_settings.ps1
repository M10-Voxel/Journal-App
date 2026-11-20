param([Parameter(Mandatory=$true)][string]$Exe,
      [Parameter(Mandatory=$true)][string]$TestData)
$ErrorActionPreference = 'Stop'
if (Get-Process -Name 'j-terminal','f1-before' -ErrorAction SilentlyContinue) {
    throw 'Close J-TerminaL before starting the isolated measurement.'
}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F1Windows {
    delegate bool Visitor(IntPtr hwnd, IntPtr unused);
    [DllImport("user32.dll")] static extern bool EnumWindows(Visitor visit, IntPtr arg);
    [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr hwnd, out int pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, System.Text.StringBuilder text, int size);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, int msg, int key, int data);
    [DllImport("psapi.dll", SetLastError=true)]
    static extern bool QueryWorkingSet(IntPtr process, [Out] UIntPtr[] entries, int bytes);
    public static long[] WorkingSet(IntPtr process) {
        var entries = new UIntPtr[65536];
        while (!QueryWorkingSet(process, entries, entries.Length * IntPtr.Size)) {
            int error = Marshal.GetLastWin32Error();
            if (error != 24) throw new System.ComponentModel.Win32Exception(error);
            Array.Resize(ref entries, entries.Length * 2);
        }
        long count = (long)entries[0].ToUInt64(), privatePages = 0;
        for (int i = 1; i <= count; i++)
            if ((entries[i].ToUInt64() & 0x100) == 0) privatePages++;
        return new long[] { privatePages * Environment.SystemPageSize, count * Environment.SystemPageSize };
    }
    public static IntPtr Visible(int pid) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd, IntPtr arg) {
            int owner;
            GetWindowThreadProcessId(hwnd, out owner);
            if (owner != pid || !IsWindowVisible(hwnd)) return true;
            var title = new System.Text.StringBuilder(128);
            GetWindowText(hwnd, title, title.Capacity);
            if (!title.ToString().EndsWith("J-TerminaL")) return true;
            found = hwnd;
            return false;
        }, IntPtr.Zero);
        return found;
    }
}
'@
$dataArgs = '--data "' + (Resolve-Path $TestData).Path + '"'
$app = Start-Process $Exe -ArgumentList ("--background " + $dataArgs) -PassThru
function Sample($stage) {
    Start-Sleep -Milliseconds 1000
    $mem = [F1Windows]::WorkingSet($app.Handle)
    "$stage privateMiB={0:N2} totalMiB={1:N2}" -f ($mem[0]/1MB), ($mem[1]/1MB)
}
function Wait-Window($previous, $visible) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        $hwnd = [F1Windows]::Visible($app.Id)
        if (($visible -and $hwnd -ne 0 -and $hwnd -ne $previous) -or (!$visible -and $hwnd -eq 0)) { return $hwnd }
        Start-Sleep -Milliseconds 2
    } while ($timer.ElapsedMilliseconds -lt 5000)
    throw "Window transition timed out (previous $previous, current $hwnd, visible $visible)"
}
function Wake {
    $second = Start-Process $Exe -ArgumentList $dataArgs -PassThru
    if (!$second.WaitForExit(5000)) { throw 'Second launch did not wake test instance' }
    Wait-Window 0 $true
}
function Hide-Main($hwnd) {
    [void][F1Windows]::PostMessage($hwnd, 0x100, 27, 0x00010001)
    [void][F1Windows]::PostMessage($hwnd, 0x101, 27, (-1073741824 + 0x00010001))
    [void](Wait-Window 0 $false)
}
try {
    Sample 'background'
    $main = Wake
    Start-Sleep -Milliseconds 1000
    Hide-Main $main
    Sample 'main-only idle'
    foreach ($cycle in 1..4) {
        $main = Wake
        $timer = [Diagnostics.Stopwatch]::StartNew()
        [void][F1Windows]::PostMessage($main, 0x100, 0x70, 0x003b0001)
        [void][F1Windows]::PostMessage($main, 0x101, 0x70, (-1073741824 + 0x003b0001))
        $settings = Wait-Window $main $true
        "cycle $cycle visibleMs=$($timer.ElapsedMilliseconds)"
        Sample 'F1 open'
        switch ($cycle) {
            2 {
                [void][F1Windows]::PostMessage($settings, 0x100, 27, 0x00010001)
                [void][F1Windows]::PostMessage($settings, 0x101, 27, (-1073741824 + 0x00010001))
            }
            3 {
                [void][F1Windows]::PostMessage($settings, 0x100, 0x70, 0x003b0001)
                [void][F1Windows]::PostMessage($settings, 0x101, 0x70, (-1073741824 + 0x003b0001))
            }
            default { [void][F1Windows]::PostMessage($settings, 0x10, 0, 0) }
        }
        $main = Wait-Window $settings $true
        Hide-Main $main
        Sample 'F1 idle'
    }
} finally {
    if (!$app.HasExited) { $app.Kill(); $app.WaitForExit() }
}
