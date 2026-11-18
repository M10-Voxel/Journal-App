//! J-TerminaL starts with Windows, in the background (`--background`), like the Journal app's widgets: a value under
//! `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. Written on every start, so a moved program is found again.

pub const BACKGROUND: &str = "--background";
#[cfg(windows)]
const VALUE: &str = "J-TerminaL";

/// The command Windows runs at sign-in.
pub fn command(exe: &std::path::Path) -> String { format!("\"{}\" {BACKGROUND}", exe.display()) }

#[cfg(windows)]
pub fn register() -> Result<(), String> {
    use winreg::{enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE}, RegKey};
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags("Software\\Microsoft\\Windows\\CurrentVersion\\Run", KEY_SET_VALUE | KEY_QUERY_VALUE)
        .map_err(|e| e.to_string())?;
    let wanted = command(&std::env::current_exe().map_err(|e| e.to_string())?);
    if key.get_value::<String, _>(VALUE).ok().as_deref() == Some(wanted.as_str()) { return Ok(()); }
    key.set_value(VALUE, &wanted).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn register() -> Result<(), String> { Ok(()) }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_quoted_and_in_the_background() {
        let exe = std::path::Path::new(r"C:\Program Files\J-TerminaL\j-terminal.exe");
        assert_eq!(command(exe), r#""C:\Program Files\J-TerminaL\j-terminal.exe" --background"#);
    }
}
