//! Windows desktop placement. These windows retain normal keyboard input but are owned by
//! the shell, excluded from the task switcher, and never raise over applications on activation.
#[cfg(windows)]
mod windows {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
    type Hwnd = isize;
    #[repr(C)]
    struct WindowPos { hwnd: Hwnd, after: Hwnd, x: i32, y: i32, cx: i32, cy: i32, flags: u32 }
    #[repr(C)] struct Style { old:u32, new:u32 }
    #[link(name="user32")]
    unsafe extern "system" {
        fn GetShellWindow() -> Hwnd;
        fn IsWindow(hwnd: Hwnd) -> i32;
        fn GetWindowLongPtrW(hwnd: Hwnd, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: Hwnd, index: i32, value: isize) -> isize;
        fn SetWindowPos(hwnd: Hwnd, after: Hwnd, x:i32,y:i32,cx:i32,cy:i32,flags:u32) -> i32;
        fn ShowWindow(hwnd: Hwnd, command: i32) -> i32;
        fn IsWindowVisible(hwnd: Hwnd) -> i32;
        fn IsIconic(hwnd: Hwnd) -> i32;
        fn GetWindow(hwnd:Hwnd,command:u32)->Hwnd;
        fn FindWindowExW(parent:Hwnd,after:Hwnd,class:*const u16,title:*const u16)->Hwnd;
        fn EnumWindows(callback:unsafe extern "system" fn(Hwnd,isize)->i32,data:isize)->i32;
        fn GetWindowThreadProcessId(hwnd:Hwnd,pid:*mut u32)->u32;
        fn SetWindowRgn(hwnd:Hwnd,region:isize,redraw:i32)->i32;
    }
    #[link(name="gdi32")] unsafe extern "system"{
        fn CreateRectRgn(left:i32,top:i32,right:i32,bottom:i32)->isize;
        fn CombineRgn(dest:isize,a:isize,b:isize,mode:i32)->i32;
        fn DeleteObject(object:isize)->i32;
        fn CreateRoundRectRgn(left:i32,top:i32,right:i32,bottom:i32,width:i32,height:i32)->isize;
    }
    /// A region keeps the transparent canvas outside the widget and popup rectangles click-through.
    pub fn region(hwnd:isize,rects:Option<&[(i32,i32,i32,i32)]>,radius:i32)->Result<(),String>{unsafe{
        let Some(rects)=rects else {return if SetWindowRgn(hwnd,0,1)==0{Err(std::io::Error::last_os_error().to_string())}else{Ok(())};};
        let combined=CreateRectRgn(0,0,0,0);if combined==0{return Err(std::io::Error::last_os_error().to_string());}
        for (index,&(x,y,w,h)) in rects.iter().enumerate(){
            let part=if index==0 && radius>0{CreateRoundRectRgn(x,y,x.saturating_add(w)+1,y.saturating_add(h)+1,radius*2,radius*2)}else{CreateRectRgn(x,y,x.saturating_add(w),y.saturating_add(h))};
            if part==0{DeleteObject(combined);return Err(std::io::Error::last_os_error().to_string());}
            let result=CombineRgn(combined,combined,part,2);DeleteObject(part);
            if result==0{DeleteObject(combined);return Err(std::io::Error::last_os_error().to_string());}
        }
        if SetWindowRgn(hwnd,combined,1)==0{DeleteObject(combined);return Err(std::io::Error::last_os_error().to_string());}
        // Windows owns the region after a successful SetWindowRgn.
        Ok(())
    }}
    /// Windows' composition blur samples the live desktop behind this window,
    /// including video wallpapers. Its strength is controlled by Windows.
    pub fn composition_blur(hwnd:isize,enabled:bool)->Result<&'static str,String>{unsafe{
        // Desktop Acrylic falls back to a solid tint when this NOACTIVATE
        // surface is inactive. Use the compositor's blur-behind policy on
        // Windows 10 and 11 alike; it samples content without an acrylic tint.
        #[repr(C)] struct Accent {state:i32,flags:u32,color:u32,animation:u32}
        #[repr(C)] struct Data {attribute:i32,data:*const c_void,size:usize}
        #[link(name="kernel32")] unsafe extern "system" {
            fn GetModuleHandleW(name:*const u16)->isize;
            fn GetProcAddress(module:isize,name:*const u8)->*const c_void;
        }
        let name:Vec<u16>="user32.dll".encode_utf16().chain(Some(0)).collect();
        let module=GetModuleHandleW(name.as_ptr());
        let address=if module!=0{GetProcAddress(module,b"SetWindowCompositionAttribute\0".as_ptr())}else{std::ptr::null()};
        if address.is_null(){return if enabled{Err("Windows unterstützt Live Blur nicht.".into())}else{Ok("disabled")};}
        let set:unsafe extern "system" fn(isize,*const Data)->i32=std::mem::transmute(address);
        // ACCENT_ENABLE_BLURBEHIND; no tint or focus-dependent acrylic fallback.
        let accent=Accent{state:if enabled{3}else{0},flags:0,color:0,animation:0};
        let data=Data{attribute:19,data:&accent as *const _ as *const c_void,size:std::mem::size_of::<Accent>()};
        if set(hwnd,&data)==0{return Err("Windows konnte Live Blur nicht aktivieren.".into());}
        Ok("accent-blur")
    }}
    type Subclass = unsafe extern "system" fn(Hwnd,u32,usize,isize,usize,usize)->isize;
    #[link(name="comctl32")]
    unsafe extern "system" {
        fn SetWindowSubclass(hwnd:Hwnd, callback:Subclass,id:usize,data:usize)->i32;
        fn RemoveWindowSubclass(hwnd:Hwnd,callback:Subclass,id:usize)->i32;
        fn DefSubclassProc(hwnd:Hwnd,msg:u32,wparam:usize,lparam:isize)->isize;
    }
    #[link(name="dwmapi")]
    unsafe extern "system" { fn DwmSetWindowAttribute(hwnd:Hwnd,attribute:u32,value:*const c_void,size:u32)->i32; }
    static WALLPAPER_GENERATION: AtomicU64 = AtomicU64::new(0);
    pub fn wallpaper_generation()->u64{WALLPAPER_GENERATION.load(Ordering::Relaxed)}
    static PLACING: AtomicBool = AtomicBool::new(false);
    /// The canvas is a plain popup without any frame: no caption or sizing border (WS_CAPTION, WS_THICKFRAME). Otherwise
    /// Windows can paint its white caption strip where a widget lies at the top of the screen.
    fn frameless(style:u32)->u32{(style|0x8000_0000)&!(0x00C0_0000|0x0004_0000)}
    const SUBCLASS_ID: usize = 0x4a4457;
    unsafe extern "system" fn subclass(hwnd:Hwnd,msg:u32,wparam:usize,lparam:isize,_id:usize,_data:usize)->isize {
        // Windows broadcasts settings changes even when widgets have no focus.
        // A theme/slideshow can overwrite its cached image without changing
        // the source path or its timestamp. Invalidate that image explicitly.
        if msg==0x001a || msg==0x031a {
            WALLPAPER_GENERATION.fetch_add(1,Ordering::Relaxed);
        }
        if msg==0x007c && wparam as isize == -20 && lparam!=0 {
            let style=&mut *(lparam as *mut Style);
            style.new=(style.new|0x80)&!0x40000&!0x08000000;
        }
        if msg==0x007c && wparam as isize == -16 && lparam!=0 {
            let style=&mut *(lparam as *mut Style);
            style.new=frameless(style.new);
        }
        // WM_NCCALCSIZE: the whole window is client area, so there is no non-client strip to paint.
        if msg==0x0083 && wparam!=0 { return 0; }
        if msg == 0x0046 && lparam != 0 && !PLACING.load(Ordering::Relaxed) {
            // WM_WINDOWPOSCHANGING: focusing an editor must not lift its desktop surface.
            (*(lparam as *mut WindowPos)).flags |= 0x0004;
        }
        if msg == 0x0082 { super::super::capture::disable(hwnd);super::super::live_blur::disable(hwnd);RemoveWindowSubclass(hwnd,subclass,SUBCLASS_ID); }
        if msg == 0x0018 && wparam==0 {super::super::live_blur::hide(hwnd);}
        DefSubclassProc(hwnd,msg,wparam,lparam)
    }
    pub fn configure(hwnd:isize)->Result<(),String> { unsafe {
        let shell=GetShellWindow();
        if shell==0 { return Err("Der Windows-Desktop ist noch nicht bereit.".into()); }
        if desktop_host()==0 {return Err("Die Windows-Desktopfläche ist noch nicht bereit.".into());}
        if IsWindow(hwnd)==0 {return Err("Das Widget-Fenster ist nicht verfügbar.".into());}
        // GWLP_HWNDPARENT changes the owner of a top-level window, not its parent.
        // Unlike cross-process child reparenting, this preserves WebView2's DPI and IME.
        SetWindowLongPtrW(hwnd,-8,shell);
        let style=GetWindowLongPtrW(hwnd,-20);
        SetWindowLongPtrW(hwnd,-20,(style | 0x80) & !0x40000 & !0x08000000);
        let yes=1i32;
        for attribute in [11,12] { let _=DwmSetWindowAttribute(hwnd,attribute,&yes as *const _ as *const c_void,4); }
        // DWMWA_NCRENDERING_POLICY = DWMNCRP_DISABLED: DWM draws no frame or caption for the canvas either.
        let disabled=1i32;
        let _=DwmSetWindowAttribute(hwnd,2,&disabled as *const _ as *const c_void,4);
        if SetWindowSubclass(hwnd,subclass,SUBCLASS_ID,0)==0 {return Err("Der Desktop-Modus konnte nicht eingerichtet werden.".into());}
        let frame=GetWindowLongPtrW(hwnd,-16) as u32;
        SetWindowLongPtrW(hwnd,-16,frameless(frame) as i32 as isize);
        // SWP_FRAMECHANGED (with NOMOVE, NOSIZE, NOZORDER, NOACTIVATE) recomputes the now frameless client area.
        SetWindowPos(hwnd,0,0,0,0,0,0x0001|0x0002|0x0004|0x0010|0x0020);
        place(hwnd,true);
        Ok(())
    }}
    /// "SHELLDLL_DefView", the class of the window holding the desktop icons (UTF-16, zero-terminated).
    const ICON_VIEW:[u16;17]=[83,72,69,76,76,68,76,76,95,68,101,102,86,105,101,119,0];
    /// Whether a top-level window of the shell's process holds the desktop icons.
    unsafe fn holds_icons(window:Hwnd,shell_pid:u32)->bool {
        let mut pid=0;GetWindowThreadProcessId(window,&mut pid);
        pid==shell_pid&&FindWindowExW(window,0,ICON_VIEW.as_ptr(),std::ptr::null())!=0
    }
    unsafe extern "system" fn find_icons(window:Hwnd,data:isize)->i32 {
        let found=&mut *(data as *mut (Hwnd,u32));
        if holds_icons(window,found.1) {found.0=window;return 0;}
        1
    }
    /// The icon host found last. The widgets are kept above it several times a second; checking that it still holds the
    /// icons is a few calls, enumerating every top-level window again only happens when Explorer replaced it.
    static ICON_HOST: AtomicIsize = AtomicIsize::new(0);
    fn desktop_host()->Hwnd {unsafe{
        let mut shell_pid=0;GetWindowThreadProcessId(GetShellWindow(),&mut shell_pid);
        let known=ICON_HOST.load(Ordering::Relaxed);
        if known!=0&&IsWindow(known)!=0&&holds_icons(known,shell_pid) {return known;}
        let mut found:(Hwnd,u32)=(0,shell_pid);EnumWindows(find_icons,&mut found as *mut _ as isize);
        ICON_HOST.store(found.0,Ordering::Relaxed);found.0
    }}
    fn place(hwnd:Hwnd,raise:bool) { unsafe {
        let desktop=desktop_host();if desktop==0{return;}
        // Insert directly above the icon host, below the window preceding it. Win+D can promote
        // the shell into another z-order band; HWND_BOTTOM alone then falls behind the desktop.
        let mut after=GetWindow(desktop,3); // GW_HWNDPREV
        let shell=GetShellWindow();
        while after!=0 {
            if after==hwnd&&!raise{return;}
            let mut pid=0;GetWindowThreadProcessId(after,&mut pid);
            if pid!=std::process::id()||GetWindowLongPtrW(after,-8)!=shell{break;}
            after=GetWindow(after,3);
        }
        PLACING.store(true,Ordering::Relaxed);
        SetWindowPos(hwnd,after,0,0,0,0,0x0001|0x0002|0x0010|0x0200);
        PLACING.store(false,Ordering::Relaxed);
    }}
    /// Puts the widgets into the given order (back to front) above the desktop icons. Only acts when the order on
    /// screen differs, so it can be called often.
    pub fn restack(order:&[isize]) { unsafe {
        let desktop=desktop_host();if desktop==0{return;}
        let shell=GetShellWindow();
        // The widgets lie directly above the icon host, the lowest first.
        let mut band=Vec::new();let mut current=GetWindow(desktop,3);
        while current!=0 {
            let mut pid=0;GetWindowThreadProcessId(current,&mut pid);
            if pid!=std::process::id()||GetWindowLongPtrW(current,-8)!=shell{break;}
            band.push(current);current=GetWindow(current,3);
        }
        let present:Vec<isize>=band.iter().copied().filter(|hwnd|order.contains(hwnd)).collect();
        let wanted:Vec<isize>=order.iter().copied().filter(|hwnd|present.contains(hwnd)).collect();
        if present!=wanted {
            for &hwnd in order { if IsWindow(hwnd)!=0 { place(hwnd,true); } }
        }
        for &hwnd in order {super::super::live_blur::maintain(hwnd);}
    }}
    /// Called on the GUI thread; no input hooks, injection, or foreground activation.
    pub fn maintain(hwnd:isize) { unsafe {
        if IsWindow(hwnd)==0 {return;}
        let shell=GetShellWindow(); if shell==0 || desktop_host()==0 {ShowWindow(hwnd,0);return;}
        if GetWindowLongPtrW(hwnd,-8)!=shell { SetWindowLongPtrW(hwnd,-8,shell); }
        let style=GetWindowLongPtrW(hwnd,-20);let desktop_style=(style|0x80)&!0x40000&!0x08000000;
        if style!=desktop_style{SetWindowLongPtrW(hwnd,-20,desktop_style);}
        let frame=GetWindowLongPtrW(hwnd,-16) as u32;
        if frame!=frameless(frame){SetWindowLongPtrW(hwnd,-16,frameless(frame) as i32 as isize);SetWindowPos(hwnd,0,0,0,0,0,0x0001|0x0002|0x0004|0x0010|0x0020);}
        place(hwnd,false);
        if IsWindowVisible(hwnd)==0 || IsIconic(hwnd)!=0 { ShowWindow(hwnd,4); place(hwnd,false); }
        super::super::live_blur::maintain(hwnd);
    }}
}
#[cfg(windows)]
pub use windows::{configure,maintain,region,restack,composition_blur,wallpaper_generation};
