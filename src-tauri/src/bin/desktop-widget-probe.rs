// Isolated native placement probe: no journal, vault, tray, or database is opened.
#[cfg(windows)]
#[path="../desktop_widgets/host.rs"]
mod host;
#[cfg(windows)]
fn main() {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicIsize,Ordering};
    static EDITOR:AtomicIsize=AtomicIsize::new(0);
    #[repr(C)] struct WindowClass{style:u32,proc:unsafe extern "system" fn(isize,u32,usize,isize)->isize,class_extra:i32,window_extra:i32,instance:isize,icon:isize,cursor:isize,background:isize,menu:*const u16,name:*const u16}
    #[repr(C)] struct Msg {hwnd:isize,msg:u32,w:usize,l:isize,time:u32,x:i32,y:i32,private:u32}
    #[link(name="user32")] unsafe extern "system" {
        fn CreateWindowExW(ex:u32,class:*const u16,title:*const u16,style:u32,x:i32,y:i32,w:i32,h:i32,parent:isize,menu:isize,instance:isize,param:*const c_void)->isize;
        fn PeekMessageW(msg:*mut Msg,hwnd:isize,min:u32,max:u32,remove:u32)->i32;
        fn TranslateMessage(msg:*const Msg)->i32;
        fn DispatchMessageW(msg:*const Msg)->isize;
        fn DestroyWindow(hwnd:isize)->i32;
        fn RegisterClassW(class:*const WindowClass)->u16;
        fn DefWindowProcW(hwnd:isize,msg:u32,w:usize,l:isize)->isize;
        fn SetFocus(hwnd:isize)->isize;
    }
    #[link(name="kernel32")] unsafe extern "system"{fn GetModuleHandleW(name:*const u16)->isize;}
    unsafe extern "system" fn procedure(hwnd:isize,msg:u32,w:usize,l:isize)->isize{
        if msg==0x0007 {let editor=EDITOR.load(Ordering::Relaxed);if editor!=0{SetFocus(editor);}}
        DefWindowProcW(hwnd,msg,w,l)
    }
    let wide=|s:&str|s.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    unsafe {
        let class=wide("JournalDesktopProbe");let instance=GetModuleHandleW(std::ptr::null());
        let wc=WindowClass{style:0,proc:procedure,class_extra:0,window_extra:0,instance,icon:0,cursor:0,background:6,menu:std::ptr::null(),name:class.as_ptr()};
        assert_ne!(RegisterClassW(&wc),0);
        let title=wide("Journal desktop probe");
        let hwnd=CreateWindowExW(0x80,class.as_ptr(),title.as_ptr(),0x90000000|0x00800000,80,100,420,220,0,0,instance,std::ptr::null());
        let editor=CreateWindowExW(0,wide("EDIT").as_ptr(),wide("Journal desktop probe – type here").as_ptr(),0x50010004,2,2,412,212,hwnd,0,instance,std::ptr::null());
        EDITOR.store(editor,Ordering::Relaxed);
        host::configure(hwnd).expect("desktop placement");
        let normal=CreateWindowExW(0,wide("STATIC").as_ptr(),wide("Journal ordinary window probe").as_ptr(),0x00cf0000,80,100,420,220,0,0,0,std::ptr::null());
        if let Some(path)=std::env::args().nth(1) { std::fs::write(path,format!("{{\"widget\":{hwnd},\"editor\":{editor},\"application\":{normal}}}")).unwrap(); }
        let start=std::time::Instant::now();
        while start.elapsed().as_secs()<90 {
            let mut msg:Msg=std::mem::zeroed();
            while PeekMessageW(&mut msg,0,0,0,1)!=0 {TranslateMessage(&msg);DispatchMessageW(&msg);}
            host::maintain(hwnd); std::thread::sleep(std::time::Duration::from_millis(100));
        }
        DestroyWindow(hwnd);
        DestroyWindow(normal);
    }
}
#[cfg(not(windows))]
fn main() { eprintln!("The desktop probe is Windows-only."); }
