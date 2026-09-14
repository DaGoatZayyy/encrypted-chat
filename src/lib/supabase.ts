import { createClient } from '@supabase/supabase-js';
import type { Auth0Client } from '@auth0/auth0-spa-js';

export function makeSupabase(auth0: Auth0Client) {
  return createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    {
      accessToken: async () => {
        const claims = await auth0.getIdTokenClaims();
        if (!claims?.__raw) throw new Error('Missing Auth0 ID token');
        return claims.__raw;
      },
    },
  );
}
