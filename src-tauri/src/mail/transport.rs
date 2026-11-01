use super::{Account, Message, Result, Secret, MAX_MESSAGE};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use mailparse::MailHeaderMap;
use native_tls::{TlsConnector, TlsStream};
use std::{collections::HashSet, io::{BufRead, BufReader, Read, Write}, net::{TcpStream, ToSocketAddrs}, time::Duration};

fn allowed_address(security: &str, address: std::net::IpAddr) -> bool {
    security != "bridge" || address.is_loopback()
}
fn tcp(account: &Account) -> Result<TcpStream> {
    let addresses = (account.host.as_str(), account.port).to_socket_addrs().map_err(|_| "Mailserver konnte nicht gefunden werden")?;
    for address in addresses {
        // Check the resolved address too: even an altered localhost mapping must not expose Bridge credentials.
        if !allowed_address(&account.security, address.ip()) { continue; }
        if let Ok(stream) = TcpStream::connect_timeout(&address, Duration::from_secs(15)) {
            stream.set_read_timeout(Some(Duration::from_secs(30))).map_err(|_| "Zeitlimit konnte nicht gesetzt werden")?;
            stream.set_write_timeout(Some(Duration::from_secs(30))).map_err(|_| "Zeitlimit konnte nicht gesetzt werden")?;
            return Ok(stream);
        }
    }
    Err("Mailserver nicht erreichbar. Adresse, Port und Internetverbindung prüfen.".into())
}
fn tls(account: &Account) -> Result<TlsConnector> {
    let mut builder = TlsConnector::builder();
    builder.min_protocol_version(Some(native_tls::Protocol::Tlsv12));
    // Proton Bridge generates a self-signed certificate. This mode is validated as loopback-only before use.
    if account.security == "bridge" { builder.danger_accept_invalid_certs(true); builder.danger_accept_invalid_hostnames(true); }
    builder.build().map_err(|_| "TLS konnte nicht initialisiert werden".into())
}
fn imap_session(account: &Account, secret: &Secret) -> Result<imap::Session<TlsStream<TcpStream>>> {
    let stream = tcp(account)?;
    let connector = tls(account)?;
    let client = if account.security == "tls" {
        let encrypted = connector.connect(&account.host, stream).map_err(|_| "TLS-Verbindung fehlgeschlagen. Zertifikat und Server prüfen.")?;
        let mut client = imap::Client::new(encrypted);
        client.read_greeting().map_err(|_| "Keine gültige IMAP-Begrüßung")?; client
    } else {
        let mut client = imap::Client::new(stream);
        client.read_greeting().map_err(|_| "Keine gültige IMAP-Begrüßung")?;
        client.secure(&account.host, &connector).map_err(|_| "STARTTLS fehlgeschlagen. Server, Port und Zertifikat prüfen.")?
    };
    client.login(&account.username, &secret.password).map_err(|_| "IMAP-Anmeldung fehlgeschlagen. Benutzername und (App-)Passwort prüfen.".into())
}
pub fn http() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder().timeout(Duration::from_secs(30)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "HTTP-Verbindung konnte nicht erstellt werden".into())
}
pub fn json(response: reqwest::blocking::Response) -> Result<serde_json::Value> {
    if !response.status().is_success() { return Err(format!("Mailanbieter meldet HTTP {}. Anmeldung oder Berechtigungen prüfen.", response.status().as_u16())); }
    let mut bytes = Vec::new();
    response.take((MAX_MESSAGE * 2 + 1) as u64).read_to_end(&mut bytes).map_err(|_| "Antwort des Mailanbieters konnte nicht gelesen werden")?;
    if bytes.len() > MAX_MESSAGE * 2 { return Err("Antwort des Mailanbieters ist zu groß".into()); }
    serde_json::from_slice(&bytes).map_err(|_| "Ungültige Antwort des Mailanbieters".into())
}
pub fn test(account: &Account, secret: &Secret) -> Result<()> {
    match account.protocol.as_str() {
        "imap" => {
            let mut session = imap_session(account, secret)?;
            let result = session.examine(&account.folder).map(|_| ()).map_err(|_| "IMAP-Ordner nicht gefunden oder nicht lesbar".into());
            let _ = session.logout(); result
        }
        "pop3" => { let mut connection = pop_connect(account, secret)?; pop_command(&mut connection, "STAT")?; let _ = pop_command(&mut connection, "QUIT"); Ok(()) }
        "gmail" => {
            let profile = json(http()?.get("https://gmail.googleapis.com/gmail/v1/users/me/profile").bearer_auth(&secret.access_token).send().map_err(|_| "Gmail nicht erreichbar")?)?;
            if !profile["emailAddress"].as_str().unwrap_or("").eq_ignore_ascii_case(&account.email) { return Err("Das angemeldete Google-Konto stimmt nicht mit der angegebenen E-Mail-Adresse überein".into()); } Ok(())
        }
        "microsoft" => {
            let profile = json(http()?.get("https://graph.microsoft.com/v1.0/me").query(&[("$select", "mail,userPrincipalName")]).bearer_auth(&secret.access_token).send().map_err(|_| "Microsoft nicht erreichbar")?)?;
            if ![profile["mail"].as_str(), profile["userPrincipalName"].as_str()].iter().flatten().any(|email| email.eq_ignore_ascii_case(&account.email)) { return Err("Das angemeldete Microsoft-Konto stimmt nicht mit der angegebenen E-Mail-Adresse überein".into()); } Ok(())
        }
        _ => Err("Unbekannte Mailverbindung".into()),
    }
}
pub fn fetch(account: &Account, secret: &Secret, known: &HashSet<String>) -> Result<Vec<Message>> {
    match account.protocol.as_str() { "imap" => fetch_imap(account, secret, known), "pop3" => fetch_pop(account, secret, known), "gmail" => fetch_gmail(account, secret, known), "microsoft" => fetch_microsoft(account, secret, known), _ => Err("Unbekannte Mailverbindung".into()) }
}
fn fetch_imap(account: &Account, secret: &Secret, known: &HashSet<String>) -> Result<Vec<Message>> {
    let mut session = imap_session(account, secret)?;
    let result = (|| {
        let mailbox = session.examine(&account.folder).map_err(|_| "IMAP-Ordner nicht lesbar")?;
        let since = (chrono::Utc::now() - chrono::Duration::days(account.days as i64)).format("%d-%b-%Y").to_string();
        let mut uids: Vec<_> = session.uid_search(format!("SINCE {since}")).map_err(|_| "IMAP-Suche fehlgeschlagen")?.into_iter().collect();
        uids.sort_unstable();
        let prefix = format!("imap:{}:{}:", account.folder, mailbox.uid_validity.ok_or("Mailserver liefert keine UIDVALIDITY")?);
        let mut messages = Vec::new();
        for uid in uids.into_iter().filter(|uid| !known.contains(&format!("{prefix}{uid}"))).take(50) {
            let key = format!("{prefix}{uid}");
            let sizes = session.uid_fetch(uid.to_string(), "RFC822.SIZE").map_err(|_| "Mailgröße konnte nicht gelesen werden")?;
            if sizes.iter().next().and_then(|m| m.size).is_none_or(|size| size as usize > MAX_MESSAGE) { messages.push(Message::skipped(key, "Eine Nachricht überschreitet 8 MB oder meldet keine Größe und wurde nicht ausgewertet.")); continue; }
            // PEEK and EXAMINE leave the original messages unread and never delete or move them.
            let fetched = session.uid_fetch(uid.to_string(), "BODY.PEEK[]").map_err(|_| "Mail konnte nicht gelesen werden")?;
            if let Some(body) = fetched.iter().next().and_then(|m| m.body()) { messages.push(parse(key.clone(), body).unwrap_or_else(|reason| Message::skipped(key, &reason))); }
        }
        Ok(messages)
    })();
    let _ = session.logout(); result
}
pub fn parse(key: String, raw: &[u8]) -> Result<Message> {
    if raw.len() > MAX_MESSAGE { return Err("E-Mail überschreitet 8 MB".into()); }
    let parsed = mailparse::parse_mail(raw).map_err(|_| "Mailformat konnte nicht gelesen werden")?;
    let subject = parsed.headers.get_first_value("Subject").unwrap_or_default();
    let sender = parsed.headers.get_first_value("From").unwrap_or_default();
    let sent_at = parsed.headers.get_first_value("Date").and_then(|s| mailparse::dateparse(&s).ok()).unwrap_or_else(super::now);
    let mut message = Message { key, subject, sender, sent_at, text: String::new(), html: String::new(), calendars: Vec::new(), notice:String::new() };
    fn visit(mail: &mailparse::ParsedMail<'_>, message: &mut Message, depth: usize) {
        if depth > 20 { return; }
        let mime = mail.ctype.mimetype.as_str();
        let disposition = mail.get_content_disposition();
        let calendar = mime == "text/calendar" || mime == "application/ics" || disposition.params.get("filename").is_some_and(|name| name.to_lowercase().ends_with(".ics"));
        if calendar && message.calendars.len() < 5 { if let Ok(body) = mail.get_body() { if body.len() < 1_000_000 { message.calendars.push(body); } } }
        else if disposition.disposition != mailparse::DispositionType::Attachment {
            let target = match mime { "text/plain" => Some(&mut message.text), "text/html" => Some(&mut message.html), _ => None };
            if let Some(target) = target { if target.len() < 200_000 { if let Ok(body) = mail.get_body() { target.extend(body.chars().take(200_000 - target.len())); target.push('\n'); } } }
        }
        for part in &mail.subparts { visit(part, message, depth + 1); }
    }
    visit(&parsed, &mut message, 0);
    message.subject = message.subject.chars().take(500).collect(); message.sender = message.sender.chars().take(500).collect();
    Ok(message)
}
fn fetch_gmail(account: &Account, secret: &Secret, known: &HashSet<String>) -> Result<Vec<Message>> {
    let client = http()?;
    let mut page = String::new(); let mut result = Vec::new();
    for _ in 0..20 {
        let response = json(client.get("https://gmail.googleapis.com/gmail/v1/users/me/messages").query(&[("q", format!("newer_than:{}d", account.days)), ("maxResults", "100".into()), ("pageToken", page.clone())]).bearer_auth(&secret.access_token).send().map_err(|_| "Gmail-Abruf fehlgeschlagen")?)?;
        for item in response["messages"].as_array().into_iter().flatten() {
            if result.len() >= 50 { return Ok(result); }
            let Some(id) = item["id"].as_str() else { continue };
            let key = format!("gmail:{id}"); if known.contains(&key) { continue; }
            let mut url = url::Url::parse("https://gmail.googleapis.com/gmail/v1/users/me/messages/").unwrap(); url.path_segments_mut().unwrap().push(id);
            let metadata = json(client.get(url.clone()).query(&[("format", "metadata"), ("fields", "sizeEstimate")]).bearer_auth(&secret.access_token).send().map_err(|_| "Gmail-Mailgröße konnte nicht gelesen werden")?)?;
            if metadata["sizeEstimate"].as_u64().is_some_and(|size| size > MAX_MESSAGE as u64) { result.push(Message::skipped(key, "Eine Gmail-Nachricht überschreitet 8 MB und wurde nicht ausgewertet.")); continue; }
            let mail = json(client.get(url).query(&[("format", "raw")]).bearer_auth(&secret.access_token).send().map_err(|_| "Gmail-Nachricht konnte nicht gelesen werden")?)?;
            if let Some(raw) = mail["raw"].as_str() { let raw = URL_SAFE_NO_PAD.decode(raw.trim_end_matches('=')).map_err(|_| "Ungültiges Gmail-Mailformat")?; result.push(parse(key.clone(), &raw).unwrap_or_else(|reason| Message::skipped(key, &reason))); }
            if result.len() >= 50 { return Ok(result); }
        }
        let Some(next) = response["nextPageToken"].as_str() else { break }; page = next.into();
    }
    Ok(result)
}
fn fetch_microsoft(account: &Account, secret: &Secret, known: &HashSet<String>) -> Result<Vec<Message>> {
    let client = http()?;
    let since = (chrono::Utc::now() - chrono::Duration::days(account.days as i64)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let mut url = url::Url::parse("https://graph.microsoft.com/v1.0/me/messages").unwrap();
    url.query_pairs_mut().append_pair("$filter", &format!("receivedDateTime ge {since}")).append_pair("$select", "id").append_pair("$top", "100").append_pair("$orderby", "receivedDateTime desc");
    let mut result = Vec::new();
    for _ in 0..20 {
        let page = json(client.get(url.clone()).header("Prefer", "IdType=\"ImmutableId\"").bearer_auth(&secret.access_token).send().map_err(|_| "Microsoft-Abruf fehlgeschlagen")?)?;
        for item in page["value"].as_array().into_iter().flatten() {
            let Some(id) = item["id"].as_str() else { continue }; let key = format!("microsoft:{id}"); if known.contains(&key) { continue; }
            let mut raw_url = url::Url::parse("https://graph.microsoft.com/v1.0/me/messages/").unwrap(); raw_url.path_segments_mut().unwrap().push(id).push("$value");
            let response = client.get(raw_url).header("Prefer", "IdType=\"ImmutableId\"").bearer_auth(&secret.access_token).send().map_err(|_| "Microsoft-Nachricht konnte nicht gelesen werden")?;
            if !response.status().is_success() { return Err("Microsoft-Nachricht konnte nicht gelesen werden. Mail.Read-Berechtigung prüfen.".into()); }
            let mut bytes = Vec::new(); response.take((MAX_MESSAGE + 1) as u64).read_to_end(&mut bytes).map_err(|_| "Mailantwort unvollständig")?;
            result.push(if bytes.len() <= MAX_MESSAGE { parse(key.clone(), &bytes).unwrap_or_else(|reason| Message::skipped(key, &reason)) } else { Message::skipped(key, "Eine Microsoft-Nachricht überschreitet 8 MB und wurde nicht ausgewertet.") });
            if result.len() >= 50 { return Ok(result); }
        }
        let Some(next) = page["@odata.nextLink"].as_str() else { break };
        url = url::Url::parse(next).map_err(|_| "Ungültige Microsoft-Folgeseite")?;
        if url.scheme() != "https" || url.host_str() != Some("graph.microsoft.com") { return Err("Unerwartete Microsoft-Folgeseite".into()); }
    }
    Ok(result)
}
trait Io: Read + Write + Send {}
impl<T: Read + Write + Send> Io for T {}
type Pop = BufReader<Box<dyn Io>>;
fn pop_line(connection: &mut Pop) -> Result<String> {
    let mut bytes = Vec::new();
    connection.by_ref().take(8193).read_until(b'\n', &mut bytes).map_err(|_| "POP3-Verbindung unterbrochen")?;
    if bytes.len() > 8192 || !bytes.ends_with(b"\r\n") { return Err("Ungültige POP3-Antwort".into()); }
    String::from_utf8(bytes).map_err(|_| "Ungültige POP3-Antwort".into())
}
fn pop_command(connection: &mut Pop, command: &str) -> Result<String> {
    connection.get_mut().write_all(format!("{command}\r\n").as_bytes()).map_err(|_| "POP3-Verbindung unterbrochen")?;
    connection.get_mut().flush().map_err(|_| "POP3-Verbindung unterbrochen")?;
    let answer = pop_line(connection)?;
    if !answer.starts_with("+OK") { return Err("POP3-Befehl abgelehnt. Anmeldung und Servereinstellungen prüfen.".into()); }
    Ok(answer)
}
fn pop_body(connection: &mut Pop) -> Result<Vec<u8>> {
    let mut raw = Vec::new();
    loop {
        let mut line = Vec::new();
        connection.by_ref().take((MAX_MESSAGE + 1 - raw.len()) as u64).read_until(b'\n', &mut line).map_err(|_| "POP3-Mail unvollständig")?;
        if line == b".\r\n" { return Ok(raw); }
        if !line.ends_with(b"\r\n") || raw.len() + line.len() > MAX_MESSAGE { return Err("POP3-Mail unvollständig oder größer als 8 MB".into()); }
        raw.extend_from_slice(if line.starts_with(b"..") { &line[1..] } else { &line });
    }
}
fn pop_connect(account: &Account, secret: &Secret) -> Result<Pop> {
    if secret.password.chars().any(|c| c == '\r' || c == '\n') { return Err("Passwort enthält ungültige Steuerzeichen".into()); }
    let tcp = tcp(account)?; let connector = tls(account)?;
    let stream: Box<dyn Io> = if account.security == "tls" {
        Box::new(connector.connect(&account.host, tcp).map_err(|_| "POP3-TLS fehlgeschlagen")?)
    } else {
        let mut plain = BufReader::new(Box::new(tcp) as Box<dyn Io>);
        if !pop_line(&mut plain)?.starts_with("+OK") { return Err("Keine POP3-Begrüßung".into()); }
        pop_command(&mut plain, "STLS")?;
        // Preserve the concrete socket by creating TLS over the buffered stream (which implements Read/Write).
        let tls = connector.connect(&account.host, plain.into_inner()).map_err(|_| "POP3-STARTTLS fehlgeschlagen")?;
        let mut connection = BufReader::new(Box::new(tls) as Box<dyn Io>);
        pop_command(&mut connection, &format!("USER {}", account.username))?;
        pop_command(&mut connection, &format!("PASS {}", secret.password))?;
        return Ok(connection);
    };
    let mut connection = BufReader::new(stream);
    if !pop_line(&mut connection)?.starts_with("+OK") { return Err("Keine POP3-Begrüßung".into()); }
    pop_command(&mut connection, &format!("USER {}", account.username))?;
    pop_command(&mut connection, &format!("PASS {}", secret.password))?; Ok(connection)
}
fn fetch_pop(account: &Account, secret: &Secret, known: &HashSet<String>) -> Result<Vec<Message>> {
    let mut connection = pop_connect(account, secret)?;
    pop_command(&mut connection, "UIDL")?;
    let mut ids = Vec::new();
    loop {
        let line = pop_line(&mut connection)?; if line == ".\r\n" { break; }
        if ids.len() >= 50_000 { return Err("POP3-Postfach enthält zu viele Nachrichten".into()); }
        let mut parts = line.split_whitespace();
        if let (Some(number), Some(uid)) = (parts.next().and_then(|p| p.parse::<u32>().ok()), parts.next()) { ids.push((number, format!("pop3:{uid}"))); }
    }
    let mut messages = Vec::new();
    // POP3 has no date search. Inspect the newest 500 IDs, fetch at most fifty unseen messages per run.
    for (number, key) in ids.into_iter().rev().take(500).filter(|(_, key)| !known.contains(key)).take(50) {
        let size = pop_command(&mut connection, &format!("LIST {number}"))?;
        if size.split_whitespace().nth(2).and_then(|n| n.parse::<usize>().ok()).is_none_or(|n| n > MAX_MESSAGE) { messages.push(Message::skipped(key, "Eine POP3-Nachricht überschreitet 8 MB oder meldet keine Größe und wurde nicht ausgewertet.")); continue; }
        pop_command(&mut connection, &format!("RETR {number}"))?;
        let raw = pop_body(&mut connection)?;
        let message = parse(key.clone(), &raw).unwrap_or_else(|reason| Message::skipped(key, &reason));
        // Keep the identity of older messages too, without extracting their content.
        messages.push(if message.sent_at < super::now() - account.days as i64 * 86400 { Message { text:String::new(),html:String::new(),calendars:vec![],..message } } else { message });
    }
    let _ = pop_command(&mut connection, "QUIT"); Ok(messages)
}

#[cfg(test)]
mod tests {
    #[test] fn bridge_certificate_exception_cannot_connect_to_remote_addresses() {
        for ip in ["127.0.0.1", "::1"] { assert!(super::allowed_address("bridge", ip.parse().unwrap())); }
        for ip in ["192.0.2.1", "10.0.0.1", "2001:db8::1"] { assert!(!super::allowed_address("bridge", ip.parse().unwrap())); assert!(super::allowed_address("tls", ip.parse().unwrap())); }
    }
    #[test] fn pop_preserves_legacy_charsets_and_unstuffs_dots() {
        let mut connection = std::io::BufReader::new(Box::new(std::io::Cursor::new(b"Content-Type: text/plain; charset=iso-8859-1\r\n\r\nGr\xfc\xdfe\r\n..original\r\n.\r\n".to_vec())) as Box<dyn super::Io>);
        let raw = super::pop_body(&mut connection).unwrap();
        let message = super::parse("uid".into(), &raw).unwrap();
        assert!(message.text.contains("Grüße")); assert!(message.text.contains(".original"));
    }
    #[test] fn reads_mime_calendar_and_decodes_subject_without_rendering_html() {
        let raw = b"From: Notice <mail@example.org>\r\nSubject: =?UTF-8?B?TGlmZXJ1bmcgw7xiZXJtb3JnZW4=?=\r\nDate: Fri, 30 Oct 2026 12:00:00 +0100\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nLieferung am 31.10.2026\r\n--x\r\nContent-Type: text/calendar; charset=utf-8\r\nContent-Disposition: attachment; filename=event.ics\r\n\r\nBEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n--x--\r\n";
        let message = super::parse("test".into(), raw).unwrap();
        assert!(message.subject.contains("übermorgen")); assert!(message.text.contains("31.10.2026")); assert_eq!(message.calendars.len(), 1);
    }
}
