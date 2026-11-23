//! A web page's preview, as Discord shows one: the site, the author, the title, a description, a picture and the
//! site's colour. Read from the page's Open Graph tags; YouTube adds its channel through oEmbed.
use std::time::Duration;

use image::RgbaImage;
use serde_json::Value;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Preview {
    pub title: String,
    pub description: String,
    pub site: String,
    pub author: String,
    /// An absolute http(s) address of the picture.
    pub image: String,
    /// The site's colour as `#rrggbb`, if it names one.
    pub accent: String,
}

const PAGE_LIMIT: u64 = 1_500_000;
const IMAGE_LIMIT: u64 = 8_000_000;

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(12)))
        .max_redirects(4)
        .user_agent("Mozilla/5.0 (compatible; J-TerminaL link preview)")
        .build()
        .into()
}

/// The first `limit` bytes; the preview tags sit at the top of a page, so a long page is cut, not refused.
fn get(url: &str, limit: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut response = agent()
        .get(url)
        .header("Accept-Language", "de,en;q=0.8")
        .call()
        .map_err(|e| e.to_string())?;
    let mut data = Vec::new();
    response.body_mut().with_config().limit(u64::MAX).reader().take(limit).read_to_end(&mut data).map_err(|e| e.to_string())?;
    Ok(data)
}

/// Fetches the page (and for YouTube its oEmbed) and reads its preview. Blocking: call it off the UI thread.
pub fn fetch(address: &str) -> Result<Preview, String> {
    let base = url::Url::parse(address).map_err(|e| e.to_string())?;
    let html = get(address, PAGE_LIMIT)?;
    let mut preview = parse(&String::from_utf8_lossy(&html), &base);
    if is_youtube(&base) {
        let mut oembed = url::Url::parse("https://www.youtube.com/oembed").unwrap();
        oembed.query_pairs_mut().append_pair("url", address).append_pair("format", "json");
        if let Ok(data) = get(oembed.as_str(), 200_000) {
            if let Ok(json) = serde_json::from_slice::<Value>(&data) {
                let field = |k: &str| json[k].as_str().unwrap_or("").trim().to_string();
                if preview.author.is_empty() { preview.author = field("author_name"); }
                if !field("title").is_empty() { preview.title = field("title"); }
                if preview.image.is_empty() { preview.image = field("thumbnail_url"); }
            }
        }
        if preview.site.is_empty() || preview.site == host(&base) { preview.site = "YouTube".into(); }
        if preview.accent.is_empty() { preview.accent = "#ff0000".into(); }
    }
    Ok(preview)
}

fn is_youtube(url: &url::Url) -> bool {
    url.host_str().is_some_and(|h| {
        let h = h.trim_start_matches("www.").trim_start_matches("m.");
        h == "youtube.com" || h == "youtu.be" || h == "music.youtube.com"
    })
}

fn host(url: &url::Url) -> String {
    url.host_str().unwrap_or("").trim_start_matches("www.").to_string()
}

/// Loads the picture and shrinks it to at most `size` pixels on its longer side. Blocking.
pub fn image(address: &str, size: u32) -> Option<RgbaImage> {
    let bytes = get(address, IMAGE_LIMIT).ok()?;
    if bytes.get(4..8) == Some(b"ftyp") {
        return crate::note_images::decode(&crate::notebook::ImageSource::Bytes(bytes.into()), size);
    }
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().ok()?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(96 * 1024 * 1024);
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    reader.limits(limits);
    Some(reader.decode().ok()?.thumbnail(size, size).into_rgba8())
}

/// Reads the preview from the page's head.
pub fn parse(html: &str, base: &url::Url) -> Preview {
    let head = match find_ci(html, "</head") { Some(end) => &html[..end], None => html };
    let mut metas: Vec<(String, String)> = Vec::new();
    let mut title = String::new();
    let mut at = 0;
    while let Some(start) = find_ci(&head[at..], "<").map(|i| at + i) {
        let rest = &head[start + 1..];
        let name_end = rest.find(|c: char| c.is_whitespace() || c == '>' || c == '/').unwrap_or(rest.len());
        let tag = rest[..name_end].to_ascii_lowercase();
        let Some(close) = tag_end(rest) else { break };
        if tag == "meta" {
            let attributes = attributes(&rest[name_end..close]);
            let key = attributes.iter().find(|(k, _)| k == "property" || k == "name" || k == "itemprop").map(|(_, v)| v.to_ascii_lowercase());
            let content = attributes.iter().find(|(k, _)| k == "content").map(|(_, v)| v.clone());
            if let (Some(key), Some(content)) = (key, content) { metas.push((key, decode(&content))); }
        } else if tag == "title" && title.is_empty() {
            let inner = &rest[close + 1..];
            let end = find_ci(inner, "</title").unwrap_or(inner.len());
            title = decode(&inner[..end]);
        }
        at = start + 1 + close + 1;
    }
    let meta = |keys: &[&str]| keys.iter().find_map(|k| metas.iter().find(|(m, v)| m == k && !v.trim().is_empty()).map(|(_, v)| clean(v)));
    let image = meta(&["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"])
        .and_then(|raw| base.join(&raw).ok())
        .filter(|u| matches!(u.scheme(), "http" | "https"))
        .map(|u| u.to_string())
        .unwrap_or_default();
    let accent = meta(&["theme-color"])
        .filter(|c| c.len() == 7 && c.starts_with('#') && c[1..].bytes().all(|b| b.is_ascii_hexdigit()))
        .map(|c| c.to_ascii_lowercase())
        .unwrap_or_default();
    Preview {
        title: limit(meta(&["og:title", "twitter:title"]).unwrap_or_else(|| clean(&title)), 300),
        description: limit(meta(&["og:description", "twitter:description", "description"]).unwrap_or_default(), 1000),
        site: meta(&["og:site_name", "application-name"]).unwrap_or_else(|| host(base)),
        author: meta(&["author", "article:author"]).filter(|a| !a.starts_with("http")).unwrap_or_default(),
        image,
        accent,
    }
}

