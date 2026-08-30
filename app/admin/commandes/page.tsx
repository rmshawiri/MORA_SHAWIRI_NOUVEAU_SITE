import { createAdminClient } from "@/lib/supabase/admin";

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
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-gray-900">02 — Gestion des commandes</h1>
          <p className="mt-1 text-sm text-gray-500">Commandes et statuts de paiement.</p>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="font-semibold text-gray-800">Aucune commande pour le moment</p>
          <p className="mt-2 text-sm text-gray-500">
            Les commandes passées sur la boutique apparaîtront ici.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Référence</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Paiement</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} className="border-b border-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-mora-blue">{o.order_number}</td>
                  <td className="px-4 py-3 text-gray-800">{o.customer_name ?? "—"}</td>
                  <td className="px-4 py-3 font-semibold text-gray-800">
                    {(o.total ?? 0).toLocaleString("fr-FR")} {o.currency}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{o.status}</td>
                  <td className="px-4 py-3 text-gray-600">{o.payment_status}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(o.created_at).toLocaleDateString("fr-FR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
