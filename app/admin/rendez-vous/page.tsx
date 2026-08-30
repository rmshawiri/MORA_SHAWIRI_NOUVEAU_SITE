import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPage } from "@/components/admin/AdminPage";
import { AdminTable, AdminRow, AdminCell } from "@/components/admin/AdminTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusPill } from "@/components/ui/StatusPill";

export const metadata = { title: "Rendez-vous — Administration", robots: { index: false, follow: false } };

export default async function AdminRdvPage() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("appointments")
    .select("id, starts_at, ends_at, status, notes, services(name)")
    .order("starts_at", { ascending: false })
    .limit(200);

  const list = data ?? [];

  return (
    <AdminPage icon="◔" title="06 — Gestion des rendez-vous" subtitle="Réservations et statuts.">
      {list.length === 0 ? (
        <EmptyState
          icon={<span aria-hidden className="text-2xl">🗓️</span>}
          title="Aucun rendez-vous"
          description="Les prises de rendez-vous apparaîtront ici."
        />
      ) : (
        <AdminTable headers={["Date", "Service", "Statut"]}>
          {list.map((a) => (
            <AdminRow key={a.id}>
              <AdminCell>{new Date(a.starts_at).toLocaleString("fr-FR")}</AdminCell>
              <AdminCell className="text-gray-800">
                {(Array.isArray(a.services) ? a.services[0] : a.services)?.name ?? "—"}
              </AdminCell>
              <AdminCell><StatusPill status={a.status} /></AdminCell>
            </AdminRow>
          ))}
        </AdminTable>
      )}
    </AdminPage>
  );
}
