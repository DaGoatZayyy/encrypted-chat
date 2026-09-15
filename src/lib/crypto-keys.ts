import { bytesToBase64, derivePasswordKey, randomBytes } from './crypto';

const PRIVATE_KEY_STORAGE = 'encrypted-chat:identity-private-key';
const DB_NAME = 'encrypted-chat-keystore';
const DB_VERSION = 1;
const STORE_NAME = 'identity';
const IDENTITY_ID = 'current';

type JwkPair = { privateKey: JsonWebKey; publicKey: JsonWebKey };
type StoredIdentity = { id: string; privateKey: CryptoKey; publicJwk: JsonWebKey };

function openKeyStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB is unavailable on this device.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open secure key storage.'));
  });
}

async function readStoredIdentity(): Promise<StoredIdentity | null> {
  const db = await openKeyStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(IDENTITY_ID);
    request.onsuccess = () => resolve((request.result as StoredIdentity | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Could not read secure key storage.'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error ?? new Error('Could not read secure key storage.'));
  });
}

async function writeStoredIdentity(privateKey: CryptoKey, publicJwk: JsonWebKey) {
  const db = await openKeyStore();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id: IDENTITY_ID, privateKey, publicJwk } satisfies StoredIdentity);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Could not save secure key storage.')); };
  });
}

async function migrateLegacyIdentity(): Promise<{ privateKey: CryptoKey; publicJwk: JsonWebKey } | null> {
  const existing = localStorage.getItem(PRIVATE_KEY_STORAGE);
  if (!existing) return null;
  try {
    const pair = JSON.parse(existing) as JwkPair;
    if (!pair.privateKey || !pair.publicKey) throw new Error('Invalid legacy identity key.');
    const privateKey = await crypto.subtle.importKey('jwk', pair.privateKey, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
    const publicJwk = pair.publicKey;
    await writeStoredIdentity(privateKey, publicJwk);
    localStorage.removeItem(PRIVATE_KEY_STORAGE);
    return { privateKey, publicJwk };
  } catch {
    throw new Error('Your old identity key could not be migrated. Keep this browser profile intact and try again.');
  }
}

export async function getOrCreateIdentity() {
  const stored = await readStoredIdentity();
  if (stored) {
    const publicKey = await crypto.subtle.importKey('jwk', stored.publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return { privateKey: stored.privateKey, publicKey, publicJwk: stored.publicJwk };
  }

  const migrated = await migrateLegacyIdentity();
  if (migrated) {
    const publicKey = await crypto.subtle.importKey('jwk', migrated.publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return { privateKey: migrated.privateKey, publicKey, publicJwk: migrated.publicJwk };
  }

  // Generate exportable keys only long enough to persist the public JWK. The
  // private JWK is immediately re-imported as non-extractable before storage.
  const generated = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const privateJwk = await crypto.subtle.exportKey('jwk', generated.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', generated.publicKey);
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  const publicKey = await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  await writeStoredIdentity(privateKey, publicJwk);
  return { privateKey, publicKey, publicJwk };
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

export async function clearIdentityKey() {
  localStorage.removeItem(PRIVATE_KEY_STORAGE);
  const db = await openKeyStore();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(IDENTITY_ID);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Could not clear secure key storage.')); };
  });
}

export { derivePasswordKey, randomBytes };
