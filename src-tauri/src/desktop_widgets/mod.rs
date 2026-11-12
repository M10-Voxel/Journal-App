pub mod host;
mod config;
mod geometry;
pub mod smoke;
pub mod surface;
pub mod wallpaper;
pub use config::{widget_id,window_label};
use config::{Config,WidgetConfig,WidgetKind};
use geometry::{Placement,Screen};
use serde::{Deserialize,Serialize};
use std::{collections::HashMap,io::Write,path::PathBuf,sync::{Arc,Mutex,atomic::{AtomicBool,AtomicU64,Ordering}},time::{Duration,Instant}};
use tauri::{Emitter,Manager};

pub struct WidgetRuntime {
    content_ready:AtomicBool,opening:AtomicBool,changed:AtomicU64,
    error:Mutex<Option<String>>,surface:Mutex<Option<surface::Surface>>,last_attempt:Mutex<Instant>,copy_from:Mutex<Option<String>>,
}
impl Default for WidgetRuntime{fn default()->Self{Self{content_ready:AtomicBool::new(false),opening:AtomicBool::new(false),changed:AtomicU64::new(0),error:Mutex::new(None),surface:Mutex::new(None),last_attempt:Mutex::new(Instant::now()-Duration::from_secs(3)),copy_from:Mutex::new(None)}}}
pub struct DesktopWidgets {
    path:PathBuf,config:Mutex<Config>,ready:AtomicBool,updating:AtomicBool,legacy:AtomicBool,
    error:Mutex<Option<String>>,runtimes:Mutex<HashMap<String,Arc<WidgetRuntime>>>,
}
#[derive(Clone,Serialize)] pub struct WidgetView {#[serde(flatten)] config:WidgetConfig,error:Option<String>}
#[derive(Serialize)] pub struct WidgetType {kind:WidgetKind,available:bool}
#[derive(Serialize)] pub struct WidgetState {supported:bool,autostart:bool,widgets:Vec<WidgetView>,types:Vec<WidgetType>,error:Option<String>}
#[derive(Default,Deserialize)] pub struct WidgetUpdate {enabled:Option<bool>,locked:Option<bool>,name:Option<String>,autostart:Option<bool>,#[serde(default)]reset:bool}
struct Updating<'a>(&'a AtomicBool);
impl Drop for Updating<'_>{fn drop(&mut self){self.0.store(false,Ordering::SeqCst);}}
impl DesktopWidgets {
    pub fn new(dir:PathBuf)->Self{
        let path=dir.join("desktop-widgets.json");
        let (config,legacy,error)=match std::fs::read(&path){
            Ok(bytes)=>match Config::decode(&bytes){Ok((config,legacy))=>(config,legacy,None),Err(e)=>(Config::default(),false,Some(format!("Widget-Einstellungen konnten nicht gelesen werden: {e}")))},
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>(Config::default(),false,None),Err(e)=>(Config::default(),false,Some(e.to_string())),
        };
        Self{path,config:Mutex::new(config),ready:AtomicBool::new(false),updating:AtomicBool::new(false),legacy:AtomicBool::new(legacy),error:Mutex::new(error),runtimes:Mutex::new(HashMap::new())}
    }
    fn runtime(&self,id:&str)->Result<Arc<WidgetRuntime>,String>{Ok(self.runtimes.lock().map_err(|e|e.to_string())?.entry(id.into()).or_default().clone())}
    fn instance(&self,id:&str)->Result<WidgetConfig,String>{Ok(self.config.lock().map_err(|e|e.to_string())?.get(id)?.clone())}
    fn from_window(&self,window:&tauri::WebviewWindow)->Result<(WidgetConfig,Arc<WidgetRuntime>),String>{
        let id=widget_id(window.label()).ok_or("Dieses Fenster ist kein Desktop-Widget.")?;
        Ok((self.instance(id)?,self.runtime(id)?))
    }
    fn begin(&self)->Result<Updating<'_>,String>{
        if !cfg!(windows){return Err("Desktop-Widgets sind derzeit nur unter Windows verfügbar.".into());}
        if let Some(error)=self.error.lock().map_err(|e|e.to_string())?.as_ref(){return Err(error.clone());}
        if self.updating.swap(true,Ordering::SeqCst){return Err("Widget-Einstellungen werden gerade gespeichert.".into());}
        Ok(Updating(&self.updating))
    }
    fn persist(&self,config:&Config)->Result<(),String>{
        config.validate()?;
        if let Some(parent)=self.path.parent(){std::fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
        if self.legacy.load(Ordering::Relaxed){
            let backup=self.path.with_file_name("desktop-widgets.v1-backup.json");
            match std::fs::OpenOptions::new().write(true).create_new(true).open(backup){
                Ok(mut file)=>file.write_all(&std::fs::read(&self.path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?,
                Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>{},Err(e)=>return Err(e.to_string()),
            }
        }
        let tmp=self.path.with_extension("json.tmp");std::fs::write(&tmp,serde_json::to_vec_pretty(config).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        std::fs::rename(tmp,&self.path).map_err(|e|e.to_string())?;self.legacy.store(false,Ordering::Relaxed);Ok(())
    }
    fn save(&self,mut next:Config,reset_id:Option<&str>)->Result<(),String>{
        let mut config=self.config.lock().map_err(|e|e.to_string())?;
        // A position save may have completed while the menu was preparing a rename or visibility change.
        for widget in &mut next.widgets{if reset_id!=Some(widget.id.as_str()){if let Ok(current)=config.get(&widget.id){widget.placement=current.placement.clone();widget.layouts=current.layouts.clone();}}}
        self.persist(&next)?;*config=next;Ok(())
    }
    fn state(&self)->Result<WidgetState,String>{
        let config=self.config.lock().map_err(|e|e.to_string())?.clone();
        let runtimes=self.runtimes.lock().map_err(|e|e.to_string())?;
        let widgets=config.widgets.into_iter().map(|config|{let error=runtimes.get(&config.id).and_then(|r|r.error.lock().ok().and_then(|e|e.clone()));WidgetView{config,error}}).collect();
        Ok(WidgetState{supported:cfg!(windows),autostart:config.autostart,widgets,types:[WidgetKind::DailyNote,WidgetKind::Calendar,WidgetKind::Board,WidgetKind::DayValues,WidgetKind::Activities,WidgetKind::Notebook].into_iter().map(|kind|WidgetType{kind,available:kind.available()}).collect(),error:self.error.lock().ok().and_then(|e|e.clone())})
    }
    fn broadcast(&self,app:&tauri::AppHandle)->Result<WidgetState,String>{let state=self.state()?;app.emit("desktop-widget:state",&state).map_err(|e|e.to_string())?;Ok(state)}
}
fn authorize(window:&tauri::WebviewWindow,id:Option<&str>)->Result<(),String>{
    if window.label()=="main"||id.is_some_and(|id|widget_id(window.label())==Some(id)){Ok(())}else{Err("Widget-Einstellungen können nur im Journal oder für das eigene Widget geändert werden.".into())}
}
fn screens(window:&tauri::WebviewWindow)->Result<(Vec<Screen>,usize),String>{
    let monitors=window.available_monitors().map_err(|e|e.to_string())?;
    let primary=window.primary_monitor().map_err(|e|e.to_string())?.and_then(|p|monitors.iter().position(|m|m.position()==p.position())).unwrap_or(0);
    Ok((monitors.iter().map(|m|{let w=m.work_area();Screen{name:m.name().cloned().unwrap_or_else(||format!("{},{}",m.position().x,m.position().y)),id:format!("{},{},{},{}",m.position().x,m.position().y,m.size().width,m.size().height),x:w.position.x,y:w.position.y,width:w.size.width,height:w.size.height,scale:m.scale_factor()}}).collect(),primary))
}
/// Puts a widget where it belongs on the monitors now attached (geometry::resolve); `reset` forgets its places.
fn place(window:&tauri::WebviewWindow,reset:bool)->Result<(),String>{
    let (screens,primary)=screens(window)?;
    let state=window.state::<DesktopWidgets>();
    let (widget,_)=state.from_window(window)?;
    let index=state.config.lock().map_err(|e|e.to_string())?.widgets.iter().position(|w|w.id==widget.id).unwrap_or(0);
    let none=std::collections::BTreeMap::new();
    let (home,layouts)=if reset{(None,&none)}else{(widget.placement.as_ref(),&widget.layouts)};
    let bounds=geometry::resolve(home,layouts,&screens,primary,widget.kind.minimum_size(),widget.kind.default_size(),index).ok_or("Kein Bildschirm verfügbar.")?;
    if surface::relocate(window,&bounds,&screens)?{return Ok(());}
    window.set_position(tauri::PhysicalPosition::new(bounds.x,bounds.y)).map_err(|e|e.to_string())?;window.set_size(tauri::LogicalSize::new(bounds.width,bounds.height)).map_err(|e|e.to_string())?;Ok(())
}
/// The open widgets in their chosen stacking (back to front): checked by the maintenance loop, set after opening, after
/// focusing (which must not bring one widget to the front) and when the order is changed in the settings.
fn restack(app:&tauri::AppHandle){
    #[cfg(windows)]{
        let state=app.state::<DesktopWidgets>();
        let mut widgets=state.config.lock().map(|c|c.widgets.clone()).unwrap_or_default();
        widgets.sort_by_key(|w|w.layer);
        let order:Vec<isize>=widgets.iter().filter(|w|w.enabled)
            .filter(|w|state.runtimes.lock().ok().and_then(|r|r.get(&w.id).map(|r|r.content_ready.load(Ordering::Relaxed))).unwrap_or(false))
            .filter_map(|w|app.get_webview_window(&window_label(&w.id))).filter_map(|w|w.hwnd().ok().map(|h|h.0 as isize)).collect();
        if order.len()<2{return;}
        let _=app.run_on_main_thread(move||host::restack(&order));
    }
    #[cfg(not(windows))]{let _=app;}
}
fn remember(app:&tauri::AppHandle,id:&str)->Result<(),String>{
    let Some(window)=app.get_webview_window(&window_label(id))else{return Ok(());};
    if window.is_minimized().unwrap_or(true){return Ok(());}
    let state=app.state::<DesktopWidgets>();let runtime=state.runtime(id)?;
    let original=runtime.surface.lock().map_err(|e|e.to_string())?.clone();
    let pos=match &original{Some(s)=>s.position,None=>window.outer_position().map_err(|e|e.to_string())?};
    let size=match &original{Some(s)=>s.size,None=>window.inner_size().map_err(|e|e.to_string())?};
    if size.width==0||size.height==0{return Ok(());}
    let (screens,_)=screens(&window)?;let Some(monitor)=geometry::screen_for(pos.x,pos.y,size.width,size.height,&screens)else{return Ok(());};
    // A widget mostly off every monitor (Windows just moved the monitors, the widget is about to be put back) is not a
    // place to remember.
    let overlap=((pos.x as i64+size.width as i64).min(monitor.x as i64+monitor.width as i64)-i64::from(pos.x.max(monitor.x))).max(0)
        *((pos.y as i64+size.height as i64).min(monitor.y as i64+monitor.height as i64)-i64::from(pos.y.max(monitor.y))).max(0);
    if overlap*2<size.width as i64*size.height as i64{return Ok(());}
    let mut config=state.config.lock().map_err(|e|e.to_string())?;
    let Some(widget)=config.widgets.iter_mut().find(|w|w.id==id)else{return Ok(());};
    let placement=Placement{monitor:monitor.name.clone(),screen:monitor.id.clone(),x:(pos.x-monitor.x) as f64/monitor.scale,y:(pos.y-monitor.y) as f64/monitor.scale,width:size.width as f64/monitor.scale,height:size.height as f64/monitor.scale};
    // This arrangement remembers the place; the home place only changes while its monitor is attached, so a widget
    // moved aside by a missing monitor goes back once the monitor returns.
    if !geometry::displaced(widget.placement.as_ref(),&screens){widget.placement=Some(placement.clone());}
    widget.layouts.insert(geometry::layout_key(&screens),placement);
    // A handful of arrangements is plenty (a laptop alone, at home, at work …).
    while widget.layouts.len()>8{let Some(oldest)=widget.layouts.keys().find(|key|**key!=geometry::layout_key(&screens)).cloned()else{break};widget.layouts.remove(&oldest);}
    state.persist(&config)
}
#[cfg(windows)] fn autostart(enabled:bool)->Result<(),String>{
    use winreg::{RegKey,enums::{HKEY_CURRENT_USER,KEY_SET_VALUE}};
    let key=RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags("Software\\Microsoft\\Windows\\CurrentVersion\\Run",KEY_SET_VALUE).map_err(|e|e.to_string())?;
    if enabled{key.set_value("Journal",&format!("\"{}\" --background",std::env::current_exe().map_err(|e|e.to_string())?.display())).map_err(|e|e.to_string())}else{match key.delete_value("Journal"){Ok(())=>Ok(()),Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(()),Err(e)=>Err(e.to_string())}}
}
#[cfg(not(windows))] fn autostart(_:bool)->Result<(),String>{Err("Desktop-Widgets sind derzeit nur unter Windows verfügbar.".into())}
async fn open(app:tauri::AppHandle,id:String)->Result<(),String>{
    #[cfg(not(windows))]{let _=(app,id);return Err("Desktop-Widgets sind derzeit nur unter Windows verfügbar.".into());}
    #[cfg(windows)]{
        let label=window_label(&id);if app.get_webview_window(&label).is_some(){return Ok(());}
        let state=app.state::<DesktopWidgets>();let config=state.instance(&id)?;
        if !config.enabled{return Ok(());}
        if !config.kind.available(){return Err("Dieser Widget-Typ ist noch nicht verfügbar.".into());}
        let runtime=state.runtime(&id)?;if runtime.opening.swap(true,Ordering::SeqCst){return Ok(());}
        *runtime.last_attempt.lock().map_err(|e|e.to_string())?=Instant::now();runtime.content_ready.store(false,Ordering::SeqCst);
        let result=(||{
            let title=if config.name.is_empty(){config.kind.title()}else{&config.name};
            let size=config.kind.default_size();let minimum=config.kind.minimum_size();
            // Seed UI preferences inside the widget's WebView environment, before its content mounts.
            let path=runtime.copy_from.lock().map_err(|e|e.to_string())?.as_ref().map(|source|format!("index.html?widget-source={source}")).unwrap_or_else(||"index.html".into());
            let builder=tauri::WebviewWindowBuilder::new(&app,&label,tauri::WebviewUrl::App(path.into()))
                .title(format!("Journal · {title}")).inner_size(size.0,size.1).min_inner_size(minimum.0,minimum.1)
                .decorations(false).transparent(true).shadow(false).skip_taskbar(true).visible(false).focused(false)
                .resizable(false).drag_and_drop(false).additional_browser_args(&crate::browser_args());
            let builder=if let Some(root)=crate::widget_smoke_root(){builder.data_directory(root.join("webview"))}else{builder};
            let window=builder.build().map_err(|e|e.to_string())?;
            let result=place(&window,false);if result.is_err(){let _=window.destroy();}result
        })();runtime.opening.store(false,Ordering::SeqCst);result
    }
}
async fn open_report(app:tauri::AppHandle,id:String){
    if let Err(error)=open(app.clone(),id.clone()).await{
        let state=app.state::<DesktopWidgets>();if let Ok(runtime)=state.runtime(&id){if let Ok(mut value)=runtime.error.lock(){if value.as_ref()!=Some(&error){*value=Some(error);drop(value);let _=state.broadcast(&app);}}}
    }
}
#[tauri::command] pub async fn desktop_widget_state(state:tauri::State<'_,DesktopWidgets>)->Result<WidgetState,String>{state.state()}
#[tauri::command] pub async fn desktop_widget_ready(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<(),String>{
    let state=app.state::<DesktopWidgets>();let (config,runtime)=state.from_window(&window)?;
    if !config.enabled{return Ok(());}
    #[cfg(windows)]{
        let hwnd=window.hwnd().map_err(|e|e.to_string())?.0 as isize;let(tx,rx)=std::sync::mpsc::channel();
        window.run_on_main_thread(move||{let _=tx.send(host::configure(hwnd));}).map_err(|e|e.to_string())?;
        if let Err(error)=rx.recv_timeout(Duration::from_secs(5)).map_err(|e|e.to_string()).and_then(|r|r){*runtime.error.lock().map_err(|e|e.to_string())?=Some(error.clone());let _=state.broadcast(&app);let _=window.destroy();return Err(error);}
    }
    runtime.content_ready.store(true,Ordering::SeqCst);*runtime.error.lock().map_err(|e|e.to_string())?=None;
    window.show().map_err(|e|e.to_string())?;restack(&app);state.broadcast(&app)?;Ok(())
}
#[tauri::command] pub async fn desktop_widget_restore(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<(),String>{
    if window.label()!="main"{return Err("Nur das Journal startet den Widget-Dienst.".into());}
    let state=app.state::<DesktopWidgets>();state.ready.store(true,Ordering::SeqCst);
    let ids=state.config.lock().map_err(|e|e.to_string())?.widgets.iter().filter(|w|w.enabled).map(|w|w.id.clone()).collect::<Vec<_>>();
    for id in ids{open_report(app.clone(),id).await;}Ok(())
}
#[tauri::command] pub async fn desktop_widget_create(app:tauri::AppHandle,window:tauri::WebviewWindow,kind:WidgetKind,source:Option<String>)->Result<WidgetState,String>{
    authorize(&window,None)?;if !kind.available(){return Err("Dieser Widget-Typ ist noch nicht verfügbar.".into());}
    let state=app.state::<DesktopWidgets>();let _updating=state.begin()?;
    if let Some(source)=source.as_deref(){remember(&app,source)?;}
    let mut config=state.config.lock().map_err(|e|e.to_string())?.clone();
    let id=uuid::Uuid::new_v4().to_string();let mut widget=WidgetConfig::daily(id.clone());widget.kind=kind;
    // A new widget lies in front of the others.
    widget.layer=config.widgets.iter().map(|w|w.layer+1).max().unwrap_or(0);
    if let Some(source)=source.as_deref(){
        let original=config.get(&source)?;if original.kind!=kind{return Err("Der Widget-Typ passt nicht zur Vorlage.".into());}
        widget.name=if original.name.is_empty(){String::new()}else{format!("{} · {}",original.name.chars().take(65).collect::<String>(),crate::ui_language::text("Kopie","Copy"))};
        widget.placement=original.placement.clone().map(|mut p|{p.x+=28.0;p.y+=28.0;p});
    }
    *state.runtime(&id)?.copy_from.lock().map_err(|e|e.to_string())?=source;
    config.widgets.push(widget);state.save(config,None)?;open_report(app.clone(),id).await;state.broadcast(&app)
}
#[tauri::command] pub async fn desktop_widget_update(app:tauri::AppHandle,window:tauri::WebviewWindow,id:Option<String>,update:WidgetUpdate)->Result<WidgetState,String>{
    let id=id.or_else(||widget_id(window.label()).map(str::to_owned));authorize(&window,id.as_deref())?;
    let state=app.state::<DesktopWidgets>();let _updating=state.begin()?;
    if update.autostart.is_some()&&window.label()!="main"{return Err("Autostart wird im Journal eingestellt.".into());}
    let changes_instance=update.enabled.is_some()||update.locked.is_some()||update.name.is_some()||update.reset;
    if changes_instance&&id.is_none(){return Err("Für diese Änderung fehlt die Widget-ID.".into());}
    if let Some(id)=id.as_deref(){remember(&app,id)?;}
    let mut next=state.config.lock().map_err(|e|e.to_string())?.clone();let old_autostart=next.autostart;
    if let Some(id)=id.as_deref(){
        let widget=next.widgets.iter_mut().find(|w|w.id==id).ok_or("Dieses Widget existiert nicht mehr.")?;
        if let Some(enabled)=update.enabled{if enabled&&!widget.kind.available(){return Err("Dieser Widget-Typ ist noch nicht verfügbar.".into());}widget.enabled=enabled;}
        if let Some(locked)=update.locked{widget.locked=locked;}
        if let Some(name)=update.name{widget.name=config::normalized_name(&name)?;}
        if update.reset{widget.placement=None;widget.layouts.clear();}
    }
    if let Some(enabled)=update.autostart{autostart(enabled)?;next.autostart=enabled;}
    if let Err(error)=state.save(next.clone(),if update.reset{id.as_deref()}else{None}){if update.autostart.is_some(){let _=autostart(old_autostart);}return Err(error);}
    if let Some(id)=id{
        let config=next.get(&id)?;
        if let Some(window)=app.get_webview_window(&window_label(&id)){
            if !config.enabled{window.destroy().map_err(|e|e.to_string())?;}else{
                if update.reset{let _=window.emit("widget:popups-dismiss",());place(&window,true)?;}
                let title=if config.name.is_empty(){config.kind.title()}else{&config.name};let _=window.set_title(&format!("Journal · {title}"));
            }
        }
        if config.enabled{open_report(app.clone(),id).await;}
    }
    state.broadcast(&app)
}
/// The stacking chosen in the settings: `ids` from front to back, every widget once.
#[tauri::command] pub async fn desktop_widget_layers(app:tauri::AppHandle,window:tauri::WebviewWindow,ids:Vec<String>)->Result<WidgetState,String>{
    authorize(&window,None)?;let state=app.state::<DesktopWidgets>();let _updating=state.begin()?;
    let mut config=state.config.lock().map_err(|e|e.to_string())?.clone();
    let mut known:Vec<String>=config.widgets.iter().map(|w|w.id.clone()).collect();known.sort_unstable();
    let mut given=ids.clone();given.sort_unstable();given.dedup();
    if known!=given{return Err("Die Widgets haben sich inzwischen geändert. Bitte erneut versuchen.".into());}
    let count=ids.len() as u32;
    for widget in &mut config.widgets{if let Some(at)=ids.iter().position(|id|*id==widget.id){widget.layer=count-1-at as u32;}}
    state.save(config,None)?;restack(&app);state.broadcast(&app)
}
#[tauri::command] pub async fn desktop_widget_remove(app:tauri::AppHandle,window:tauri::WebviewWindow,id:String)->Result<WidgetState,String>{
    authorize(&window,None)?;let state=app.state::<DesktopWidgets>();let _updating=state.begin()?;
    let mut config=state.config.lock().map_err(|e|e.to_string())?.clone();config.get(&id)?;config.widgets.retain(|w|w.id!=id);state.save(config,None)?;
    if let Some(window)=app.get_webview_window(&window_label(&id)){window.destroy().map_err(|e|e.to_string())?;}
    state.runtimes.lock().map_err(|e|e.to_string())?.remove(&id);state.broadcast(&app)
}
#[tauri::command] pub async fn desktop_widget_open_settings(app:tauri::AppHandle,window:tauri::WebviewWindow,tab:Option<String>)->Result<(),String>{
    // Tags, activities and day values have settings pages of their own; everything else is the widget's own settings.
    let tab=match tab.as_deref(){Some(name@("tags"|"activities"|"scales"))=>name,_=>"widgets"};
    crate::show_main(&app);app.emit_to("main","journal:settings",serde_json::json!({"tab":tab,"widget":widget_id(window.label())})).map_err(|e|e.to_string())
}
pub fn window_event(window:&tauri::Window,event:&tauri::WindowEvent){
    let Some(id)=widget_id(window.label())else{return;};let state=window.state::<DesktopWidgets>();
    let runtime=state.runtimes.lock().ok().and_then(|r|r.get(id).cloned());let Some(runtime)=runtime else{return;};
    match event{
        tauri::WindowEvent::CloseRequested{api,..}=>{api.prevent_close();let _=window.emit("desktop-widget:close",());},
        tauri::WindowEvent::Moved(_)|tauri::WindowEvent::Resized(_)=>{runtime.changed.fetch_add(1,Ordering::Relaxed);},
        tauri::WindowEvent::Focused(false)=>surface::dismiss_if_external(window),
        // Focusing a widget keeps it in its layer (it used to come to the front of the others).
        tauri::WindowEvent::Focused(true)=>restack(window.app_handle()),
        tauri::WindowEvent::Destroyed=>{runtime.content_ready.store(false,Ordering::Relaxed);if let Ok(mut surface)=runtime.surface.lock(){*surface=None;}},_=>{},
    }
}
pub fn start(app:tauri::AppHandle){
    std::thread::spawn(move||{
        let mut pending=HashMap::<String,(u64,Instant)>::new();let mut geometry_key=String::new();
        loop{
            std::thread::sleep(Duration::from_millis(250));let state=app.state::<DesktopWidgets>();
            if !state.ready.load(Ordering::Relaxed)||state.updating.load(Ordering::Relaxed){continue;}
            let widgets=state.config.lock().map(|c|c.widgets.clone()).unwrap_or_default();let mut next_key=None;
            pending.retain(|id,_|widgets.iter().any(|w|w.id==*id));
            for widget in widgets.into_iter().filter(|w|w.enabled&&w.kind.available()){
                let Ok(runtime)=state.runtime(&widget.id)else{continue;};
                if let Some(window)=app.get_webview_window(&window_label(&widget.id)){
                    if !runtime.content_ready.load(Ordering::Relaxed){continue;}
                    #[cfg(windows)] if let Ok(hwnd)=window.hwnd(){let raw=hwnd.0 as isize;let _=window.run_on_main_thread(move||host::maintain(raw));}
                    let current=runtime.changed.load(Ordering::Relaxed);let entry=pending.entry(widget.id.clone()).or_insert((0,Instant::now()));
                    if entry.0!=current{*entry=(current,Instant::now());}else if current!=0&&entry.1.elapsed()>Duration::from_millis(750){let _=remember(&app,&widget.id);let _=runtime.changed.compare_exchange(current,0,Ordering::Relaxed,Ordering::Relaxed);entry.0=0;}
                    if let Ok((screens,_primary))=screens(&window){
                        let key=screens.iter().map(|s|format!("{}:{}:{}:{}:{}:{}",s.name,s.x,s.y,s.width,s.height,s.scale)).collect::<Vec<_>>().join(";");
                        if !geometry_key.is_empty()&&key!=geometry_key{let _=window.emit("widget:popups-dismiss",());let _=place(&window,false);}
                        next_key=Some(key);
                    }
                }else if !runtime.opening.load(Ordering::Relaxed)&&runtime.last_attempt.lock().map(|t|t.elapsed()>Duration::from_secs(2)).unwrap_or(false){
                    let app=app.clone();let id=widget.id;tauri::async_runtime::spawn(async move{open_report(app,id).await;});
                }
            }
            if let Some(key)=next_key{geometry_key=key;}
            restack(&app);
        }
    });
}

#[cfg(test)] mod tests{
    use super::*;
    #[test] fn menu_changes_preserve_a_placement_saved_after_the_snapshot(){
        let dir=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/widget-config-tests").join(uuid::Uuid::new_v4().to_string());
        let state=DesktopWidgets::new(dir.clone());
        let mut initial=Config::default();initial.widgets.push(WidgetConfig::daily("one".into()));state.save(initial,None).unwrap();
        let mut menu=state.config.lock().unwrap().clone();menu.widgets[0].name="Arbeit".into();
        let placement=Placement{monitor:"left".into(),screen:"-2560,0,2560,1440".into(),x:100.0,y:40.0,width:700.0,height:500.0};
        state.config.lock().unwrap().widgets[0].placement=Some(placement.clone());
        state.save(menu,None).unwrap();
        let restored=DesktopWidgets::new(dir);let widget=restored.instance("one").unwrap();
        assert_eq!(widget.name,"Arbeit");assert_eq!(widget.placement,Some(placement));
        let mut next=state.config.lock().unwrap().clone();next.widgets[0].placement=None;state.save(next,Some("one")).unwrap();assert!(state.instance("one").unwrap().placement.is_none());
    }
}
