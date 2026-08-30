import { createAdminClient } from "@/lib/supabase/admin";
import { CommissionActions } from "@/components/admin/CommissionActions";

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
    <div className="p-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-gray-900">05 — Gestion des commissions</h1>
          <p className="mt-1 text-sm text-gray-500">Commissions d&apos;affiliation et statuts.</p>
        </div>
        <p className="text-sm text-gray-600">
          Validées : <strong className="text-mora-blue">{totalValidated.toLocaleString("fr-FR")} KMF</strong>
        </p>
      </div>

      {list.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="font-semibold text-gray-800">Aucune commission pour le moment</p>
          <p className="mt-2 text-sm text-gray-500">
            Les commissions générées par les commandes attribuées apparaîtront ici.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Affilié</th>
                <th className="px-4 py-3">Commande</th>
                <th className="px-4 py-3">Base</th>
                <th className="px-4 py-3">Taux</th>
                <th className="px-4 py-3">Montant</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-b border-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-mora-blue">
                    {(Array.isArray(c.affiliates) ? c.affiliates[0] : c.affiliates)?.code ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {(Array.isArray(c.orders) ? c.orders[0] : c.orders)?.order_number ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{(c.base_amount ?? 0).toLocaleString("fr-FR")} KMF</td>
                  <td className="px-4 py-3 text-gray-600">{Math.round(Number(c.rate_applied || 0) * 100)} %</td>
                  <td className="px-4 py-3 font-semibold text-gray-800">{(c.amount ?? 0).toLocaleString("fr-FR")} KMF</td>
                  <td className="px-4 py-3 text-gray-600">{c.status}</td>
                  <td className="px-4 py-3"><CommissionActions id={c.id} status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
