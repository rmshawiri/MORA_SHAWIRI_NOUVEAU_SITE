import { createAdminClient } from "@/lib/supabase/admin";
import { OrderActions } from "@/components/admin/OrderActions";
import { AdminPage } from "@/components/admin/AdminPage";
import { AdminTable, AdminRow, AdminCell } from "@/components/admin/AdminTable";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusPill } from "@/components/ui/StatusPill";

export const metadata = { title: "Commandes — Administration", robots: { index: false, follow: false } };

export default async function AdminCommandesPage() {
  const supabase = createAdminClient();
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_number, customer_name, total, currency, status, payment_status, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const list = orders ?? [];

  return (
    <AdminPage
      icon="⃞"
      title="02 — Gestion des commandes"
      subtitle="Commandes et statuts de paiement."
      actions={<Badge tone="neutral">{list.length} commande{list.length > 1 ? "s" : ""}</Badge>}
    >
      {list.length === 0 ? (
        <EmptyState
          icon={<span aria-hidden className="text-2xl">🧾</span>}
          title="Aucune commande pour le moment"
          description="Les commandes passées sur la boutique apparaîtront ici."
        />
      ) : (
        <AdminTable headers={["Référence", "Client", "Total", "Statut", "Paiement", "Date", "Actions"]}>
          {list.map((o) => (
            <AdminRow key={o.id}>
              <AdminCell className="font-mono text-xs font-medium text-mora-blue">{o.order_number}</AdminCell>
              <AdminCell className="text-gray-800">{o.customer_name ?? "—"}</AdminCell>
              <AdminCell className="font-semibold text-gray-800 tabular-nums">{(o.total ?? 0).toLocaleString("fr-FR")} {o.currency}</AdminCell>
              <AdminCell><StatusPill status={o.status} /></AdminCell>
              <AdminCell><StatusPill status={o.payment_status} /></AdminCell>
              <AdminCell>{new Date(o.created_at).toLocaleDateString("fr-FR")}</AdminCell>
              <AdminCell><OrderActions id={o.id} status={o.status} /></AdminCell>
            </AdminRow>
          ))}
        </AdminTable>
      )}
    </AdminPage>
  );
}
