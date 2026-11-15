//! Live blur belongs to a widget-sized window, never the virtual-desktop canvas.
//! The auxiliary window has no input and stays immediately below its widget.
#[cfg(windows)]
mod windows {
    use std::{collections::HashMap,ffi::c_void,sync::{Mutex,OnceLock}};
    type Hwnd=isize;
    type Proc=unsafe extern "system" fn(Hwnd,u32,usize,isize)->isize;
    #[repr(C)] struct Class {style:u32,proc:Proc,class_extra:i32,window_extra:i32,instance:isize,icon:isize,cursor:isize,background:isize,menu:*const u16,name:*const u16}
    #[repr(C)] struct Margins{left:i32,right:i32,top:i32,bottom:i32}
    #[repr(C)] struct Rect{left:i32,top:i32,right:i32,bottom:i32}
    #[repr(C)] struct Paint{dc:isize,erase:i32,rect:Rect,restore:i32,update:i32,reserved:[u8;32]}
    #[derive(Clone,Copy)] struct Layer{hwnd:Hwnd,rect:(i32,i32,i32,i32),radius:i32,backend:&'static str}
    static LAYERS:OnceLock<Mutex<HashMap<Hwnd,Layer>>>=OnceLock::new();
    fn layers()->&'static Mutex<HashMap<Hwnd,Layer>>{LAYERS.get_or_init(||Mutex::new(HashMap::new()))}
    #[link(name="user32")] unsafe extern "system" {
        fn RegisterClassW(class:*const Class)->u16;
        fn CreateWindowExW(ex:u32,class:*const u16,title:*const u16,style:u32,x:i32,y:i32,w:i32,h:i32,parent:isize,menu:isize,instance:isize,param:*const c_void)->Hwnd;
        fn DefWindowProcW(hwnd:Hwnd,msg:u32,w:usize,l:isize)->isize;
        fn DestroyWindow(hwnd:Hwnd)->i32;
        fn GetShellWindow()->Hwnd;
        fn IsWindowVisible(hwnd:Hwnd)->i32;
        fn ShowWindow(hwnd:Hwnd,command:i32)->i32;
        fn SetWindowPos(hwnd:Hwnd,after:Hwnd,x:i32,y:i32,w:i32,h:i32,flags:u32)->i32;
        fn SetWindowRgn(hwnd:Hwnd,region:isize,redraw:i32)->i32;
        fn GetWindow(hwnd:Hwnd,command:u32)->Hwnd;
        fn BeginPaint(hwnd:Hwnd,paint:*mut Paint)->isize;
        fn EndPaint(hwnd:Hwnd,paint:*const Paint)->i32;
        fn FillRect(dc:isize,rect:*const Rect,brush:isize)->i32;
        fn SetWindowLongPtrW(hwnd:Hwnd,index:i32,value:isize)->isize;
        #[cfg(debug_assertions)] fn GetWindowLongPtrW(hwnd:Hwnd,index:i32)->isize;
        #[cfg(debug_assertions)] fn GetWindowRect(hwnd:Hwnd,rect:*mut Rect)->i32;
    }
    #[link(name="kernel32")] unsafe extern "system"{fn GetModuleHandleW(name:*const u16)->isize;}
    #[link(name="gdi32")] unsafe extern "system"{fn CreateRoundRectRgn(a:i32,b:i32,c:i32,d:i32,w:i32,h:i32)->isize;fn DeleteObject(region:isize)->i32;fn GetStockObject(index:i32)->isize;}
    #[link(name="dwmapi")] unsafe extern "system"{fn DwmExtendFrameIntoClientArea(hwnd:Hwnd,margins:*const Margins)->i32;}
    unsafe extern "system" fn proc(hwnd:Hwnd,msg:u32,w:usize,l:isize)->isize{unsafe{match msg{
        0x0084=>-1, // HTTRANSPARENT: never intercept desktop input.
        0x0021=>3, // MA_NOACTIVATE.
        // DwmExtendFrameIntoClientArea needs zero-alpha pixels. Painting the
        // stock black brush clears RGB and alpha for glass (not an opaque tint).
        // A null background and no WM_PAINT leave this surface uninitialised.
        0x000f=>{let mut paint:Paint=std::mem::zeroed();let dc=BeginPaint(hwnd,&mut paint);if dc!=0{FillRect(dc,&paint.rect,GetStockObject(4));SetWindowLongPtrW(hwnd,-21,1);}EndPaint(hwnd,&paint);0},
        _=>DefWindowProcW(hwnd,msg,w,l),
    }}}
    fn class()->Result<Vec<u16>,String>{
        let name:Vec<u16>="JournalWidgetLiveBlur".encode_utf16().chain(Some(0)).collect();
        static ATOM:OnceLock<u16>=OnceLock::new();
        let atom=*ATOM.get_or_init(||unsafe{RegisterClassW(&Class{style:3,proc,class_extra:0,window_extra:0,instance:GetModuleHandleW(std::ptr::null()),icon:0,cursor:0,background:GetStockObject(4),menu:std::ptr::null(),name:name.as_ptr()})});
        if atom==0{return Err("Live-Blur-Fenster konnte nicht registriert werden.".into());}Ok(name)
    }
    pub fn enable(owner:Hwnd)->Result<(),String>{unsafe{
        if layers().lock().map_err(|e|e.to_string())?.contains_key(&owner){return Ok(());}
        let name=class()?;
        let hwnd=CreateWindowExW(0x08000000|0x80|0x20,name.as_ptr(),std::ptr::null(),0x80000000,0,0,1,1,GetShellWindow(),0,GetModuleHandleW(std::ptr::null()),std::ptr::null());
        if hwnd==0{return Err("Live-Blur-Fläche konnte nicht angelegt werden.".into());}
        let margins=Margins{left:-1,right:-1,top:-1,bottom:-1};
        if DwmExtendFrameIntoClientArea(hwnd,&margins)<0{DestroyWindow(hwnd);return Err("Windows-Komposition ist nicht verfügbar.".into());}
        let backend=match super::super::host::composition_blur(hwnd,true){Ok(backend)=>backend,Err(error)=>{DestroyWindow(hwnd);return Err(error);}};
        layers().lock().map_err(|e|e.to_string())?.insert(owner,Layer{hwnd,rect:(0,0,1,1),radius:0,backend});
        Ok(())
    }}
    pub fn disable(owner:Hwnd){
        let layer=layers().lock().ok().and_then(|mut layers|layers.remove(&owner));
        if let Some(layer)=layer{unsafe{DestroyWindow(layer.hwnd);}}
    }
    pub fn hide(owner:Hwnd){
        let layer=layers().lock().ok().and_then(|layers|layers.get(&owner).copied());
        if let Some(layer)=layer{unsafe{ShowWindow(layer.hwnd,0);}}
    }
    pub fn update(owner:Hwnd,rect:(i32,i32,i32,i32),radius:i32)->Result<(),String>{unsafe{
        // SetWindowPos/SetWindowRgn can send messages to the GUI thread. Never
        // hold the registry lock while waiting for that thread (surface updates
        // also arrive from async commands).
        let Some(layer)=layers().lock().map_err(|e|e.to_string())?.get(&owner).copied()else{return Ok(());};
        if layer.rect!=rect||layer.radius!=radius{
            let(_,_,w,h)=rect;let r=radius.max(0)*2;
            let region=CreateRoundRectRgn(0,0,w+1,h+1,r,r);
            if region==0{return Err("Live-Blur-Region konnte nicht angelegt werden.".into());}
            if SetWindowRgn(layer.hwnd,region,0)==0{DeleteObject(region);return Err("Live-Blur-Region konnte nicht gesetzt werden.".into());}
        }
        let(x,y,w,h)=rect;
        if SetWindowPos(layer.hwnd,owner,x,y,w,h,0x0010|0x0040)==0{return Err("Live Blur konnte nicht positioniert werden.".into());}
        if let Some(current)=layers().lock().map_err(|e|e.to_string())?.get_mut(&owner){
            if current.hwnd==layer.hwnd{current.rect=rect;current.radius=radius;}
        }
        Ok(())
    }}
    pub fn maintain(owner:Hwnd){
        let layer=layers().lock().ok().and_then(|layers|layers.get(&owner).copied());
        if let Some(layer)=layer{unsafe{
            if IsWindowVisible(owner)==0{ShowWindow(layer.hwnd,0);}else if IsWindowVisible(layer.hwnd)==0||GetWindow(owner,2)!=layer.hwnd{
                // No move/size/activate: retain the widget-sized bounds.
                SetWindowPos(layer.hwnd,owner,0,0,0,0,0x0001|0x0002|0x0010|0x0040);
            }
        }}
    }
    #[cfg(debug_assertions)] pub fn snapshot(owner:Hwnd)->Option<serde_json::Value>{
        let layer=layers().lock().ok()?.get(&owner).copied()?;
        unsafe{let mut r=Rect{left:0,top:0,right:0,bottom:0};GetWindowRect(layer.hwnd,&mut r);
            Some(serde_json::json!({"rect":[r.left,r.top,r.right-r.left,r.bottom-r.top],"visible":IsWindowVisible(layer.hwnd)!=0,"belowWidget":GetWindow(owner,2)==layer.hwnd,"backend":layer.backend,"painted":GetWindowLongPtrW(layer.hwnd,-21)!=0}))
        }
    }
}
#[cfg(windows)] pub use windows::*;
