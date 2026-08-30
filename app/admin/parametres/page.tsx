import { createAdminClient } from "@/lib/supabase/admin";
import { ParametresManager } from "@/components/admin/ParametresManager";
import { AdminPage } from "@/components/admin/AdminPage";

export const metadata = { title: "Paramètres — Administration", robots: { index: false, follow: false } };

const KEYS = ["site_name", "site_slogan", "site_url", "site_email", "site_phone", "site_whatsapp", "site_address"];

export default async function AdminParametresPage() {
  const supabase = createAdminClient();
  const { data } = await supabase.from("settings").select("id, value").eq("is_public", true).limit(100);
  const initial: Record<string, string> = {};
  for (const row of data ?? []) {
    if (KEYS.includes(row.id)) {
      initial[row.id] = typeof row.value === "string" ? row.value : row.value == null ? "" : JSON.stringify(row.value);
    }
  }

  return (
    <AdminPage
      icon="⚙"
      title="10 — Paramètres"
      subtitle="Paramètres globaux du site, sauvegarde et restauration. Aucun secret n'est stocké ici."
    >
      <ParametresManager initial={initial} />
    </AdminPage>
  );
}
