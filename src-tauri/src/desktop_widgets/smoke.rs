//! Native integration-test access to the actual WebView2 controller. Always unavailable in release builds.
#[tauri::command]
pub async fn widget_smoke_cdp(app:tauri::AppHandle,label:String,method:String,params:String)->Result<serde_json::Value,String>{
    #[cfg(all(windows,debug_assertions))] {
        use tauri::Manager;
        if crate::widget_smoke_root().is_none(){return Err("Only available in an isolated native smoke test.".into());}
        if label!="main"&&super::widget_id(&label).is_none(){return Err("Unknown test window".into());}
        let window=app.get_webview_window(&label).ok_or("Test window is not ready")?;
        if method=="Journal.stack"{
            #[link(name="user32")] unsafe extern "system"{fn GetTopWindow(hwnd:isize)->isize;fn GetWindow(hwnd:isize,command:u32)->isize;}
            let handles=app.webview_windows().into_iter().filter(|(label,_)|super::widget_id(label).is_some()).filter_map(|(label,window)|window.hwnd().ok().map(|hwnd|(hwnd.0 as isize,label))).collect::<std::collections::HashMap<_,_>>();
            let mut order=Vec::new();unsafe{let mut current=GetTopWindow(0);while current!=0{if let Some(label)=handles.get(&current){order.push(label.clone());}current=GetWindow(current,2);}}
            return Ok(serde_json::json!(order));
        }
        if method=="Journal.window"{return Ok(serde_json::json!({"hwnd":window.hwnd().map_err(|e|e.to_string())?.0 as usize,"position":window.outer_position().map_err(|e|e.to_string())?,"size":window.inner_size().map_err(|e|e.to_string())?}));}
        if method=="Journal.disableInput"{
            #[link(name="user32")] unsafe extern "system"{fn EnableWindow(hwnd:isize,enable:i32)->i32;}
            unsafe{EnableWindow(window.hwnd().map_err(|e|e.to_string())?.0 as isize,0);}
            return Ok(serde_json::Value::Null);
        }
        if method=="Journal.region"{
            #[link(name="user32")] unsafe extern "system"{fn GetWindowRgn(hwnd:isize,region:isize)->i32;}
            #[link(name="gdi32")] unsafe extern "system"{fn CreateRectRgn(a:i32,b:i32,c:i32,d:i32)->isize;fn PtInRegion(region:isize,x:i32,y:i32)->i32;fn DeleteObject(object:isize)->i32;}
            let points:Vec<(i32,i32)>=serde_json::from_str(&params).map_err(|e|e.to_string())?;
            unsafe{
                let region=CreateRectRgn(0,0,0,0);let kind=GetWindowRgn(window.hwnd().map_err(|e|e.to_string())?.0 as isize,region);
                let inside:Vec<bool>=points.iter().map(|&(x,y)|PtInRegion(region,x,y)!=0).collect();DeleteObject(region);
                return Ok(serde_json::json!({"kind":kind,"inside":inside}));
            }
        }
        let(tx,rx)=std::sync::mpsc::channel();
        window.with_webview(move|platform|unsafe{
            let result=(||{
                use windows::core::PCWSTR;
                let method:Vec<u16>=method.encode_utf16().chain(Some(0)).collect();let params:Vec<u16>=params.encode_utf16().chain(Some(0)).collect();
                let result_tx=tx.clone();
                let handler=webview2_com::CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move|result,text|{
                    let result=result.map_err(|e|e.to_string()).and_then(|_|serde_json::from_str(&text).map_err(|e|e.to_string()));
                    let _=result_tx.send(result);Ok(())
                }));
                platform.controller().CoreWebView2()?.CallDevToolsProtocolMethod(PCWSTR(method.as_ptr()),PCWSTR(params.as_ptr()),&handler)
            })();
            if let Err(error)=result{let _=tx.send(Err(error.to_string()));}
        }).map_err(|e|e.to_string())?;
        return rx.recv_timeout(std::time::Duration::from_secs(30)).map_err(|e|e.to_string())?;
    }
    #[cfg(not(all(windows,debug_assertions)))] {let _=(app,label,method,params);Err("Only available in an isolated debug build.".into())}
}