fn limit(text: String, chars: usize) -> String {
    if text.chars().count() <= chars { text } else { text.chars().take(chars).collect::<String>() + "…" }
}

fn clean(text: &str) -> String { text.split_whitespace().collect::<Vec<_>>().join(" ") }

fn find_ci(haystack: &str, needle: &str) -> Option<usize> {
    let (h, n) = (haystack.as_bytes(), needle.as_bytes());
    (0..=h.len().checked_sub(n.len())?).find(|&i| h[i..i + n.len()].eq_ignore_ascii_case(n))
}

/// Where the tag's `>` is, quotes respected.
fn tag_end(rest: &str) -> Option<usize> {
    let mut quote = None;
    for (i, c) in rest.char_indices() {
        match (quote, c) {
            (None, '"' | '\'') => quote = Some(c),
            (Some(q), c) if c == q => quote = None,
            (None, '>') => return Some(i),
            _ => {}
        }
    }
    None
}

fn attributes(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut chars = text.char_indices().peekable();
    while let Some(&(i, c)) = chars.peek() {
        if c.is_whitespace() || c == '/' { chars.next(); continue; }
        let mut end = i;
        while let Some(&(j, c)) = chars.peek() {
            if c.is_whitespace() || c == '=' || c == '/' { break; }
            end = j + c.len_utf8();
            chars.next();
        }
        let name = text[i..end].to_ascii_lowercase();
        while chars.peek().is_some_and(|&(_, c)| c.is_whitespace()) { chars.next(); }
        let mut value = String::new();
        if chars.peek().is_some_and(|&(_, c)| c == '=') {
            chars.next();
            while chars.peek().is_some_and(|&(_, c)| c.is_whitespace()) { chars.next(); }
            match chars.peek().map(|&(_, c)| c) {
                Some(q @ ('"' | '\'')) => {
                    chars.next();
                    for (_, c) in chars.by_ref() { if c == q { break; } value.push(c); }
                }
                _ => while let Some(&(_, c)) = chars.peek() {
                    if c.is_whitespace() { break; }
                    value.push(c);
                    chars.next();
                },
            }
        }
        if name.is_empty() { chars.next(); } else { out.push((name, value)); }
    }
    out
}

/// HTML character references.
fn decode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        let Some(semi) = rest[..rest.len().min(12)].find(';') else { out.push('&'); rest = &rest[1..]; continue };
        let entity = &rest[1..semi];
        let ch = match entity {
            "amp" => Some('&'), "lt" => Some('<'), "gt" => Some('>'), "quot" => Some('"'),
            "apos" => Some('\''), "nbsp" => Some(' '),
            _ if entity.starts_with("#x") || entity.starts_with("#X") => u32::from_str_radix(&entity[2..], 16).ok().and_then(char::from_u32),
            _ if entity.starts_with('#') => entity[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => { out.push(c); rest = &rest[semi + 1..]; }
            None => { out.push('&'); rest = &rest[1..]; }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_open_graph_with_entities_relative_images_and_the_site_colour() {
        let base = url::Url::parse("https://example.org/a/page").unwrap();
        let html = r##"<!doctype html><html><HEAD><title>Fallback &amp; more</title>
            <meta property="og:title" content="Caf&eacute; &quot;Ost&quot; &#8211; Men&#xFC;">
            <meta content='Beschreibung mit
              Umbruch' name=description>
            <meta property="og:image" content="/img/cover.jpg" />
            <meta name="theme-color" content="#FF0000">
            <meta property="og:site_name" content="Beispiel">
            </head><body><meta property="og:title" content="not this"></body>"##;
        let p = parse(html, &base);
        assert_eq!(p.title, "Caf&eacute; \"Ost\" – Menü");
        assert_eq!(p.description, "Beschreibung mit Umbruch");
        assert_eq!(p.image, "https://example.org/img/cover.jpg");
        assert_eq!(p.accent, "#ff0000");
        assert_eq!(p.site, "Beispiel");
    }

    #[test]
    fn falls_back_to_the_page_title_and_host() {
        let base = url::Url::parse("https://www.example.org/").unwrap();
        let p = parse("<html><head><title>\n  Nur   ein Titel </title><meta property=og:image content=javascript:alert(1)></head>", &base);
        assert_eq!(p.title, "Nur ein Titel");
        assert_eq!(p.site, "example.org");
        assert!(p.image.is_empty(), "Only web addresses are pictures.");
        assert!(p.accent.is_empty());
    }

    #[test]
    fn knows_youtube_addresses() {
        for u in ["https://www.youtube.com/watch?v=x", "https://youtu.be/x", "https://m.youtube.com/watch?v=x"] {
            assert!(is_youtube(&url::Url::parse(u).unwrap()), "{u}");
        }
        assert!(!is_youtube(&url::Url::parse("https://notyoutube.com/").unwrap()));
    }
}

#[cfg(test)]
mod live {
    /// Reaches the internet: `cargo test live_preview -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_preview() {
        for u in ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.rust-lang.org/"] {
            let p = super::fetch(u).unwrap();
            println!("{p:#?}");
            assert!(!p.title.is_empty());
            if !p.image.is_empty() { let i = super::image(&p.image, 480).expect("picture"); println!("{}x{}", i.width(), i.height()); }
        }
    }
}
