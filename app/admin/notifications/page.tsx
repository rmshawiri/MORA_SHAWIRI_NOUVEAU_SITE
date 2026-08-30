import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Notifications — Administration", robots: { index: false, follow: false } };

export default async function AdminNotificationsPage() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, type, title, content, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const list = data ?? [];

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl font-bold text-gray-900">08 — Gestion des notifications</h1>
      <p className="mt-1 text-sm text-gray-500">Notifications internes de la plateforme.</p>

      {list.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="font-semibold text-gray-800">Aucune notification</p>
          <p className="mt-2 text-sm text-gray-500">Les notifications générées apparaîtront ici.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {list.map((n) => (
            <div key={n.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-gray-800">{n.title}</p>
                <span className="text-xs text-gray-400">{new Date(n.created_at).toLocaleString("fr-FR")}</span>
              </div>
              <p className="mt-1 text-sm text-gray-600">{n.content}</p>
              <p className="mt-1 text-xs text-gray-400">Type : {n.type} · {n.read_at ? "Lue" : "Non lue"}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
