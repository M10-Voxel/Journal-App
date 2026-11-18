//! Only one J-TerminaL runs. A local socket (a named pipe on Windows) is both the lock and the way to reach the running
//! one: a second start sends `show` and ends. Later the Journal app sends the same message for `Strg+Leertaste`.
use std::io::{BufRead, BufReader, Write};
use interprocess::local_socket::{prelude::*, GenericNamespaced, ListenerOptions, Name, Stream};

pub const NAME: &str = "j-terminal.sock";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Message { Show }

impl Message {
    fn parse(line: &str) -> Option<Self> {
        match line.trim() { "show" => Some(Message::Show), _ => None }
    }
}

fn name(name: &str) -> std::io::Result<Name<'_>> { name.to_ns_name::<GenericNamespaced>() }

pub enum Start {
    /// This is the only instance; messages from later starts arrive at the handler.
    First,
    /// Another instance runs and was told to show itself.
    Another,
}

/// Become the one instance, or wake the running one. `on_message` runs on a background thread.
pub fn claim(socket: &str, on_message: impl Fn(Message) + Send + 'static) -> std::io::Result<Start> {
    if let Ok(mut stream) = Stream::connect(name(socket)?) {
        allow_foreground();
        stream.write_all(b"show\n")?;
        return Ok(Start::Another);
    }
    let listener = ListenerOptions::new().name(name(socket)?).create_sync()?;
    std::thread::Builder::new().name("instance".into()).spawn(move || {
        for stream in listener.incoming().filter_map(Result::ok) {
            let mut line = String::new();
            if BufReader::new(stream).read_line(&mut line).is_ok() {
                if let Some(message) = Message::parse(&line) { on_message(message); }
            }
        }
    })?;
    Ok(Start::First)
}

/// The starting process may bring windows to the front; it hands that right on, so the running one may take focus.
fn allow_foreground() {
    #[cfg(windows)]
    unsafe { windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(windows_sys::Win32::UI::WindowsAndMessaging::ASFW_ANY); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, time::Duration};

    #[test]
    fn a_second_start_wakes_the_first() {
        let socket = format!("j-terminal-test-{}.sock", std::process::id());
        let (sender, received) = mpsc::channel();
        assert!(matches!(claim(&socket, move |message| { let _ = sender.send(message); }).unwrap(), Start::First));
        assert!(matches!(claim(&socket, |_| panic!("The second start receives nothing.")).unwrap(), Start::Another));
        assert_eq!(received.recv_timeout(Duration::from_secs(5)).unwrap(), Message::Show);
    }

    #[test]
    fn unknown_messages_are_ignored() {
        assert_eq!(Message::parse("show\n"), Some(Message::Show));
        assert_eq!(Message::parse("quit"), None);
        assert_eq!(Message::parse(""), None);
    }
}
