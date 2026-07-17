// ==========================================
// CONFIGURATION SUPABASE
// ==========================================
// ⚠️ REMPLACEZ SUPABASE_ANON_KEY ci-dessous par votre clé "anon public"
// (Supabase → Settings → API → Project API keys → anon public)
// Cette clé est publique par design, elle peut être visible dans le code
// tant que les policies RLS sont bien en place côté base.

const SUPABASE_URL = "https://ypdbkivwtogzbujvoseq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwZGJraXZ3dG9nemJ1anZvc2VxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNzIxNjQsImV4cCI6MjA5OTg0ODE2NH0.l_Ui2szsqvsUT39uI9JUPLpzeGTYirthuBekSJb9bE0";

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
