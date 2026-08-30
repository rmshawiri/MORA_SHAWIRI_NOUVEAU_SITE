import { createAdminClient } from "@/lib/supabase/admin";
import { CommissionActions } from "@/components/admin/CommissionActions";
import { AdminPage } from "@/components/admin/AdminPage";
import { AdminTable, AdminRow, AdminCell } from "@/components/admin/AdminTable";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusPill } from "@/components/ui/StatusPill";

export const metadata = { title: "Commissions — Administration", robots: { index: false, follow: false } };

export default async function AdminCommissionsPage() {
  const supabase = createAdminClient();
  const { data: commissions } = await supabase
    .from("commissions")
    .select("id, amount, base_amount, rate_applied, status, created_at, affiliates(code), orders(order_number)")
    .order("created_at", { ascending: false })
    .limit(100);

  const list = commissions ?? [];
  const totalValidated = list
    .filter((c) => ["validated", "payable", "paid"].includes(c.status))
    .reduce((s, c) => s + Number(c.amount || 0), 0);

  return (
    <AdminPage
      icon="✚"
      title="05 — Gestion des commissions"
      subtitle="Commissions d'affiliation et statuts."
      actions={<Badge tone="green">Validées : {totalValidated.toLocaleString("fr-FR")} KMF</Badge>}
    >
      {list.length === 0 ? (
        <EmptyState
          icon={<span aria-hidden className="text-2xl">💸</span>}
          title="Aucune commission pour le moment"
          description="Les commissions générées par les commandes attribuées apparaîtront ici."
        />
      ) : (
        <AdminTable headers={["Affilié", "Commande", "Base", "Taux", "Montant", "Statut", "Actions"]}>
          {list.map((c) => (
            <AdminRow key={c.id}>
              <AdminCell className="font-mono text-xs font-medium text-mora-blue">
                {(Array.isArray(c.affiliates) ? c.affiliates[0] : c.affiliates)?.code ?? "—"}
              </AdminCell>
              <AdminCell className="font-mono text-xs text-gray-600">
                {(Array.isArray(c.orders) ? c.orders[0] : c.orders)?.order_number ?? "—"}
              </AdminCell>
              <AdminCell>{(c.base_amount ?? 0).toLocaleString("fr-FR")} KMF</AdminCell>
              <AdminCell>{Math.round(Number(c.rate_applied || 0) * 100)} %</AdminCell>
              <AdminCell className="font-semibold text-gray-800">{(c.amount ?? 0).toLocaleString("fr-FR")} KMF</AdminCell>
              <AdminCell><StatusPill status={c.status} /></AdminCell>
              <AdminCell><CommissionActions id={c.id} status={c.status} /></AdminCell>
            </AdminRow>
          ))}
        </AdminTable>
      )}
    </AdminPage>
  );
}
