import { t } from '../i18n.ts';
import { decodeBase64, encodeBase64 } from '../base64.ts';

/** Decode the original device key; formatting changes must not change the vault ID. */
export function parseDeviceKey(text:string):Uint8Array {
  const invalid=()=>new Error(t("Ungültiger Geräteschlüssel. Füge den vollständigen, von Journal erzeugten Schlüssel ein (normalerweise 44 Zeichen). Dieses Feld ist kein Passwort. Verwende den ursprünglichen Schlüssel vom ersten Gerät; erzeuge für bestehende Cloud-Daten keinen neuen."));
  const normalized=text.replace(/[\s\u200B-\u200D\uFEFF]/gu,'').replace(/-/g,'+').replace(/_/g,'/');
  if(!/^[A-Za-z0-9+/]{43}=?$/.test(normalized))throw invalid();
  try {
    const bytes=decodeBase64(normalized);
    // Canonical padding bits prevent accepting a mistyped final character.
    if(bytes.length!==32||encodeBase64(bytes).replace(/=+$/,'')!==normalized.replace(/=+$/,''))throw invalid();
    return bytes;
  }catch{throw invalid();}
}
