//! Capture only the shell's wallpaper host, never the screen or application windows.
//! GPU wallpaper children aren't necessarily included in Windows' blur-behind material.
use std::{collections::HashMap, sync::{Mutex, OnceLock}};
use windows::{core::{Interface, factory}, Graphics::{Capture::{Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession}, DirectX::{DirectXPixelFormat, Direct3D11::IDirect3DDevice}}, Win32::{Foundation::{HWND, HMODULE}, Graphics::{Direct3D::D3D_DRIVER_TYPE_HARDWARE, Direct3D11::*, Dxgi::{IDXGIDevice, Common::*}}, System::WinRT::{Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess}, Graphics::Capture::IGraphicsCaptureItemInterop, RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED}}};

#[repr(C)] #[derive(Default, Clone, Copy)] struct Rect { left:i32, top:i32, right:i32, bottom:i32 }
#[link(name="user32")] unsafe extern "system" {
    fn EnumWindows(callback:unsafe extern "system" fn(isize,isize)->i32,data:isize)->i32;
    fn EnumChildWindows(hwnd:isize,callback:unsafe extern "system" fn(isize,isize)->i32,data:isize)->i32;
    fn GetWindowThreadProcessId(hwnd:isize,pid:*mut u32)->u32;
    fn GetShellWindow()->isize;
    fn GetClassNameW(hwnd:isize,name:*mut u16,count:i32)->i32;
    fn IsWindowVisible(hwnd:isize)->i32;
    fn GetWindowRect(hwnd:isize,rect:*mut Rect)->i32;
}
struct Find { point:(i32,i32), shell_pid:u32, found:isize }
unsafe extern "system" fn child(hwnd:isize,data:isize)->i32 { unsafe {
    let find=&mut *(data as *mut Find);let mut pid=0;GetWindowThreadProcessId(hwnd,&mut pid);
    let mut r=Rect::default();
    if pid!=find.shell_pid && pid!=std::process::id() && IsWindowVisible(hwnd)!=0 && GetWindowRect(hwnd,&mut r)!=0 && find.point.0>=r.left && find.point.0<r.right && find.point.1>=r.top && find.point.1<r.bottom {find.found=hwnd;return 0;}
    1
}}
unsafe extern "system" fn root(hwnd:isize,data:isize)->i32 { unsafe {
    let mut name=[0u16;64];let len=GetClassNameW(hwnd,name.as_mut_ptr(),64);
    let name=String::from_utf16_lossy(&name[..len.max(0) as usize]);
    if (name=="Progman"||name=="WorkerW") && IsWindowVisible(hwnd)!=0 {
        EnumChildWindows(hwnd,child,data);
        let find=&mut *(data as *mut Find);
        if find.found!=0 {find.found=hwnd;return 0;}
    }
    1
}}
fn source(rect:(i32,i32,i32,i32))->Option<isize>{unsafe{
    let mut shell_pid=0;GetWindowThreadProcessId(GetShellWindow(),&mut shell_pid);
    let mut find=Find{point:(rect.0+rect.2/2,rect.1+rect.3/2),shell_pid,found:0};
    EnumWindows(root,&mut find as *mut _ as isize);
    (find.found!=0).then_some(find.found)
}}
struct Apartment(bool);
impl Apartment { fn new()->Self{Self(unsafe{RoInitialize(RO_INIT_MULTITHREADED).is_ok()})} }
impl Drop for Apartment { fn drop(&mut self){if self.0{unsafe{RoUninitialize();}}} }
struct Source {
    device:ID3D11Device, context:ID3D11DeviceContext, pool:Direct3D11CaptureFramePool,
    session:GraphicsCaptureSession, frame:Option<Direct3D11CaptureFrame>,
    staging:Option<(u32,u32,ID3D11Texture2D)>, bounds_size:(i32,i32),
}
impl Drop for Source { fn drop(&mut self){let _=self.session.Close();if let Some(frame)=self.frame.take(){let _=frame.Close();}let _=self.pool.Close();} }
impl Source {
    fn new(hwnd:isize)->windows::core::Result<Self>{unsafe{
        let mut device=None;let mut context=None;
        D3D11CreateDevice(None,D3D_DRIVER_TYPE_HARDWARE,HMODULE::default(),D3D11_CREATE_DEVICE_BGRA_SUPPORT,None,D3D11_SDK_VERSION,Some(&mut device),None,Some(&mut context))?;
        let device=device.unwrap();let context=context.unwrap();
        let interop:IGraphicsCaptureItemInterop=factory::<GraphicsCaptureItem,IGraphicsCaptureItemInterop>()?;
        let item:GraphicsCaptureItem=interop.CreateForWindow(HWND(hwnd as *mut _))?;
        let dxgi:IDXGIDevice=device.cast()?;
        let runtime:IDirect3DDevice=CreateDirect3D11DeviceFromDXGIDevice(&dxgi)?.cast()?;
        let pool=Direct3D11CaptureFramePool::CreateFreeThreaded(&runtime,DirectXPixelFormat::B8G8R8A8UIntNormalized,2,item.Size()?)?;
        let session=pool.CreateCaptureSession(&item)?;
        session.SetIsCursorCaptureEnabled(false)?;
        // Older OS versions may not offer border control. The capture remains
        // confined to the desktop host rather than silently capturing a monitor.
        let _=session.SetIsBorderRequired(false);
        let _=session.SetMinUpdateInterval(windows::Foundation::TimeSpan{Duration:500_000});
        session.StartCapture()?;
        let mut bounds=Rect::default();GetWindowRect(hwnd,&mut bounds);
        Ok(Self{device,context,pool,session,frame:None,staging:None,bounds_size:(bounds.right-bounds.left,bounds.bottom-bounds.top)})
    }}
    fn picture(&mut self,hwnd:isize,rect:(i32,i32,i32,i32),previous:Option<((i32,i32,i32,i32),i64)>)->windows::core::Result<(Vec<u8>,i64)>{unsafe{
        // Drain queued frames, but retain the latest frame for a widget that
        // moves over a temporarily paused wallpaper.
        for _ in 0..2 {let Ok(frame)=self.pool.TryGetNextFrame() else{break;};if let Some(old)=self.frame.replace(frame){let _=old.Close();}}
        let Some(frame)=self.frame.as_ref() else{return Ok((Vec::new(),0));};
        let time=frame.SystemRelativeTime()?.Duration;
        if previous==Some((rect,time)){return Ok((Vec::new(),time));}
        let access:IDirect3DDxgiInterfaceAccess=frame.Surface()?.cast()?;
        let texture:ID3D11Texture2D=access.GetInterface()?;
        let mut desc=D3D11_TEXTURE2D_DESC::default();texture.GetDesc(&mut desc);
        let mut origin=Rect::default();GetWindowRect(hwnd,&mut origin);
        let content=frame.ContentSize()?;
        if content.Width<=0||content.Height<=0||desc.Width==0||desc.Height==0{return Ok((Vec::new(),0));}
        let left=(rect.0-origin.left).clamp(0,content.Width.min(desc.Width as i32).saturating_sub(1)) as u32;
        let top=(rect.1-origin.top).clamp(0,content.Height.min(desc.Height as i32).saturating_sub(1)) as u32;
        let width=(rect.2.max(1) as u32).min(desc.Width-left).min((content.Width as u32).saturating_sub(left));
        let height=(rect.3.max(1) as u32).min(desc.Height-top).min((content.Height as u32).saturating_sub(top));
        if width==0||height==0||u64::from(width)*u64::from(height)>8_000_000{return Ok((Vec::new(),0));}
        if self.staging.as_ref().is_none_or(|s|s.0!=width||s.1!=height){
            let desc=D3D11_TEXTURE2D_DESC{Width:width,Height:height,MipLevels:1,ArraySize:1,Format:DXGI_FORMAT_B8G8R8A8_UNORM,SampleDesc:DXGI_SAMPLE_DESC{Count:1,Quality:0},Usage:D3D11_USAGE_STAGING,BindFlags:0,CPUAccessFlags:D3D11_CPU_ACCESS_READ.0 as u32,MiscFlags:0};
            let mut staging=None;self.device.CreateTexture2D(&desc,None,Some(&mut staging))?;
            self.staging=Some((width,height,staging.unwrap()));
        }
        let staging=&self.staging.as_ref().unwrap().2;
        let crop=D3D11_BOX{left,top,front:0,right:left+width,bottom:top+height,back:1};
        self.context.CopySubresourceRegion(staging,0,0,0,0,&texture,0,Some(&crop));
        let mut mapped=D3D11_MAPPED_SUBRESOURCE::default();self.context.Map(staging,0,D3D11_MAP_READ,0,Some(&mut mapped))?;
        let size=(width*height*4) as usize;
        // The header is filled in, the rows appended as they are read (no zeroed buffer of the picture's size first).
        let mut bmp=Vec::with_capacity(54+size);bmp.extend_from_slice(&[0u8;54]);bmp[..2].copy_from_slice(b"BM");
        let length=(54+size) as u32;bmp[2..6].copy_from_slice(&length.to_le_bytes());bmp[10..14].copy_from_slice(&54u32.to_le_bytes());bmp[14..18].copy_from_slice(&40u32.to_le_bytes());
        bmp[18..22].copy_from_slice(&(width as i32).to_le_bytes());bmp[22..26].copy_from_slice(&(-(height as i32)).to_le_bytes());bmp[26..28].copy_from_slice(&1u16.to_le_bytes());bmp[28..30].copy_from_slice(&32u16.to_le_bytes());
        for y in 0..height as usize {let row=std::slice::from_raw_parts((mapped.pData as *const u8).add(y*mapped.RowPitch as usize),width as usize*4);bmp.extend_from_slice(row);}
        self.context.Unmap(staging,0);
        Ok((bmp,time))
    }}
}
#[derive(Clone,Copy)] struct Client { source:isize, previous:Option<((i32,i32,i32,i32),i64)> }
#[derive(Default)] struct Registry { clients:HashMap<isize,Client>, sources:HashMap<isize,Source> }
static REGISTRY:OnceLock<Mutex<Registry>>=OnceLock::new();
fn registry()->&'static Mutex<Registry>{REGISTRY.get_or_init(||Mutex::new(Registry::default()))}
impl Registry {fn prune(&mut self){self.sources.retain(|hwnd,_|self.clients.values().any(|s|s.source==*hwnd));}}
pub fn enable(owner:isize,rect:(i32,i32,i32,i32))->Result<bool,String>{
    let _apartment=Apartment::new();
    let Some(source)=source(rect) else{disable(owner);return Ok(false);};
    attach(owner,source)?;Ok(true)
}
fn attach(owner:isize,source:isize)->Result<(),String>{
    let mut registry=registry().lock().map_err(|e|e.to_string())?;
    let mut bounds=Rect::default();unsafe{GetWindowRect(source,&mut bounds);}
    let size=(bounds.right-bounds.left,bounds.bottom-bounds.top);
    if registry.sources.get(&source).is_none_or(|s|s.bounds_size!=size){let capture=Source::new(source).map_err(|e|format!("Live-Hintergrund konnte nicht aufgenommen werden: {e}"))?;registry.sources.insert(source,capture);}
    if registry.clients.get(&owner).is_none_or(|c|c.source!=source){registry.clients.insert(owner,Client{source,previous:None});}
    registry.prune();Ok(())
}
pub fn disable(owner:isize){let _apartment=Apartment::new();if let Ok(mut registry)=registry().lock(){registry.clients.remove(&owner);registry.prune();}}
pub fn picture(owner:isize,rect:(i32,i32,i32,i32))->Result<Vec<u8>,String>{
    let _apartment=Apartment::new();let mut registry=registry().lock().map_err(|e|e.to_string())?;
    let client=*registry.clients.get(&owner).ok_or("Live-Hintergrund ist nicht aktiv.")?;
    let (bytes,time)=registry.sources.get_mut(&client.source).ok_or("Live-Hintergrund wurde geschlossen.")?.picture(client.source,rect,client.previous).map_err(|e|e.to_string())?;
    if !bytes.is_empty(){registry.clients.get_mut(&owner).unwrap().previous=Some((rect,time));}
    Ok(bytes)
}
#[cfg(debug_assertions)] pub fn test_attach(owner:isize,source:isize)->Result<(),String>{let _apartment=Apartment::new();attach(owner,source)}
