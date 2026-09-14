import { bytesToBase64, derivePasswordKey, randomBytes } from './crypto';

const PRIVATE_KEY_STORAGE = 'encrypted-chat:identity-private-key';

type JwkPair = { privateKey: JsonWebKey; publicKey: JsonWebKey };

export async function getOrCreateIdentity() {
  const existing = localStorage.getItem(PRIVATE_KEY_STORAGE);
  if (existing) {
    const pair = JSON.parse(existing) as JwkPair;
    const privateKey = await crypto.subtle.importKey('jwk', pair.privateKey, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const publicKey = await crypto.subtle.importKey('jwk', pair.publicKey, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
    return { privateKey, publicKey, publicJwk: pair.publicKey };
  }
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const privateJwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  localStorage.setItem(PRIVATE_KEY_STORAGE, JSON.stringify({ privateKey: privateJwk, publicKey: publicJwk }));
  return { privateKey: keys.privateKey, publicKey: keys.publicKey, publicJwk };
}

async function wrappingKey(privateKey: CryptoKey, publicJwk: JsonWebKey) {
  const publicKey = await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function wrapChatKey(chatKeyRaw: string, senderPrivateKey: CryptoKey, recipientPublicJwk: JsonWebKey) {
  const key = await wrappingKey(senderPrivateKey, recipientPublicJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(chatKeyRaw)));
  return `${bytesToBase64(iv)}.${bytesToBase64(encrypted)}`;
}

export async function unwrapChatKey(payload: string, recipientPrivateKey: CryptoKey, senderPublicJwk: JsonWebKey) {
  const key = await wrappingKey(recipientPrivateKey, senderPublicJwk);
  const [ivText, cipherText] = payload.split('.');
  const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(ivText) }, key, fromBase64(cipherText));
  return new TextDecoder().decode(plain);
}

export function clearIdentityKey() {
  localStorage.removeItem(PRIVATE_KEY_STORAGE);
}

export { derivePasswordKey, randomBytes };
