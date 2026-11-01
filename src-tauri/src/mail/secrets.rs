//! Secrets never cross the IPC boundary on reads. DPAPI binds the encrypted blob to the Windows user.
#[cfg(windows)]
pub fn protect(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows::Win32::{Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN}, Foundation::{HLOCAL, LocalFree}};
    let input = CRYPT_INTEGER_BLOB { cbData: bytes.len().try_into().map_err(|_| "Zugangsdaten zu groß")?, pbData: bytes.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        let result = if encrypt { CryptProtectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output) }
            else { CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output) };
        result.map_err(|_| "Windows konnte die Zugangsdaten nicht schützen oder entsperren".to_string())?;
        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(result)
    }
}
#[cfg(not(windows))]
pub fn protect(_: &[u8], _: bool) -> Result<Vec<u8>, String> { Err("Der geschützte Zugangsspeicher ist derzeit nur unter Windows verfügbar".into()) }

#[cfg(all(test, windows))]
mod tests {
    #[test] fn secrets_are_encrypted_and_round_trip() {
        let plain = b"test credential, never a real password";
        let encrypted = super::protect(plain, true).unwrap();
        assert!(!encrypted.windows(plain.len()).any(|part| part == plain));
        assert_eq!(super::protect(&encrypted, false).unwrap(), plain);
    }
}
