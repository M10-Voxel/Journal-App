use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Placement { pub monitor: String, pub x: f64, pub y: f64, pub width: f64, pub height: f64 }
#[derive(Clone)]
pub struct Screen { pub name: String, pub x: i32, pub y: i32, pub width: u32, pub height: u32, pub scale: f64 }
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
/// Placement is logical and relative to its monitor's work area, so mixed DPI and negative monitor origins are safe.
#[cfg(test)]
pub fn fit(saved: Option<&Placement>, screens: &[Screen], primary: usize) -> Option<Bounds> {
    fit_with_minimum(saved,screens,primary,(360.0,260.0))
}
pub fn fit_with_minimum(saved:Option<&Placement>,screens:&[Screen],primary:usize,minimum:(f64,f64))->Option<Bounds>{
    let screen = saved.and_then(|saved| screens.iter().find(|screen| screen.name == saved.monitor)).or_else(|| screens.get(primary)).or_else(|| screens.first())?;
    let scale = if screen.scale.is_finite() && screen.scale > 0.0 { screen.scale } else { 1.0 };
    let max_w = (screen.width as f64 / scale).max(1.0);
    let max_h = (screen.height as f64 / scale).max(1.0);
    let matched = saved.filter(|saved| saved.monitor == screen.name);
    let width = finite(saved.map_or(600.0, |s| s.width), 600.0).clamp(minimum.0.min(max_w), max_w);
    let height = finite(saved.map_or(600.0, |s| s.height), 600.0).clamp(minimum.1.min(max_h), max_h);
    let x = finite(matched.map_or(40.0, |s| s.x), 40.0).clamp(0.0, max_w - width);
    let y = finite(matched.map_or(40.0, |s| s.y), 40.0).clamp(0.0, max_h - height);
    Some(Bounds { x: screen.x + (x * scale).round() as i32, y: screen.y + (y * scale).round() as i32, width, height })
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
    fn screens() -> Vec<Screen> { vec![Screen {name:"primary".into(),x:0,y:0,width:1920,height:1040,scale:1.0},Screen{name:"left".into(),x:-2560,y:0,width:2560,height:1400,scale:2.0}] }
    #[test] fn calendar_minimum_is_respected_and_still_fits_a_small_monitor(){
        let saved=Placement{monitor:"primary".into(),x:40.0,y:40.0,width:200.0,height:100.0};
        let b=fit_with_minimum(Some(&saved),&screens(),0,(480.0,360.0)).unwrap();assert_eq!((b.width,b.height),(480.0,360.0));
        let tiny=vec![Screen{name:"primary".into(),x:0,y:0,width:320,height:240,scale:1.0}];
        let b=fit_with_minimum(Some(&saved),&tiny,0,(480.0,360.0)).unwrap();assert_eq!((b.x,b.y,b.width,b.height),(0,0,320.0,240.0));
    }
    #[test] fn restores_logical_size_on_negative_mixed_dpi_monitor() {
        let saved=Placement{monitor:"left".into(),x:50.0,y:40.0,width:600.0,height:500.0};
        let b=fit(Some(&saved),&screens(),0).unwrap(); assert_eq!((b.x,b.y,b.width,b.height),(-2460,80,600.0,500.0));
    }
    #[test] fn missing_monitor_falls_back_and_clamps_oversized_widget() {
        let saved=Placement{monitor:"removed".into(),x:-10000.0,y:20000.0,width:5000.0,height:5000.0};
        let b=fit(Some(&saved),&screens(),0).unwrap(); assert_eq!((b.x,b.y,b.width,b.height),(0,0,1920.0,1040.0));
    }
    #[test] fn clamps_after_resolution_change_and_sanitizes_non_finite_values() {
        let saved=Placement{monitor:"primary".into(),x:f64::NAN,y:4000.0,width:f64::INFINITY,height:100.0};
        let b=fit(Some(&saved),&screens(),0).unwrap(); assert_eq!((b.x,b.y,b.width,b.height),(40,780,600.0,260.0));
        assert!(fit(None,&[],0).is_none());
    }
}
