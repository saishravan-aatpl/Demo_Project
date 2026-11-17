// Settings for cloud sync.
// Both values come from your Supabase project and are SAFE to publish:
// the database only lets each signed-in user see their own data (Row Level Security).
//
// NEVER put the "secret" or "service_role" key here; that one bypasses all protection.
// Leave both empty to turn sync off; the app then works on this device only.

window.DASHBOARD_CONFIG = {
  supabaseUrl: 'https://hecopwbpeasnthncpkah.supabase.co',
  supabaseKey: 'sb_publishable_0uR9ZEEZE7Dt1o_lDBYTbw_hz-zJw5q'   // publishable key (safe to publish)
};
