import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Statistiques — Administration", robots: { index: false, follow: false } };

export default async function AdminStatistiquesPage() {
  const supabase = createAdminClient();

  const [orders, customers, affiliates, commissions, services, products, faqs] = await Promise.all([
    supabase.from("orders").select("total, status", { count: "exact" }),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("affiliates").select("id", { count: "exact", head: true }),
    supabase.from("commissions").select("amount, status", { count: "exact" }),
    supabase.from("services").select("id", { count: "exact", head: true }),
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase.from("faqs").select("id", { count: "exact", head: true }),
  ]);

  const paidOrders = (orders.data ?? []).filter((o) => ["paid", "completed"].includes(o.status));
  const revenue = paidOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const validCommissions = (commissions.data ?? []).filter((c) => ["validated", "payable", "paid"].includes(c.status));
  const commissionTotal = validCommissions.reduce((s, c) => s + Number(c.amount || 0), 0);

  const cards = [
    { label: "Commandes", value: orders.count ?? 0 },
    { label: "Chiffre d'affaires (payé)", value: revenue },
    { label: "Clients", value: customers.count ?? 0 },
    { label: "Affiliés", value: affiliates.count ?? 0 },
    { label: "Commissions validées", value: commissionTotal },
    { label: "Services", value: services.count ?? 0 },
    { label: "Produits", value: products.count ?? 0 },
    { label: "FAQ", value: faqs.count ?? 0 },
  ];

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl font-bold text-gray-900">09 — Statistiques</h1>
      <p className="mt-1 text-sm text-gray-500">Indicateurs calculés à partir des données réelles du système.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-gray-500">{c.label}</p>
            <p className="mt-1 font-display text-3xl font-bold text-mora-blue">{c.value.toLocaleString("fr-FR")}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-warning-200 bg-warning-soft p-5 text-sm text-gray-700">
        <p className="font-semibold text-warning">Source des données</p>
        <p className="mt-1">
          Tous les indicateurs proviennent de la base (aucune donnée inventée). Le chiffre d&apos;affaires
          ne compte que les commandes au statut payé/terminé ; les commissions validées/payables/payées.
          Tant qu&apos;il n&apos;y a pas d&apos;activité, les valeurs restent à 0 (état réel, pas de faux chiffres).
        </p>
      </div>
    </div>
  );
}
