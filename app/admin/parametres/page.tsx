import { createAdminClient } from "@/lib/supabase/admin";
import { ParametresManager } from "@/components/admin/ParametresManager";

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
    <div className="p-6">
      <h1 className="font-display text-2xl font-bold text-gray-900">10 — Paramètres</h1>
      <p className="mt-1 text-sm text-gray-500">
        Paramètres globaux du site, sauvegarde et restauration. Aucun secret n&apos;est stocké ici.
      </p>
      <div className="mt-6">
        <ParametresManager initial={initial} />
      </div>
    </div>
  );
}
