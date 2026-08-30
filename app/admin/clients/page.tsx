import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPage } from "@/components/admin/AdminPage";
import { AdminTable, AdminRow, AdminCell } from "@/components/admin/AdminTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusPill } from "@/components/ui/StatusPill";

export const metadata = { title: "Clients — Administration", robots: { index: false, follow: false } };

export default async function AdminClientsPage() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, username, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const clients = data ?? [];

  return (
    <AdminPage icon="●" title="03 — Gestion des clients" subtitle="Comptes clients de la plateforme.">
      {clients.length === 0 ? (
        <EmptyState
          icon={<span aria-hidden className="text-2xl">👤</span>}
          title="Aucun client pour le moment"
          description="Les comptes créés via l'inscription apparaîtront ici."
        />
      ) : (
        <AdminTable headers={["Identifiant", "Email", "Statut", "Date"]}>
          {clients.map((c) => (
            <AdminRow key={c.id}>
              <AdminCell className="font-medium text-gray-800">{c.username ?? "—"}</AdminCell>
              <AdminCell>{c.email}</AdminCell>
              <AdminCell><StatusPill status={c.status} /></AdminCell>
              <AdminCell>{new Date(c.created_at).toLocaleDateString("fr-FR")}</AdminCell>
            </AdminRow>
          ))}
        </AdminTable>
      )}
    </AdminPage>
  );
}
