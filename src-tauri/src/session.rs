//! Windows shutting down, restarting or signing out: when "sync when quitting" is chosen (src/sync/driveSync.ts), the
//! journal window asks Windows to wait (ShutdownBlockReasonCreate shows "Journal synchronisiert …" on the shutdown
//! screen), tells the page to save and sync (`journal:session-end`) and keeps its messages flowing until the page reports
//! back (`session_sync_done`) or 25 seconds have passed. Windows may still end it earlier – the user can always choose
//! to shut down anyway – so this is a best effort; nothing is half-written, a sync that does not finish uploads nothing.
#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};
    use tauri::Emitter;
    type Hwnd = isize;
    #[repr(C)] struct Point { x: i32, y: i32 }
    #[repr(C)] struct Msg { hwnd: Hwnd, message: u32, wparam: usize, lparam: isize, time: u32, pt: Point, private: u32 }
    type Subclass = unsafe extern "system" fn(Hwnd, u32, usize, isize, usize, usize) -> isize;
    #[link(name = "user32")]
    unsafe extern "system" {
        fn ShutdownBlockReasonCreate(hwnd: Hwnd, reason: *const u16) -> i32;
        fn ShutdownBlockReasonDestroy(hwnd: Hwnd) -> i32;
        fn PeekMessageW(msg: *mut Msg, hwnd: Hwnd, min: u32, max: u32, remove: u32) -> i32;
        fn TranslateMessage(msg: *const Msg) -> i32;
        fn DispatchMessageW(msg: *const Msg) -> isize;
        fn MsgWaitForMultipleObjects(count: u32, handles: *const isize, wait_all: i32, millis: u32, mask: u32) -> u32;
    }
    #[link(name = "comctl32")]
    unsafe extern "system" {
        fn SetWindowSubclass(hwnd: Hwnd, callback: Subclass, id: usize, data: usize) -> i32;
        fn RemoveWindowSubclass(hwnd: Hwnd, callback: Subclass, id: usize) -> i32;
        fn DefSubclassProc(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> isize;
    }
    const SUBCLASS_ID: usize = 0x4a5345; // "JSE"
    static ENABLED: AtomicBool = AtomicBool::new(false);
    static DONE: AtomicBool = AtomicBool::new(false);
    static RUNNING: AtomicBool = AtomicBool::new(false);
    static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

    unsafe extern "system" fn subclass(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize, _id: usize, _data: usize) -> isize {
        // WM_QUERYENDSESSION: Windows asks whether it may end the session.
        if msg == 0x0011 && ENABLED.load(Ordering::SeqCst) && !RUNNING.swap(true, Ordering::SeqCst) {
            let reason: Vec<u16> = crate::ui_language::text("Journal synchronisiert mit Google Drive …", "Journal is syncing with Google Drive …").encode_utf16().chain(Some(0)).collect();
            ShutdownBlockReasonCreate(hwnd, reason.as_ptr());
            DONE.store(false, Ordering::SeqCst);
            if let Some(app) = APP.get() { let _ = app.emit_to("main", "journal:session-end", ()); }
            // The page needs the message loop to run its sync (IPC comes through this thread), so keep it flowing here.
            let started = Instant::now();
            let mut message = std::mem::zeroed::<Msg>();
            while !DONE.load(Ordering::SeqCst) && started.elapsed() < Duration::from_secs(25) {
                MsgWaitForMultipleObjects(0, std::ptr::null(), 0, 100, 0x04FF);
                while PeekMessageW(&mut message, 0, 0, 0, 1) != 0 { TranslateMessage(&message); DispatchMessageW(&message); }
            }
            ShutdownBlockReasonDestroy(hwnd);
            RUNNING.store(false, Ordering::SeqCst);
            return 1;
        }
        // WM_NCDESTROY: the window goes, and so does the subclass.
        if msg == 0x0082 { RemoveWindowSubclass(hwnd, subclass, SUBCLASS_ID); }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }
    pub fn install(app: &tauri::AppHandle, hwnd: isize) { let _ = APP.set(app.clone()); unsafe { SetWindowSubclass(hwnd, subclass, SUBCLASS_ID, 0); } }
    pub fn set_enabled(enabled: bool) { ENABLED.store(enabled, Ordering::SeqCst); }
    pub fn done() { DONE.store(true, Ordering::SeqCst); }
}

/// Watch the journal window for Windows ending the session (main.rs, setup).
pub fn install(app: &tauri::AppHandle) {
    #[cfg(windows)]
    {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            if let Ok(hwnd) = window.hwnd() { let raw = hwnd.0 as isize; let handle = app.clone(); let _ = window.run_on_main_thread(move || imp::install(&handle, raw)); }
        }
    }
    #[cfg(not(windows))]
    let _ = app;
}
/// Whether Windows ending the session waits for a sync (the page sets it from the chosen sync moment).
#[tauri::command]
pub fn session_sync_enabled(enabled: bool) {
    #[cfg(windows)] imp::set_enabled(enabled);
    #[cfg(not(windows))] let _ = enabled;
}
/// The page has saved and synced (or given up): Windows may go on.
#[tauri::command]
pub fn session_sync_done() {
    #[cfg(windows)] imp::done();
}
