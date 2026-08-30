import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPage } from "@/components/admin/AdminPage";
import { AdminTable, AdminRow, AdminCell } from "@/components/admin/AdminTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusPill } from "@/components/ui/StatusPill";

export const metadata = { title: "Affiliés — Administration", robots: { index: false, follow: false } };

const catLabel: Record<string, string> = {
  particulier: "Particulier",
  influenceur: "Influenceur",
  equipe: "Équipe MORA Shawiri",
};

export default async function AdminAffiliesPage() {
  const supabase = createAdminClient();
  const { data: affiliates } = await supabase
    .from("affiliates")
    .select("id, category, code, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const list = affiliates ?? [];

  return (
    <AdminPage icon="◈" title="04 — Gestion des affiliés" subtitle="Comptes affiliés, catégories et statuts.">
      {list.length === 0 ? (
        <EmptyState
          icon={<span aria-hidden className="text-2xl">🤝</span>}
          title="Aucun affilié pour le moment"
          description="Les personnes rejoignant le programme d'affiliation apparaîtront ici."
        />
      ) : (
        <AdminTable headers={["Code", "Catégorie", "Statut", "Date"]}>
          {list.map((a) => (
            <AdminRow key={a.id}>
              <AdminCell className="font-mono text-xs font-medium text-mora-blue">{a.code}</AdminCell>
              <AdminCell>{catLabel[a.category] ?? a.category}</AdminCell>
              <AdminCell><StatusPill status={a.status} /></AdminCell>
              <AdminCell>{new Date(a.created_at).toLocaleDateString("fr-FR")}</AdminCell>
            </AdminRow>
          ))}
        </AdminTable>
      )}
    </AdminPage>
  );
}
