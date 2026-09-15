import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/utils/supabase/server';

/**
 * Creates an admin / elevated Supabase client for Server Actions.
 * - If SUPABASE_SERVICE_ROLE_KEY is set in environment variables, returns a client
 *   with full service_role privileges, bypassing RLS after backend authorization.
 * - If not set, falls back safely to the standard SSR cookie server client.
 */
export async function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (serviceRoleKey && supabaseUrl) {
    return createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return await createServerClient();
}
