//! A stable transparent desktop canvas. Popup toggles change its input region, never its window geometry.
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use super::{geometry::{self, Bounds, Screen}, DesktopWidgets};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct Rect { pub left:f64, pub top:f64, pub width:f64, pub height:f64 }
#[derive(Clone, Deserialize)]
pub struct Viewport { pub width:f64, pub height:f64, pub scale:f64 }
#[derive(Clone)]
pub struct Surface {
    pub position:tauri::PhysicalPosition<i32>, pub size:tauri::PhysicalSize<u32>,
    pub monitor:Screen,
    canvas:tauri::PhysicalRect<i32,u32>, units:f64, minimum:(f64,f64),
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Geometry { pub widget:Rect, pub bounds:Rect, pub scale:f64, pub monitor_width:f64, pub min_width:f64, pub min_height:f64 }
fn canvas(screens:&[Screen])->Result<tauri::PhysicalRect<i32,u32>,String>{
    let left=screens.iter().map(|s|s.x).min().ok_or("Kein Bildschirm verfügbar.")?;
    let top=screens.iter().map(|s|s.y).min().unwrap();
    let right=screens.iter().map(|s|s.x as i64+s.width as i64).max().unwrap();
    let bottom=screens.iter().map(|s|s.y as i64+s.height as i64).max().unwrap();
    Ok(tauri::PhysicalRect{position:tauri::PhysicalPosition::new(left,top),size:tauri::PhysicalSize::new((right-left as i64) as u32,(bottom-top as i64) as u32)})
}
impl Surface {
    fn geometry(&self)->Geometry {
        let s=&self.monitor;
        Geometry {
            widget:Rect{left:(self.position.x-self.canvas.position.x) as f64/self.units,top:(self.position.y-self.canvas.position.y) as f64/self.units,width:self.size.width as f64/self.units,height:self.size.height as f64/self.units},
            bounds:Rect{left:(s.x-self.canvas.position.x) as f64/self.units,top:(s.y-self.canvas.position.y) as f64/self.units,width:s.width as f64/self.units,height:s.height as f64/self.units},
            scale:self.units,monitor_width:s.width as f64/s.scale,
            min_width:(self.minimum.0*s.scale).min(s.width as f64)/self.units,min_height:(self.minimum.1*s.scale).min(s.height as f64)/self.units,
        }
    }
    fn region(&self,window:&tauri::WebviewWindow,rects:&[Rect])->Result<(),String>{
        #[cfg(windows)] {
            let mut regions=vec![(self.position.x-self.canvas.position.x,self.position.y-self.canvas.position.y,self.size.width as i32,self.size.height as i32)];
            for r in rects {regions.push(((r.left*self.units).floor() as i32,(r.top*self.units).floor() as i32,(r.width*self.units).ceil() as i32,(r.height*self.units).ceil() as i32));}
            super::host::region(window.hwnd().map_err(|e|e.to_string())?.0 as isize,Some(&regions))?;
        }
        Ok(())
    }
}

