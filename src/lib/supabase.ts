import { createClient } from '@supabase/supabase-js';

export function makeSupabase(getIdToken: () => Promise<string | undefined>) {
  return createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    {
      accessToken: async () => {
        const token = await getIdToken();
        if (!token) throw new Error('Missing Auth0 ID token');
        return token;
      },
    },
  );
}
