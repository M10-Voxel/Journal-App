//! The desktop wallpaper behind a transparent widget. The page lays it exactly where it lies on its monitor and blurs it
//! (WidgetBackdrop.tsx): a constant frosted background of free strength, clipped to the widget's rounded area.
//!
//! Each monitor can show a picture of its own, so the pictures are read per monitor (IDesktopWallpaper: the picture
//! and the monitor's rectangle in physical desktop pixels, plus how pictures are laid out). Without that interface (or
//! without any monitor from it) the single picture from the registry stands for every monitor.
//! Widgets lie on the desktop below all windows, so nothing but the wallpaper (and the icons) is ever behind them.
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct Monitor { x:i32, y:i32, width:u32, height:u32, modified:u64, #[serde(skip)] path:String }
#[derive(Serialize)]
pub struct Wallpapers { position:String, monitors:Vec<Monitor> }

fn modified(path:&str)->u64{
    std::fs::metadata(path).and_then(|m|m.modified()).ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0,|d|d.as_secs())
}
/// Windows keeps its own copy of the shown picture; the original may have been moved or deleted since.
fn existing(path:String)->String{
    if !path.is_empty()&&std::path::Path::new(&path).is_file(){return path;}
    std::env::var("APPDATA").ok().map(|roaming|std::path::Path::new(&roaming).join("Microsoft\\Windows\\Themes\\TranscodedWallpaper"))
        .filter(|copy|copy.is_file()).map(|copy|copy.to_string_lossy().into_owned()).unwrap_or(path)
}

#[cfg(windows)]
unsafe fn text(value:windows::core::PWSTR)->String{
    unsafe{let result=value.to_string().unwrap_or_default();windows::Win32::System::Com::CoTaskMemFree(Some(value.0 as *const core::ffi::c_void));result}
}
#[cfg(windows)]
fn per_monitor()->Result<Wallpapers,String>{
    use windows::Win32::System::Com::{CoCreateInstance,CoInitializeEx,CoTaskMemFree,CLSCTX_ALL,COINIT_MULTITHREADED};
    use windows::Win32::UI::Shell::{DesktopWallpaper,IDesktopWallpaper};
    use windows::core::PCWSTR;
    unsafe{
        let _=CoInitializeEx(None,COINIT_MULTITHREADED);
        let wallpaper:IDesktopWallpaper=CoCreateInstance(&DesktopWallpaper,None,CLSCTX_ALL).map_err(|e|e.to_string())?;
        let position=match wallpaper.GetPosition().map(|p|p.0).unwrap_or(4){0=>"center",1=>"tile",2=>"stretch",3=>"fit",5=>"span",_=>"fill"}.to_string();
        let count=wallpaper.GetMonitorDevicePathCount().map_err(|e|e.to_string())?;
        let mut monitors=Vec::new();
        for index in 0..count{
            let Ok(id)=wallpaper.GetMonitorDevicePathAt(index) else {continue};
            let monitor=PCWSTR(id.0 as *const u16);
            let rect=wallpaper.GetMonitorRECT(monitor);
            let path=wallpaper.GetWallpaper(monitor).map(|value|text(value)).unwrap_or_default();
            CoTaskMemFree(Some(id.0 as *const core::ffi::c_void));
            // A monitor Windows remembers but that is not attached has no rectangle.
            let Ok(rect)=rect else {continue};
            if rect.right<=rect.left||rect.bottom<=rect.top{continue;}
            let path=existing(path);
            monitors.push(Monitor{x:rect.left,y:rect.top,width:(rect.right-rect.left) as u32,height:(rect.bottom-rect.top) as u32,modified:modified(&path),path});
        }
        if monitors.is_empty(){return Err("Keine Bildschirme mit Hintergrundbild.".into());}
        Ok(Wallpapers{position,monitors})
    }
}
/// The registry's single picture on every monitor (older systems, or when the interface is not available).
#[cfg(windows)]
fn from_registry(screens:&[(i32,i32,u32,u32)])->Result<Wallpapers,String>{
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let desktop=RegKey::predef(HKEY_CURRENT_USER).open_subkey("Control Panel\\Desktop").map_err(|e|e.to_string())?;
    let path=existing(desktop.get_value("WallPaper").unwrap_or_default());
    let style:String=desktop.get_value("WallpaperStyle").unwrap_or_else(|_|String::from("10"));
    let tile:String=desktop.get_value("TileWallpaper").unwrap_or_else(|_|String::from("0"));
    let position=if tile.trim()=="1"{"tile"}else{match style.trim(){"0"=>"center","2"=>"stretch","6"=>"fit","22"=>"span",_=>"fill"}}.to_string();
    let changed=modified(&path);
    Ok(Wallpapers{position,monitors:screens.iter().map(|&(x,y,width,height)|Monitor{x,y,width,height,modified:changed,path:path.clone()}).collect()})
}
#[cfg(windows)]
fn read(screens:Vec<(i32,i32,u32,u32)>)->Result<Wallpapers,String>{per_monitor().or_else(|_|from_registry(&screens))}
#[cfg(not(windows))]
fn read(_:Vec<(i32,i32,u32,u32)>)->Result<Wallpapers,String>{Err("Das Hintergrundbild ist nur unter Windows verfügbar.".into())}

/// The monitors (whole monitor, not the work area) for the registry fallback.
fn screens(window:&tauri::WebviewWindow)->Vec<(i32,i32,u32,u32)>{
    window.available_monitors().map(|list|list.iter().map(|m|(m.position().x,m.position().y,m.size().width,m.size().height)).collect()).unwrap_or_default()
}
async fn wallpapers(window:&tauri::WebviewWindow)->Result<Wallpapers,String>{
    let screens=screens(window);
    tauri::async_runtime::spawn_blocking(move||read(screens)).await.map_err(|e|e.to_string())?
}

/// The layout and, per monitor, its rectangle (physical desktop pixels) and when its picture last changed.
#[tauri::command] pub async fn desktop_wallpaper_info(window:tauri::WebviewWindow)->Result<Wallpapers,String>{wallpapers(&window).await}

/// The picture of one monitor (its index in `desktop_wallpaper_info`) as raw bytes (an ArrayBuffer in the page).
#[tauri::command] pub async fn desktop_wallpaper(window:tauri::WebviewWindow,monitor:usize)->Result<tauri::ipc::Response,String>{
    let list=wallpapers(&window).await?;
    let path=list.monitors.get(monitor).map(|m|m.path.clone()).filter(|p|!p.is_empty()).ok_or("Kein Hintergrundbild für diesen Bildschirm.")?;
    let bytes=tauri::async_runtime::spawn_blocking(move||{
        if std::fs::metadata(&path).map_err(|e|e.to_string())?.len()>80_000_000{return Err("Das Hintergrundbild ist zu groß.".to_string());}
        std::fs::read(&path).map_err(|e|e.to_string())
    }).await.map_err(|e|e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}
