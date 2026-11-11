//! The desktop wallpaper behind a transparent widget. The page lays it exactly where it lies on the monitor and blurs it
//! (WidgetBackdrop.tsx): a constant frosted background of free strength, clipped to the widget's rounded area.
use serde::Serialize;

#[derive(Serialize)]
pub struct WallpaperInfo { path:String, style:String, tile:bool, modified:u64 }

#[cfg(windows)]
fn read()->Result<WallpaperInfo,String>{
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let desktop=RegKey::predef(HKEY_CURRENT_USER).open_subkey("Control Panel\\Desktop").map_err(|e|e.to_string())?;
    let mut path:String=desktop.get_value("WallPaper").unwrap_or_default();
    // Windows keeps its own copy of the shown picture; the original may have been moved or deleted since.
    if path.is_empty()||!std::path::Path::new(&path).is_file(){
        if let Ok(roaming)=std::env::var("APPDATA"){
            let copy=std::path::Path::new(&roaming).join("Microsoft\\Windows\\Themes\\TranscodedWallpaper");
            if copy.is_file(){path=copy.to_string_lossy().into_owned();}
        }
    }
    let style:String=desktop.get_value("WallpaperStyle").unwrap_or_else(|_|String::from("10"));
    let tile:String=desktop.get_value("TileWallpaper").unwrap_or_else(|_|String::from("0"));
    let modified=std::fs::metadata(&path).and_then(|m|m.modified()).ok()
        .and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0,|d|d.as_secs());
    Ok(WallpaperInfo{path,style:style.trim().to_string(),tile:tile.trim()=="1",modified})
}
#[cfg(not(windows))]
fn read()->Result<WallpaperInfo,String>{Err("Das Hintergrundbild ist nur unter Windows verfügbar.".into())}

#[tauri::command] pub async fn desktop_wallpaper_info()->Result<WallpaperInfo,String>{read()}

/// The picture itself as raw bytes (an ArrayBuffer in the page).
#[tauri::command] pub async fn desktop_wallpaper()->Result<tauri::ipc::Response,String>{
    let info=read()?;
    if info.path.is_empty(){return Err("Kein Hintergrundbild gesetzt.".into());}
    let size=std::fs::metadata(&info.path).map_err(|e|e.to_string())?.len();
    if size>80_000_000{return Err("Das Hintergrundbild ist zu groß.".into());}
    Ok(tauri::ipc::Response::new(std::fs::read(&info.path).map_err(|e|e.to_string())?))
}
