# Encrypted Chat

A Vercel-ready React + TypeScript SPA using Auth0 for identity and Supabase for encrypted chat storage.

## Privacy architecture

- Auth0 handles account authentication.
- A random 12-character User ID is generated client-side.
- Message plaintext is encrypted in the browser with AES-256-GCM before it reaches Supabase.
- Files are encrypted in the browser with AES-GCM before upload; Supabase Storage holds only encrypted blobs.
- Chat keys are wrapped with browser-generated P-256 ECDH identity keys.
- Supabase RLS restricts chat, message, attachment, and storage access to members.
- Local app/chat passwords use PBKDF2-derived verification and never become server-side chat passwords.
- No analytics or advertising SDK is included.

This is privacy-oriented software, not a formal cryptographic audit or security guarantee. The current browser identity private key is stored in localStorage and should be migrated to stronger device-key storage before a high-security release.

## Features

- Auth0 login/signup
- One-to-one encrypted chats
- Encrypted group chats
- AES-GCM encrypted messages
- Encrypted file attachments up to 25 MB
- Hidden chats
- Per-device chat password locks
- Per-device app password lock
- User ID reset without breaking existing memberships
- Supabase RLS + private Storage bucket
- Realtime subscriptions with 1-second polling fallback
- Vercel SPA routing

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set these values in `.env.local`:

- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Never put a Supabase service-role/secret key or Auth0 client secret in Vite environment variables.

## Auth0 setup

Create a **Single Page Application** in Auth0. Add both local and production origins to Allowed Callback URLs, Allowed Logout URLs, and Allowed Web Origins. Use RS256.

Create and apply a Post Login Action:

```js
exports.onExecutePostLogin = async (event, api) => {
  api.idToken.setCustomClaim('role', 'authenticated');
};
```

Enable the Auth0 tenant as a Supabase Third-Party Auth provider.

## Supabase

The repository contains the database migrations under `supabase/migrations/`. The current project has these migrations applied:

- initial encrypted-chat schema
- RLS hardening and optimization
- secure chat creation RPC
- Realtime membership support
- encrypted attachments, private Storage bucket, and group-chat RPC

Keep RLS enabled. Do not replace member policies with public access.

## Vercel deployment

1. Import `DaGoatZayyy/encrypted-chat` into Vercel.
2. Framework: Vite.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Add the four `VITE_*` environment variables for the Production environment.
6. Deploy.
7. Copy the resulting Vercel HTTPS origin into Auth0 Allowed Callback URLs, Allowed Logout URLs, and Allowed Web Origins.
8. Test login, two-user messaging, group creation, file upload/download, hidden chats, app lock, and chat lock in production.

`vercel.json` already contains the SPA rewrite needed for client-side routing.

## Production limitations to review

- Browser ECDH private keys currently live in localStorage; use non-exportable IndexedDB/WebCrypto storage plus a recovery design for a stronger release.
- Local app/chat password locks protect the browser UI but are not a server-enforced password protocol.
- Attachment cleanup/expiry is not automatic yet.
- Password-protected chat metadata in the database is not currently used as a server-enforced chat password.
- Supabase/Auth0 can still see account identity and routing metadata even though message/file bodies are encrypted.
