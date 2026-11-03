use super::{Account, Result, Secret};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};
use std::{io::{Read, Write}, net::TcpListener, sync::atomic::{AtomicBool, Ordering}, time::{Duration, Instant}};
const REDIRECT: &str = "http://localhost:42813/";
pub fn open_browser(url: &str) -> Result<()> {
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("rundll32.exe").arg("url.dll,FileProtocolHandler").arg(url).creation_flags(0x08000000).spawn().map_err(|_| "Browser konnte nicht geöffnet werden")?;
        Ok(())
    }
    #[cfg(not(windows))] { let _ = url; Err("Browseranmeldung ist derzeit nur unter Windows verfügbar".into()) }
}
fn token_endpoint(account: &Account) -> String {
    if matches!(account.protocol.as_str(), "gmail" | "drive") { "https://oauth2.googleapis.com/token".into() }
    else { format!("https://login.microsoftonline.com/{}/oauth2/v2.0/token", account.tenant) }
}
fn exchange(account: &Account, secret: &mut Secret, mut fields: Vec<(&str, String)>) -> Result<()> {
    fields.push(("client_id", account.client_id.clone()));
    if matches!(account.protocol.as_str(), "gmail" | "drive") && !secret.client_secret.is_empty() { fields.push(("client_secret", secret.client_secret.clone())); }
    let response = super::transport::http()?.post(token_endpoint(account)).form(&fields).send().map_err(|_| "Anmeldedienst nicht erreichbar")?;
    let result = super::transport::json(response).map_err(|_| "Anmeldung konnte nicht erneuert oder abgeschlossen werden. Client-ID, App-Registrierung und Berechtigungen prüfen; gegebenenfalls erneut anmelden.")?;
    secret.access_token = result["access_token"].as_str().ok_or("Anmeldedienst lieferte keinen Zugriffstoken")?.to_string();
    if let Some(refresh) = result["refresh_token"].as_str() { secret.refresh_token = refresh.into(); }
    secret.expires = super::now() + result["expires_in"].as_i64().unwrap_or(3600) - 120;
    if secret.refresh_token.is_empty() { return Err("Keine dauerhafte Anmeldung erhalten. Offline-Zugriff in der App-Registrierung erlauben und erneut anmelden.".into()); }
    Ok(())
}
pub fn refresh(account: &Account, secret: &mut Secret) -> Result<()> {
    if secret.expires > super::now() && !secret.access_token.is_empty() { return Ok(()); }
    if secret.refresh_token.is_empty() { return Err("Bitte erneut beim Mailanbieter anmelden".into()); }
    exchange(account, secret, vec![("grant_type", "refresh_token".into()), ("refresh_token", secret.refresh_token.clone())])
}
pub fn authorize(account: &Account, secret: &mut Secret, cancel: &AtomicBool) -> Result<()> {
    let listener = TcpListener::bind("127.0.0.1:42813").map_err(|_| "Anmeldeport 42813 ist belegt. Andere laufende Anmeldung schließen und erneut versuchen.")?;
    listener.set_nonblocking(true).map_err(|_| "Lokale Anmeldung konnte nicht vorbereitet werden")?;
    let verifier = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = uuid::Uuid::new_v4().to_string();
    let endpoint = if matches!(account.protocol.as_str(), "gmail" | "drive") { "https://accounts.google.com/o/oauth2/v2/auth".into() }
        else { format!("https://login.microsoftonline.com/{}/oauth2/v2.0/authorize", account.tenant) };
    let mut url = url::Url::parse(&endpoint).map_err(|_| "Ungültiger Anmeldedienst")?;
    url.query_pairs_mut().append_pair("client_id", &account.client_id).append_pair("response_type", "code").append_pair("redirect_uri", REDIRECT)
        .append_pair("state", &state).append_pair("code_challenge", &challenge).append_pair("code_challenge_method", "S256").append_pair("login_hint", &account.email)
        .append_pair("scope", if matches!(account.protocol.as_str(), "gmail" | "drive") { if account.protocol == "drive" { "https://www.googleapis.com/auth/drive.appdata" } else { "https://www.googleapis.com/auth/gmail.readonly" } } else { "offline_access User.Read Mail.Read" });
    if matches!(account.protocol.as_str(), "gmail" | "drive") { url.query_pairs_mut().append_pair("access_type", "offline").append_pair("prompt", "consent"); }
    open_browser(url.as_str())?;
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(180) {
        if cancel.load(Ordering::SeqCst) { return Err("Anmeldung abgebrochen".into()); }
        match listener.accept() {
            Ok((mut stream, address)) => {
                if !address.ip().is_loopback() { continue; }
                stream.set_read_timeout(Some(Duration::from_secs(2))).ok(); stream.set_write_timeout(Some(Duration::from_secs(2))).ok();
                let mut request = [0; 8192]; let count = stream.read(&mut request).unwrap_or(0);
                let request = String::from_utf8_lossy(&request[..count]);
                let mut line = request.lines().next().unwrap_or("").split_whitespace();
                let method = line.next(); let path = line.next().unwrap_or("");
                let callback = url::Url::parse(&format!("http://localhost{path}"));
                let valid = callback.as_ref().ok().is_some_and(|u| method == Some("GET") && u.path() == "/" && u.query_pairs().any(|(key, value)| key == "state" && value == state));
                if !valid { let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); continue; }
                let callback = callback.unwrap();
                let body = "Anmeldung empfangen. Du kannst dieses Fenster schliessen und zu Journal zurueckkehren.";
                let _ = stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes());
                if callback.query_pairs().any(|(key, _)| key == "error") { return Err("Anmeldung wurde vom Mailanbieter abgebrochen oder abgelehnt".into()); }
                let code = callback.query_pairs().find(|(key, _)| key == "code").map(|(_, value)| value.to_string()).ok_or("Anmeldung enthält keinen Autorisierungscode")?;
                return exchange(account, secret, vec![("grant_type", "authorization_code".into()), ("code", code), ("code_verifier", verifier), ("redirect_uri", REDIRECT.into())]);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => return Err("Lokale Anmeldung fehlgeschlagen".into()),
        }
    }
    Err("Die Browseranmeldung hat zu lange gedauert. Bitte erneut versuchen.".into())
}
