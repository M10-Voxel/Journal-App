use serde::Deserialize;
use htmd::element_handler::{Context, Element, Handlers};
use slint::StyledText;

#[derive(Default, Deserialize)]
#[serde(default)]
struct Mail { html: String, text: String, notes: String }

fn decode(source: &str) -> Option<Mail> {
    serde_json::from_str(source.strip_prefix("journal-mail:v1\n")?).ok()
}

pub fn excerpt_source(source: &str) -> std::borrow::Cow<'_, str> {
    match decode(source) {
        Some(mail) => mail.text.into(),
        None => source.into(),
    }
}

pub fn body(source: &str) -> StyledText {
    let Some(mail) = decode(source) else { return StyledText::from_plain_text(source) };
    if !mail.html.trim().is_empty() {
        let converter = htmd::HtmlToMarkdown::builder()
            .add_handler(vec!["h1", "h2", "h3", "h4", "h5", "h6"], |handlers: &dyn Handlers, el: &Element| {
                let text = handlers.walk_children_content(el.node, Context::INLINE);
                Some(format!("\n\n**{}**\n\n", text.trim()).into())
            })
            .add_handler(vec!["table", "thead", "tbody", "tfoot", "tr", "td", "th", "blockquote"], |handlers: &dyn Handlers, el: &Element| {
                let text = handlers.walk_children_content(el.node, Context::BLOCK);
                Some(format!("\n\n{}\n\n", text.trim()).into())
            })
            .skip_tags(vec!["head", "style", "script", "img", "iframe", "object"]).build();
        if let Ok(mut markdown) = converter.convert(mail.html.as_str()) {
            if !markdown.trim().is_empty() {
                if !mail.notes.is_empty() { markdown.push_str("\n\n"); markdown.push_str(&mail.notes); }
                if let Ok(styled) = StyledText::from_markdown(&markdown) { return styled; }
            }
        }
    }
    StyledText::from_plain_text(&[mail.text, mail.notes].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mail_uses_formatted_html_and_a_readable_search_excerpt() {
        let source = "journal-mail:v1\n{\"html\":\"<html><head><style>b{}</style></head><body><b>Hallo</b></body></html>\",\"text\":\"Klartext\"}";
        assert_eq!(excerpt_source(source), "Klartext");
        assert_eq!(body(source), StyledText::from_markdown("**Hallo**").unwrap());
    }
}
