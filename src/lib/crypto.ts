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
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, key, base64ToBytes(ciphertext));
  return decoder.decode(plaintext);
}

export async function encryptBytes(bytes: ArrayBuffer, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const combined = new Uint8Array(12 + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, 12);
  return combined;
}

export async function decryptBytes(payload: ArrayBuffer, key: CryptoKey) {
  const bytes = new Uint8Array(payload);
  if (bytes.length < 13) throw new Error('Invalid encrypted file');
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
}

export async function derivePasswordKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  const saltBuffer = new Uint8Array(salt).buffer as ArrayBuffer;
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBuffer, iterations: 310000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function createPasswordVerifier(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derivePasswordKey(password, salt);
  const verifier = await encryptText('encrypted-chat-password-check', key);
  return `${bytesToBase64(salt)}:${verifier}`;
}

export async function verifyPasswordVerifier(password: string, stored: string) {
  try {
    const [saltText, verifier] = stored.split(':');
    if (!saltText || !verifier) return false;
    const key = await derivePasswordKey(password, base64ToBytes(saltText));
    return (await decryptText(verifier, key)) === 'encrypted-chat-password-check';
  } catch {
    return false;
  }
}

export function randomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export { bytesToBase64 };