/// Placement and monitor topology can change independently of popup visibility.
pub fn relocate(window:&tauri::WebviewWindow,bounds:&Bounds,screens:&[Screen])->Result<bool,String>{
    let state=window.state::<DesktopWidgets>();
    let (_,runtime)=state.from_window(window)?;
    let next={
        let mut guard=runtime.surface.lock().map_err(|e|e.to_string())?;
        let Some(surface)=guard.as_mut() else{return Ok(false);};
        let monitor=geometry::screen_for(bounds.x,bounds.y,1,1,screens).ok_or("Kein Bildschirm verfügbar.")?.clone();
        surface.position=tauri::PhysicalPosition::new(bounds.x,bounds.y);
        surface.size=tauri::PhysicalSize::new((bounds.width*monitor.scale).round() as u32,(bounds.height*monitor.scale).round() as u32);
        surface.monitor=monitor;
        let next_canvas=canvas(screens)?;
        let resized=surface.canvas.position!=next_canvas.position||surface.canvas.size!=next_canvas.size;surface.canvas=next_canvas;
        (surface.clone(),resized)
    };
    if next.1 {window.set_position(next.0.canvas.position).map_err(|e|e.to_string())?;window.set_size(next.0.canvas.size).map_err(|e|e.to_string())?;}
    next.0.region(window,&[])?;
    runtime.changed.fetch_add(1,std::sync::atomic::Ordering::Relaxed);
    window.emit("widget:surface-changed",()).map_err(|e|e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn desktop_widget_surface(window:tauri::WebviewWindow,active:bool,viewport:Viewport,rects:Vec<Rect>,widget:Option<Rect>,finish:Option<bool>)->Result<Option<Geometry>,String>{
    let valid=|r:&Rect|[r.left,r.top,r.width,r.height].iter().all(|n|n.is_finite()&&n.abs()<=100_000.0)&&r.width>=0.0&&r.height>=0.0;
    if !viewport.width.is_finite()||!viewport.height.is_finite()||viewport.width<1.0||viewport.height<1.0||!viewport.scale.is_finite()||viewport.scale<0.25||viewport.scale>16.0||rects.len()>32||rects.iter().any(|r|!valid(r))||widget.as_ref().is_some_and(|r|!valid(r)) {return Err("Ungültige Widget-Abmessungen.".into());}
    let state=window.state::<DesktopWidgets>();
    let (config,runtime)=state.from_window(&window)?;
    let (screens,_)=super::screens(&window)?;
    if widget.is_some()&&config.locked{return Err("Die Widget-Position ist gesperrt.".into());}
    let first=runtime.surface.lock().map_err(|e|e.to_string())?.is_none();
    if first {
        let position=window.outer_position().map_err(|e|e.to_string())?;
        let size=window.inner_size().map_err(|e|e.to_string())?;
        let monitor=geometry::screen_for(position.x,position.y,size.width,size.height,&screens).ok_or("Kein Bildschirm verfügbar.")?.clone();
        *runtime.surface.lock().map_err(|e|e.to_string())?=Some(Surface{position,size,monitor,canvas:canvas(&screens)?,units:viewport.scale,minimum:config.kind.minimum_size()});
    }
    let surface={
        let mut guard=runtime.surface.lock().map_err(|e|e.to_string())?;
        let surface=guard.as_mut().ok_or("Widget wird geschlossen.")?;
        surface.units=viewport.scale;
        if let Some(rect)=widget {
            let x=surface.canvas.position.x+(rect.left*surface.units).round() as i32;
            let y=surface.canvas.position.y+(rect.top*surface.units).round() as i32;
            let width=(rect.width*surface.units).round() as u32;let height=(rect.height*surface.units).round() as u32;
            let monitor=geometry::screen_for(x,y,width,height,&screens).ok_or("Kein Bildschirm verfügbar.")?.clone();
            let width=width.clamp((surface.minimum.0*monitor.scale).min(monitor.width as f64) as u32,monitor.width);
            let height=height.clamp((surface.minimum.1*monitor.scale).min(monitor.height as f64) as u32,monitor.height);
            surface.position=if finish.unwrap_or(false){tauri::PhysicalPosition::new(x.clamp(monitor.x,monitor.x+(monitor.width-width) as i32),y.clamp(monitor.y,monitor.y+(monitor.height-height) as i32))}else{tauri::PhysicalPosition::new(x,y)};
            surface.size=tauri::PhysicalSize::new(width,height);surface.monitor=monitor;
            runtime.changed.fetch_add(1,std::sync::atomic::Ordering::Relaxed);
        } else {surface.monitor=geometry::screen_for(surface.position.x,surface.position.y,surface.size.width,surface.size.height,&screens).ok_or("Kein Bildschirm verfügbar.")?.clone();}
        surface.clone()
    };
    // Neither native position/size nor CSS is changed by a popup toggle.
    if first {window.set_position(surface.canvas.position).map_err(|e|e.to_string())?;window.set_size(surface.canvas.size).map_err(|e|e.to_string())?;}
    surface.region(&window,if active{&rects}else{&[]})?;
    Ok(Some(surface.geometry()))
}

pub fn dismiss_if_external(window:&tauri::Window){
    #[cfg(windows)] {
        let app=window.app_handle().clone();
        let label=window.label().to_owned();
        std::thread::spawn(move||{std::thread::sleep(std::time::Duration::from_millis(40));
            let widget_focused=app.get_webview_window(&label).is_some_and(|w|w.is_focused().unwrap_or(false));
            let main_focused=app.get_webview_window("main").is_some_and(|w|w.is_focused().unwrap_or(false));
            if !widget_focused&&!main_focused{let _=app.emit_to(&label,"widget:popups-dismiss",());}
        });
    }
}
