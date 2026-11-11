use super::geometry::Placement;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const VERSION:u32=2;
pub const LEGACY_ID:&str="entries";
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all="kebab-case")]
pub enum WidgetKind { DailyNote, Calendar }
impl WidgetKind {
    pub fn available(self)->bool{true}
    pub fn default_size(self)->(f64,f64){match self{Self::DailyNote=>(600.0,600.0),Self::Calendar=>(980.0,720.0)}}
    pub fn minimum_size(self)->(f64,f64){match self{Self::DailyNote=>(360.0,260.0),Self::Calendar=>(480.0,360.0)}}
    pub fn title(self)->&'static str{match self{Self::DailyNote=>crate::ui_language::text("Tagesnotiz","Daily note"),Self::Calendar=>crate::ui_language::text("Kalender","Calendar")}}
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct WidgetConfig {
    pub id:String,
    pub kind:WidgetKind,
    #[serde(default)] pub name:String,
    #[serde(default)] pub enabled:bool,
    #[serde(default)] pub locked:bool,
    #[serde(default)] pub placement:Option<Placement>,
}
impl WidgetConfig {
    pub fn daily(id:String)->Self{Self{id,kind:WidgetKind::DailyNote,name:String::new(),enabled:true,locked:false,placement:None}}
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Config { pub version:u32, #[serde(default)] pub autostart:bool, pub widgets:Vec<WidgetConfig> }
impl Default for Config {fn default()->Self{Self{version:VERSION,autostart:false,widgets:vec![]}}}
pub fn valid_id(id:&str)->bool{!id.is_empty()&&id.len()<=64&&id.bytes().all(|c|c.is_ascii_lowercase()||c.is_ascii_digit()||c==b'-')}
pub fn window_label(id:&str)->String{format!("widget-{id}")}
pub fn widget_id(label:&str)->Option<&str>{label.strip_prefix("widget-").filter(|id|valid_id(id))}
pub fn normalized_name(name:&str)->Result<String,String>{
    let name=name.trim();
    if name.chars().count()>80||name.chars().any(char::is_control){return Err("Der Widget-Name darf höchstens 80 Zeichen und keine Steuerzeichen enthalten.".into());}
    Ok(name.into())
}
impl Config {
    pub fn decode(bytes:&[u8])->Result<(Self,bool),String>{
        let value:serde_json::Value=serde_json::from_slice(bytes).map_err(|e|e.to_string())?;
        let (config,legacy)=if value.get("widgets").is_some()||value.get("version").is_some(){
            (serde_json::from_value::<Self>(value).map_err(|e|e.to_string())?,false)
        }else{
            #[derive(Default,Deserialize)] #[serde(default)]
            struct Legacy {enabled:bool,locked:bool,autostart:bool,placement:Option<Placement>}
            if !value.is_object()||!["enabled","locked","autostart","placement"].iter().any(|key|value.get(key).is_some()){return Err("Unbekanntes Format der Widget-Einstellungen.".into());}
            let old:Legacy=serde_json::from_value(value).map_err(|e|e.to_string())?;
            (Self{version:VERSION,autostart:old.autostart,widgets:vec![WidgetConfig{id:LEGACY_ID.into(),kind:WidgetKind::DailyNote,name:String::new(),enabled:old.enabled,locked:old.locked,placement:old.placement}]},true)
        };
        config.validate()?;Ok((config,legacy))
    }
    pub fn validate(&self)->Result<(),String>{
        if self.version!=VERSION{return Err("Diese Version der Widget-Einstellungen wird noch nicht unterstützt.".into());}
        let mut ids=HashSet::new();
        for widget in &self.widgets{
            if !valid_id(&widget.id)||!ids.insert(&widget.id){return Err("Ungültige oder doppelte Widget-ID.".into());}
            normalized_name(&widget.name)?;
        }
        Ok(())
    }
    pub fn get(&self,id:&str)->Result<&WidgetConfig,String>{self.widgets.iter().find(|w|w.id==id).ok_or_else(||"Dieses Widget existiert nicht mehr.".into())}
}

#[cfg(test)] mod tests{
    use super::*;
    #[test] fn legacy_settings_keep_position_visibility_lock_and_autostart(){
        let (config,migrated)=Config::decode(br#"{"enabled":true,"locked":true,"autostart":true,"placement":{"monitor":"left","x":42,"y":75,"width":650,"height":420}}"#).unwrap();
        assert!(migrated&&config.autostart);assert_eq!(config.widgets.len(),1);
        let widget=&config.widgets[0];assert_eq!(widget.id,LEGACY_ID);assert!(widget.enabled&&widget.locked);
        assert_eq!(widget.placement.as_ref().unwrap().width,650.0);assert_eq!(widget.placement.as_ref().unwrap().monitor,"left");
    }
    #[test] fn registry_roundtrip_preserves_independent_instances(){
        let mut config=Config::default();config.widgets.push(WidgetConfig::daily("one".into()));
        let mut second=WidgetConfig::daily("two".into());second.name="Arbeit".into();second.locked=true;second.enabled=false;config.widgets.push(second);
        let (restored,migrated)=Config::decode(&serde_json::to_vec(&config).unwrap()).unwrap();assert!(!migrated);assert_eq!(restored,config);
        assert_ne!(restored.get("one").unwrap().enabled,restored.get("two").unwrap().enabled);
    }
    #[test] fn duplicate_invalid_and_future_configs_are_rejected(){
        let mut config=Config::default();config.widgets=vec![WidgetConfig::daily("one".into()),WidgetConfig::daily("one".into())];assert!(config.validate().is_err());
        config.widgets.pop();config.widgets[0].id="../other".into();assert!(config.validate().is_err());
        assert!(Config::decode(br#"{"version":3,"widgets":[]}"#).is_err());assert!(Config::decode(br#"{"unrelated":true}"#).is_err());
    }
    #[test] fn only_available_types_can_be_created_and_labels_are_scoped(){
        assert!(WidgetKind::DailyNote.available());assert!(WidgetKind::Calendar.available());
        assert_eq!(WidgetKind::Calendar.default_size(),(980.0,720.0));assert_eq!(WidgetKind::Calendar.minimum_size(),(480.0,360.0));
        assert_eq!(widget_id(&window_label("entries")),Some("entries"));assert_eq!(widget_id("main"),None);assert_eq!(widget_id("widget-../main"),None);
        assert_eq!(normalized_name("  Zuhause  ").unwrap(),"Zuhause");assert!(normalized_name("A\nB").is_err());
    }
}
