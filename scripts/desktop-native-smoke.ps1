param([string]$Probe = "$PSScriptRoot\..\src-tauri\target\debug\desktop-widget-probe.exe")
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class DesktopProbe {
 [StructLayout(LayoutKind.Sequential)] public struct GuiInfo { public uint Size,Flags; public IntPtr Active,Focus,Capture,Menu,Move,Caret; public Rect CaretRect; }
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; public override string ToString(){return string.Format("{0},{1},{2},{3}",Left,Top,Right,Bottom);} }
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; public Point(int x,int y){X=x;Y=y;} }
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr w);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr w);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr w);
 [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtrW(IntPtr w,int index);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr w,int command);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr w,IntPtr after,int x,int y,int cx,int cy,uint flags);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr w,out Rect rect);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr w,StringBuilder text,int max);
 public static string Info(IntPtr w){var text=new StringBuilder(512);GetClassName(w,text,512);Rect r;GetWindowRect(w,out r);return string.Format("{0} {1} {2}",w,text,r);}
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr w,uint flags);
 [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint thread,ref GuiInfo info);
 public static string FocusInfo(){var info=new GuiInfo();info.Size=(uint)Marshal.SizeOf(info);GetGUIThreadInfo(0,ref info);return Info(info.Focus);}
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr w,StringBuilder text,int max);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr w,uint msg,UIntPtr size,StringBuilder text);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
 public static void Click(int x,int y){SetCursorPos(x,y);mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);}
 public static void WinD(){keybd_event(0x5b,0,0,UIntPtr.Zero);keybd_event(0x44,0,0,UIntPtr.Zero);keybd_event(0x44,0,2,UIntPtr.Zero);keybd_event(0x5b,0,2,UIntPtr.Zero);}
 public static void Key(byte k){keybd_event(k,0,0,UIntPtr.Zero);keybd_event(k,0,2,UIntPtr.Zero);}
}
'@
$statePath = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString() + '.json')
$originalForeground = [DesktopProbe]::GetForegroundWindow()
$originalCursor = [DesktopProbe+Point]::new(0,0)
[void][DesktopProbe]::GetCursorPos([ref]$originalCursor)
$process = Start-Process -FilePath (Resolve-Path -LiteralPath $Probe) -ArgumentList ('"' + $statePath + '"') -WindowStyle Hidden -RedirectStandardError ($statePath + '.err') -PassThru
$desktopShown = $false
try {
 for($i=0; $i -lt 60 -and !(Test-Path -LiteralPath $statePath); $i++){Start-Sleep -Milliseconds 100}
 $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
 $widget = [IntPtr]$state.widget
 $editor = [IntPtr]$state.editor
 $application = [IntPtr]$state.application
 $style = [DesktopProbe]::GetWindowLongPtrW($widget,-20).ToInt64()
 if(($style -band 0x80) -eq 0 -or ($style -band 0x40000) -ne 0){throw 'Task switcher style is incorrect'}
 [void][DesktopProbe]::ShowWindow($application,5)
 [void][DesktopProbe]::ShowWindow($application,5)
 [void][DesktopProbe]::SetWindowPos($application,[IntPtr]::Zero,80,100,420,220,0)
 [void][DesktopProbe]::SetForegroundWindow($application)
 Start-Sleep -Milliseconds 500
 $point = [DesktopProbe+Point]::new(250,180)
 if([DesktopProbe]::WindowFromPoint($point) -ne $application){throw "Normal application not hit: hit=$([DesktopProbe]::Info([DesktopProbe]::WindowFromPoint($point))) application=$([DesktopProbe]::Info($application)) widget=$([DesktopProbe]::Info($widget)) foreground=$([DesktopProbe]::Info([DesktopProbe]::GetForegroundWindow())) visible=$([DesktopProbe]::IsWindowVisible($application))"}
 [DesktopProbe]::WinD(); $desktopShown=$true
 Start-Sleep -Milliseconds 900
 $visible = [DesktopProbe]::IsWindowVisible($widget)
 $iconic = [DesktopProbe]::IsIconic($widget)
 $hit = [DesktopProbe]::WindowFromPoint($point)
 if(!$visible -or $iconic -or [DesktopProbe]::GetAncestor($hit,2) -ne $widget){throw "Win+D failed: visible=$visible iconic=$iconic hit=$([DesktopProbe]::Info($hit)) expected=$([DesktopProbe]::Info($widget)) foreground=$([DesktopProbe]::Info([DesktopProbe]::GetForegroundWindow()))"}
 [void][DesktopProbe]::SetForegroundWindow($widget)
 [DesktopProbe]::Click(250,180)
 Start-Sleep -Milliseconds 250
 if([DesktopProbe]::GetForegroundWindow() -ne $widget){throw 'Widget could not receive keyboard focus'}
 [DesktopProbe]::Key(0x23) # End
 [DesktopProbe]::Key(0x58) # x
 Start-Sleep -Milliseconds 250
 $text = [System.Text.StringBuilder]::new(512)
 [void][DesktopProbe]::SendMessage($editor,13,[UIntPtr]::new([uint32]512),$text)
 if(!$text.ToString().EndsWith('x')){throw "Keyboard input failed: $text focus=$([DesktopProbe]::FocusInfo()) editor=$editor foreground=$([DesktopProbe]::Info([DesktopProbe]::GetForegroundWindow()))"}
 [DesktopProbe]::WinD(); $desktopShown=$false
 Start-Sleep -Milliseconds 400
 [void][DesktopProbe]::ShowWindow($application,5)
 [void][DesktopProbe]::SetForegroundWindow($application)
 Start-Sleep -Milliseconds 400
 if([DesktopProbe]::WindowFromPoint($point) -ne $application){throw 'Widget rose above an application after editing'}
 Write-Output 'PASS: desktop layer, Win+D, keyboard input, application overlap, task switcher styles'
} finally {
 if($desktopShown){[DesktopProbe]::WinD()}
 if(!$process.HasExited){Stop-Process -Id $process.Id}
 [void][DesktopProbe]::SetForegroundWindow($originalForeground)
 [void][DesktopProbe]::SetCursorPos($originalCursor.X,$originalCursor.Y)
 if(Test-Path -LiteralPath $statePath){Remove-Item -LiteralPath $statePath}
 if(Test-Path -LiteralPath ($statePath+'.err')){Get-Content -LiteralPath ($statePath+'.err');Remove-Item -LiteralPath ($statePath+'.err')}
}
