import { createAdminClient } from "@/lib/supabase/admin";
import { PopupManager } from "@/components/admin/PopupManager";

export const metadata = { title: "Popups — Administration", robots: { index: false, follow: false } };

export default async function AdminPopupsPage() {
  let popups: { id: string; title: string; type: string; is_active: boolean; priority: number }[] = [];
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("popups")
      .select("id, title, type, is_active, priority")
      .order("priority", { ascending: false })
      .limit(200);
    popups = (data ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      type: p.type,
      is_active: p.is_active,
      priority: p.priority,
    }));
  } catch {
    // Table non encore créée -> état vide (voir note sur la migration 0002).
  }

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl font-bold text-gray-900">12 — Gestion des popups</h1>
      <p className="mt-1 text-sm text-gray-500">
        Créez, activez et priorisez les popups du site (bannières, modales, annonces).
      </p>
      <div className="mt-6">
        <PopupManager popups={popups} />
      </div>
    </div>
  );
}
