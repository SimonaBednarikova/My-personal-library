// Supabase project connection. The publishable key below is safe to ship to
// the browser — it is not a secret, access is governed by the Row Level
// Security policies on the `books` table (see supabase/schema.sql).
// Never put the database password or the service_role key here.
const SUPABASE_URL = 'https://fpqrdaumniydmzcizkda.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_blwUlNov6STpj9qsvLgUzA_CfUs5CEq';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
