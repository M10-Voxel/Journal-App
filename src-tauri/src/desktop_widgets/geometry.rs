use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
/// A widget's place: logical, relative to its monitor's work area. `screen` identifies that monitor by its whole
/// rectangle (stable across reconnects, unlike Windows' display numbers); `monitor` is its name (older files only had it).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Placement { pub monitor: String, #[serde(default)] pub screen: String, pub x: f64, pub y: f64, pub width: f64, pub height: f64 }
/// A monitor: `x..height` its work area (physical), `id` its whole rectangle ("x,y,width,height").
#[derive(Clone)]
pub struct Screen { pub name: String, pub id: String, pub x: i32, pub y: i32, pub width: u32, pub height: u32, pub scale: f64 }
pub struct Bounds { pub x: i32, pub y: i32, pub width: f64, pub height: f64 }
fn finite(value: f64, fallback: f64) -> f64 { if value.is_finite() { value } else { fallback } }
/// Choose by overlap, then distance, including monitors with negative desktop coordinates.
pub fn screen_for(x:i32,y:i32,width:u32,height:u32,screens:&[Screen])->Option<&Screen>{
    screens.iter().max_by(|a,b|{
        let score=|s:&Screen|{
            let overlap=((x as i64+width as i64).min(s.x as i64+s.width as i64)-i64::from(x.max(s.x))).max(0)
                *((y as i64+height as i64).min(s.y as i64+s.height as i64)-i64::from(y.max(s.y))).max(0);
            let dx=x as f64+width as f64/2.0-(s.x as f64+s.width as f64/2.0);
            let dy=y as f64+height as f64/2.0-(s.y as f64+s.height as f64/2.0);
            (overlap, -(dx*dx+dy*dy))
        };
        let a=score(a);let b=score(b);a.0.cmp(&b.0).then_with(||a.1.total_cmp(&b.1))
    })
}
/// The arrangement of monitors (laptop alone, docked with two screens …): their rectangles, in no particular order.
pub fn layout_key(screens:&[Screen])->String{let mut ids:Vec<&str>=screens.iter().map(|s|s.id.as_str()).collect();ids.sort_unstable();ids.join(";")}
/// The monitor a placement belongs to: the same rectangle, else (older placements, changed resolution) the same name.
pub fn screen_of<'a>(placement:&Placement,screens:&'a [Screen])->Option<&'a Screen>{
    screens.iter().find(|s|!placement.screen.is_empty()&&s.id==placement.screen).or_else(||screens.iter().find(|s|s.name==placement.monitor))
}
/// Where a widget goes on these monitors: the place it had in this very arrangement, else its home place if that
/// monitor is there; otherwise (its monitor is gone, or it is new) on the primary monitor, a little apart from the
/// others (`index`) with its own size. The home place itself is never changed here, so a monitor that comes back gets
/// its widgets back.
pub fn resolve(home:Option<&Placement>,layouts:&BTreeMap<String,Placement>,screens:&[Screen],primary:usize,minimum:(f64,f64),size:(f64,f64),index:usize)->Option<Bounds>{
    if let Some(placement)=layouts.get(&layout_key(screens)).filter(|p|screen_of(p,screens).is_some()){return fit_on(placement,screen_of(placement,screens)?,minimum,true);}
    if let Some(placement)=home.filter(|p|screen_of(p,screens).is_some()){return fit_on(placement,screen_of(placement,screens)?,minimum,true);}
    let screen=screens.get(primary).or_else(||screens.first())?;
    let offset=40.0+(index%8) as f64*28.0;
    let size=home.map_or(size,|p|(p.width,p.height));
    fit_on(&Placement{monitor:screen.name.clone(),screen:screen.id.clone(),x:offset,y:offset,width:size.0,height:size.1},screen,minimum,true)
}
/// Whether a widget's home monitor is missing in this arrangement (then its home place must stay as it is).
pub fn displaced(home:Option<&Placement>,screens:&[Screen])->bool{home.is_some_and(|p|screen_of(p,screens).is_none())}
/// A placement on one monitor: size within the monitor (at least the minimum, if it fits), position kept inside it.
fn fit_on(placement:&Placement,screen:&Screen,minimum:(f64,f64),keep_position:bool)->Option<Bounds>{
    let scale = if screen.scale.is_finite() && screen.scale > 0.0 { screen.scale } else { 1.0 };
    let max_w = (screen.width as f64 / scale).max(1.0);
    let max_h = (screen.height as f64 / scale).max(1.0);
    let width = finite(placement.width, 600.0).clamp(minimum.0.min(max_w), max_w);
    let height = finite(placement.height, 600.0).clamp(minimum.1.min(max_h), max_h);
    let x = if keep_position { finite(placement.x, 40.0) } else { 40.0 }.clamp(0.0, max_w - width);
    let y = if keep_position { finite(placement.y, 40.0) } else { 40.0 }.clamp(0.0, max_h - height);
    Some(Bounds { x: screen.x + (x * scale).round() as i32, y: screen.y + (y * scale).round() as i32, width, height })
}
/// Placement is logical and relative to its monitor's work area, so mixed DPI and negative monitor origins are safe.
#[cfg(test)]
pub fn fit(saved: Option<&Placement>, screens: &[Screen], primary: usize) -> Option<Bounds> {
    fit_with_minimum(saved,screens,primary,(360.0,260.0))
}
#[cfg(test)]
pub fn fit_with_minimum(saved:Option<&Placement>,screens:&[Screen],primary:usize,minimum:(f64,f64))->Option<Bounds>{
    let found = saved.and_then(|saved| screen_of(saved, screens));
    let screen = found.or_else(|| screens.get(primary)).or_else(|| screens.first())?;
    let fallback = Placement { monitor: screen.name.clone(), screen: screen.id.clone(), x: 40.0, y: 40.0, width: 600.0, height: 600.0 };
    fit_on(saved.unwrap_or(&fallback), screen, minimum, found.is_some())
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn identifies_the_widget_monitor_independently_of_its_desktop_canvas(){
        let displays=screens();
        assert_eq!(screen_for(-2300,80,600,500,&displays).unwrap().name,"left");
        assert_eq!(screen_for(-100,80,600,500,&displays).unwrap().name,"primary");
        assert_eq!(screen_for(-5000,80,600,500,&displays).unwrap().name,"left");
        assert!(screen_for(0,0,600,500,&[]).is_none());
    }
    fn screens() -> Vec<Screen> { vec![Screen {name:"primary".into(),id:"0,0,1920,1080".into(),x:0,y:0,width:1920,height:1040,scale:1.0},Screen{name:"left".into(),id:"-2560,0,2560,1440".into(),x:-2560,y:0,width:2560,height:1400,scale:2.0}] }
    fn place(monitor:&str,screen:&str,x:f64,y:f64)->Placement{Placement{monitor:monitor.into(),screen:screen.into(),x,y,width:400.0,height:300.0}}
    #[test] fn a_widget_comes_back_to_its_monitor_after_undocking_and_docking(){
        let docked=screens();let laptop=vec![docked[0].clone()];
        let home=place("left","-2560,0,2560,1440",100.0,80.0);let mut layouts=BTreeMap::new();
        // Undocked: the monitor is gone, the widget goes to the laptop's screen; its home place stays.
        assert!(displaced(Some(&home),&laptop));
        let b=resolve(Some(&home),&layouts,&laptop,0,(300.0,200.0),(600.0,600.0),1).unwrap();assert_eq!((b.x,b.y,b.width,b.height),(68,68,400.0,300.0));
        // Moved by hand on the laptop alone: that arrangement remembers it.
        layouts.insert(layout_key(&laptop),place("primary","0,0,1920,1080",500.0,300.0));
        let b=resolve(Some(&home),&layouts,&laptop,0,(300.0,200.0),(600.0,600.0),1).unwrap();assert_eq!((b.x,b.y),(500,300));
        // Docked again: back on its monitor, where it was.
        assert!(!displaced(Some(&home),&docked));
        let b=resolve(Some(&home),&layouts,&docked,0,(300.0,200.0),(600.0,600.0),1).unwrap();assert_eq!((b.x,b.y),(-2560+200,160));
    }
    #[test] fn monitors_are_found_by_rectangle_even_when_windows_renumbers_them(){
        // The same monitor as \\.\DISPLAY3 instead of \\.\DISPLAY2: found by its rectangle.
        let mut docked=screens();docked[1].name="renamed".into();
        let home=place("left","-2560,0,2560,1440",100.0,80.0);
        let b=resolve(Some(&home),&BTreeMap::new(),&docked,0,(300.0,200.0),(600.0,600.0),0).unwrap();assert_eq!((b.x,b.y),(-2560+200,160));
        // An older placement without the rectangle is still found by name.
        let old=place("left","",100.0,80.0);assert_eq!(screen_of(&old,&screens()).unwrap().name,"left");
    }
    #[test] fn calendar_minimum_is_respected_and_still_fits_a_small_monitor(){
        let saved=Placement{monitor:"primary".into(),screen:String::new(),x:40.0,y:40.0,width:200.0,height:100.0};
        let b=fit_with_minimum(Some(&saved),&screens(),0,(480.0,360.0)).unwrap();assert_eq!((b.width,b.height),(480.0,360.0));
        let tiny=vec![Screen{name:"primary".into(),id:"0,0,320,240".into(),x:0,y:0,width:320,height:240,scale:1.0}];
        let b=fit_with_minimum(Some(&saved),&tiny,0,(480.0,360.0)).unwrap();assert_eq!((b.x,b.y,b.width,b.height),(0,0,320.0,240.0));
    }
    #[test] fn restores_logical_size_on_negative_mixed_dpi_monitor() {
        let saved=Placement{monitor:"left".into(),screen:String::new(),x:50.0,y:40.0,width:600.0,height:500.0};
        let b=fit(Some(&saved),&screens(),0).unwrap(); assert_eq!((b.x,b.y,b.width,b.height),(-2460,80,600.0,500.0));
    }
    #[test] fn missing_monitor_falls_back_and_clamps_oversized_widget() {
        let saved=Placement{monitor:"removed".into(),screen:String::new(),x:-10000.0,y:20000.0,width:5000.0,height:5000.0};
        let b=fit(Some(&saved),&screens(),0).unwrap(); assert_eq!((b.x,b.y,b.width,b.height),(0,0,1920.0,1040.0));
    }
    #[test] fn clamps_after_resolution_change_and_sanitizes_non_finite_values() {
        let saved=Placement{monitor:"primary".into(),screen:String::new(),x:f64::NAN,y:4000.0,width:f64::INFINITY,height:100.0};
        let b=fit(Some(&saved),&screens(),0).unwrap(); assert_eq!((b.x,b.y,b.width,b.height),(40,780,600.0,260.0));
        assert!(fit(None,&[],0).is_none());
    }
}
