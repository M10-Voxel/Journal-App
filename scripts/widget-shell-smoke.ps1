param([long]$Widget, [long]$Application, [double]$EditorX, [double]$EditorY)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WidgetShell {
 [StructLayout(LayoutKind.Sequential)] public struct Point {public int X,Y;public Point(int x,int y){X=x;Y=y;}}
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr w,out Rect r);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr w,IntPtr region);
 [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int x1,int y1,int x2,int y2);
 [DllImport("gdi32.dll")] public static extern int GetRgnBox(IntPtr region,out Rect r);
 [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
 public static Rect WidgetRect(IntPtr w){
  Rect canvas,rect;GetWindowRect(w,out canvas);var region=CreateRectRgn(0,0,0,0);
  try{if(GetWindowRgn(w,region)==0)return canvas;GetRgnBox(region,out rect);rect.Left+=canvas.Left;rect.Right+=canvas.Left;rect.Top+=canvas.Top;rect.Bottom+=canvas.Top;return rect;}finally{DeleteObject(region);}
 }
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr w);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr w);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr w);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr w,int c);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr w,IntPtr after,int x,int y,int width,int height,uint flags);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr w,uint flags);
 [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtrW(IntPtr w,int index);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr w,StringBuilder text,int size);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 public static void Key(byte k){keybd_event(k,0,0,UIntPtr.Zero);keybd_event(k,0,2,UIntPtr.Zero);}
 public static void WinD(){keybd_event(0x5b,0,0,UIntPtr.Zero);Key(0x44);keybd_event(0x5b,0,2,UIntPtr.Zero);}
 public static void Click(Point p){SetCursorPos(p.X,p.Y);mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);}
 public static IntPtr RootAt(Point p){return GetAncestor(WindowFromPoint(p),2);}
 public static string Info(IntPtr w){var text=new StringBuilder(256);GetClassName(w,text,256);return w+" "+text.ToString()+" style="+GetWindowLongPtrW(w,-20).ToInt64().ToString("x");}
}
'@
$widgetWindow=[IntPtr]$Widget
$normalWindow=[IntPtr]$Application
[void][WidgetShell]::SetThreadDpiAwarenessContext([IntPtr](-4))
$originalForeground=[WidgetShell]::GetForegroundWindow()
$originalCursor=[WidgetShell+Point]::new(0,0)
[void][WidgetShell]::GetCursorPos([ref]$originalCursor)
$canvasRect=[WidgetShell+Rect]::new()
$normalRect=[WidgetShell+Rect]::new()
[void][WidgetShell]::GetWindowRect($widgetWindow,[ref]$canvasRect)
$widgetRect=[WidgetShell]::WidgetRect($widgetWindow)
[void][WidgetShell]::GetWindowRect($normalWindow,[ref]$normalRect)
$point=[WidgetShell+Point]::new(($canvasRect.Left+($canvasRect.Right-$canvasRect.Left)*$EditorX),($canvasRect.Top+($canvasRect.Bottom-$canvasRect.Top)*$EditorY))
$desktopShown=$false
try {
 $style=[WidgetShell]::GetWindowLongPtrW($widgetWindow,-20).ToInt64()
 if(($style -band 0x80)-eq 0 -or ($style -band 0x40000)-ne 0 -or ($style -band 0x08000000)-ne 0){throw ('Incorrect desktop widget task switcher/input styles: 0x'+$style.ToString('x'))}
 [void][WidgetShell]::ShowWindow($normalWindow,9)
 [void][WidgetShell]::ShowWindow($normalWindow,9)
 [void][WidgetShell]::SetWindowPos($normalWindow,[IntPtr]::Zero,$widgetRect.Left,$widgetRect.Top,($widgetRect.Right-$widgetRect.Left),($widgetRect.Bottom-$widgetRect.Top),0)
 [void][WidgetShell]::SetForegroundWindow($normalWindow)
 Start-Sleep -Milliseconds 500
 if([WidgetShell]::RootAt($point)-ne $normalWindow){throw "Normal app overlap failed: hit=$([WidgetShell]::Info([WidgetShell]::RootAt($point))) foreground=$([WidgetShell]::Info([WidgetShell]::GetForegroundWindow())) normal=$([WidgetShell]::Info($normalWindow)) widget=$([WidgetShell]::Info($widgetWindow))"}
 [WidgetShell]::WinD();$desktopShown=$true
 Start-Sleep -Milliseconds 1000
 if(![WidgetShell]::IsWindowVisible($widgetWindow)-or [WidgetShell]::IsIconic($widgetWindow)-or [WidgetShell]::RootAt($point)-ne $widgetWindow){throw 'Actual WebView2 widget is not accessible after Win+D'}
 [WidgetShell]::Click($point)
 Start-Sleep -Milliseconds 250
 if([WidgetShell]::GetForegroundWindow()-ne $widgetWindow){throw 'The actual widget did not receive native focus'}
 [WidgetShell]::Key(0x23)
 [WidgetShell]::Key(0x58)
 Start-Sleep -Milliseconds 350
 # Exercise the app's header drag and corner resize using actual mouse input.
 $header=[WidgetShell+Point]::new(($widgetRect.Left+40),($widgetRect.Top+16))
 [void][WidgetShell]::SetCursorPos($header.X,$header.Y)
 [WidgetShell]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 200
 [void][WidgetShell]::SetCursorPos(($header.X+30),($header.Y+20))
 Start-Sleep -Milliseconds 250
 [WidgetShell]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 300
 $movedRect=[WidgetShell]::WidgetRect($widgetWindow)
 if($movedRect.Left -eq $widgetRect.Left -and $movedRect.Top -eq $widgetRect.Top){throw 'The header did not move the actual native widget'}
 [void][WidgetShell]::SetCursorPos(($movedRect.Right-6),($movedRect.Bottom-6))
 [WidgetShell]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 200
 [void][WidgetShell]::SetCursorPos(($movedRect.Right+34),($movedRect.Bottom+24))
 Start-Sleep -Milliseconds 250
 [WidgetShell]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 1200
 $resizedRect=[WidgetShell]::WidgetRect($widgetWindow)
 if(($resizedRect.Right-$resizedRect.Left)-le ($movedRect.Right-$movedRect.Left)-or ($resizedRect.Bottom-$resizedRect.Top)-le ($movedRect.Bottom-$movedRect.Top)){throw 'The corner did not resize the actual native widget'}
 [WidgetShell]::WinD();$desktopShown=$false
 [void][WidgetShell]::ShowWindow($normalWindow,9)
 [void][WidgetShell]::SetWindowPos($normalWindow,[IntPtr]::Zero,$widgetRect.Left,$widgetRect.Top,($widgetRect.Right-$widgetRect.Left),($widgetRect.Bottom-$widgetRect.Top),0)
 [void][WidgetShell]::SetForegroundWindow($normalWindow)
 Start-Sleep -Milliseconds 500
 if([WidgetShell]::RootAt($point)-ne $normalWindow){throw 'The actual widget rose above an app after editing'}
 Write-Output 'PASS: actual WebView2 desktop layer, Win+D, native click/focus, drag/resize, task switcher styles, application overlap'
} finally {
 [WidgetShell]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
 if($desktopShown){[WidgetShell]::WinD()}
 [void][WidgetShell]::ShowWindow($normalWindow,0)
 [void][WidgetShell]::SetWindowPos($normalWindow,[IntPtr]::Zero,$normalRect.Left,$normalRect.Top,($normalRect.Right-$normalRect.Left),($normalRect.Bottom-$normalRect.Top),0x10)
 [void][WidgetShell]::SetForegroundWindow($originalForeground)
 [void][WidgetShell]::SetCursorPos($originalCursor.X,$originalCursor.Y)
}
