import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPage } from "@/components/admin/AdminPage";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";

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
    <AdminPage icon="◉" title="08 — Gestion des notifications" subtitle="Notifications internes de la plateforme.">
      {list.length === 0 ? (
        <EmptyState
          icon={<span aria-hidden className="text-2xl">🔔</span>}
          title="Aucune notification"
          description="Les notifications générées apparaîtront ici."
        />
      ) : (
        <div className="space-y-3">
          {list.map((n) => (
            <div key={n.id} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-soft transition-all hover:border-mora-blue-40/30 hover:shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-mora-blue-10 text-mora-blue ring-1 ring-mora-blue-20">
                      {n.type === "order" ? "⃞" : n.type === "commission" ? "✚" : "◉"}
                    </span>
                    <p className="truncate font-semibold text-gray-900">{n.title}</p>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">{n.content}</p>
                </div>
                <Badge tone={n.read_at ? "neutral" : "info"}>{n.read_at ? "Lue" : "Non lue"}</Badge>
              </div>
              <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                <Badge tone="neutral">{n.type}</Badge>
                <span className="inline-flex items-center gap-1">
                  <span aria-hidden>🗓</span>
                  {new Date(n.created_at).toLocaleString("fr-FR")}
                </span>
              </p>
            </div>
          ))}
        </div>
      )}
    </AdminPage>
  );
}
