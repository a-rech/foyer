// ==========================================
// CONFIGURATION SUPABASE
// ==========================================
// ⚠️ REMPLACEZ SUPABASE_ANON_KEY ci-dessous par votre clé "anon public"
// (Supabase → Settings → API → Project API keys → anon public)
// Cette clé est publique par design, elle peut être visible dans le code
// tant que les policies RLS sont bien en place côté base.

const SUPABASE_URL = "https://ypdbkivwtogzbujvoseq.supabase.co";
const SUPABASE_ANON_KEY = "COLLEZ_VOTRE_CLE_ANON_ICI";

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
