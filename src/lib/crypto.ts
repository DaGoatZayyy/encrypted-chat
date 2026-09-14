const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function createChatKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportKey(key: CryptoKey) {
  return bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

export async function importKey(raw: string) {
  return crypto.subtle.importKey('raw', base64ToBytes(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export async function encryptText(text: string, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text)));
  return `${bytesToBase64(iv)}.${bytesToBase64(ciphertext)}`;
}

export async function decryptText(payload: string, key: CryptoKey) {
  const [iv, ciphertext] = payload.split('.');
  if (!iv || !ciphertext) throw new Error('Invalid encrypted message');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext),
  );
  return decoder.decode(plaintext);
}

export async function derivePasswordKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function randomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export { bytesToBase64 };
