// Settings for cloud sync.
// Both values come from your Supabase project and are SAFE to publish:
// the database only lets each signed-in user see their own data (Row Level Security).
//
// NEVER put the "secret" or "service_role" key here; that one bypasses all protection.
// Leave both empty to turn sync off; the app then works on this device only.

window.DASHBOARD_CONFIG = {
  supabaseUrl: '',   // e.g. 'https://abcdefghijklmnop.supabase.co'
  supabaseKey: ''    // the "publishable" key, starts with 'sb_publishable_' (or the older "anon" key)
};
