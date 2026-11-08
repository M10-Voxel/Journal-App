import { decodeBase64, encodeBase64 } from '../base64.ts';
import type { Json } from './merge';

export async function encryptionKey(bytes: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(data: Json, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return JSON.stringify({ version: 1, iv: encodeBase64(iv), cipher: encodeBase64(new Uint8Array(cipher)) });
}

export async function decrypt(data: string, key: CryptoKey): Promise<Json> {
  const envelope = JSON.parse(data);
  if (envelope.version !== 1 || typeof envelope.iv !== 'string' || typeof envelope.cipher !== 'string') throw new Error('Unbekanntes Cloud-Format.');
  try {
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(envelope.iv) }, key, decodeBase64(envelope.cipher))));
  } catch {
    throw new Error('Cloud-Daten konnten nicht entschlüsselt werden. Geräteschlüssel prüfen.');
  }
}
