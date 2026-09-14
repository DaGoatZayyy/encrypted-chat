# Encrypted Chat

A Vercel-ready React SPA using Auth0 for identity and Supabase for encrypted chat storage.

## Privacy architecture

- Auth0 handles account authentication.
- A random 12-character User ID is generated client-side and stored in `profiles`.
- Message plaintext is encrypted in the browser with AES-256-GCM before it is inserted into Supabase.
- Chat keys are wrapped with browser-generated P-256 ECDH identity keys.
- Supabase RLS checks the Auth0 `sub` claim and restricts chat/message access to members.
- No analytics SDK or advertising SDK is included.
- The database schema deliberately has no plaintext message column.

This is a privacy-oriented application, not a formal cryptographic audit. A production release should be independently reviewed before being described as a security guarantee.

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

## Auth0 setup

Create a **Single Page Application** in Auth0. Add your local and production origins to Allowed Callback URLs, Allowed Logout URLs, and Allowed Web Origins. Use an asymmetric signing algorithm such as RS256.

Create an Auth0 Post Login Action that adds the literal `role` claim `authenticated` to the ID token:

```js
exports.onExecutePostLogin = async (event, api) => {
  api.idToken.setCustomClaim('role', 'authenticated');
};
```

The Supabase project must also have its Auth0 third-party authentication integration enabled for the Auth0 tenant.

## Supabase setup

Run `supabase/migrations/0001_encrypted_chat.sql` against the Supabase project you want to use. Do not put a Supabase secret/service-role key in the Vite app.

The migration enables RLS and uses the Auth0 `sub` claim for authorization.

## Vercel

Import this GitHub repository into Vercel. The build command is `npm run build` and the output directory is `dist`. Add the same four environment variables in Vercel Project Settings.

## Current scope

Implemented foundation:

- Auth0 login/signup entry point
- Two-tab Chat/Profile UI
- Random 12-character mixed-case User IDs
- Add-by-User-ID flow
- Browser-side AES-GCM message encryption/decryption
- ECDH chat-key wrapping
- Supabase schema + RLS
- Hidden-chat mode foundation
- App lock UI foundation
- Vercel SPA configuration

Next production work should include password-protected chat settings, per-chat history deletion/expiry, encrypted attachment upload and a five-minute server-side cleanup job, key rotation/recovery, realtime subscriptions, device-key recovery, and a full security review.
