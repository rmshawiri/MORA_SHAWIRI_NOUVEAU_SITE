import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPage } from "@/components/admin/AdminPage";

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
    { label: "Commandes", value: orders.count ?? 0, tone: "blue", icon: "⃞" },
    { label: "Chiffre d'affaires (payé)", value: revenue, tone: "gold", kmf: true, icon: "€" },
    { label: "Clients", value: customers.count ?? 0, tone: "blue", icon: "●" },
    { label: "Affiliés", value: affiliates.count ?? 0, tone: "blue", icon: "◈" },
    { label: "Commissions validées", value: commissionTotal, tone: "green", kmf: true, icon: "✚" },
    { label: "Services", value: services.count ?? 0, tone: "blue", icon: "▣" },
    { label: "Produits", value: products.count ?? 0, tone: "blue", icon: "▤" },
    { label: "FAQ", value: faqs.count ?? 0, tone: "blue", icon: "?" },
  ];

  const toneClass = (tone: string) =>
    tone === "gold" ? "text-mora-or-deep" : tone === "green" ? "text-success" : "text-mora-blue";

  const toneTile = (tone: string) =>
    tone === "gold"
      ? "bg-mora-or-soft text-mora-or-deep ring-mora-or-soft"
      : tone === "green"
        ? "bg-success-soft text-success ring-success-soft"
        : "bg-mora-blue-10 text-mora-blue ring-mora-blue-20";

  return (
    <AdminPage icon="▥" title="09 — Statistiques" subtitle="Indicateurs calculés à partir des données réelles du système.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-soft transition-all hover:border-mora-blue-40/30 hover:shadow-card">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-gray-500">{c.label}</p>
              <span
                aria-hidden
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${toneTile(c.tone)}`}
              >
                {c.icon}
              </span>
            </div>
            <p className={`mt-3 font-display text-3xl font-bold tabular-nums ${toneClass(c.tone)}`}>
              {c.value.toLocaleString("fr-FR")}{c.kmf ? " KMF" : ""}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-warning-soft bg-warning-soft p-5 text-sm text-gray-700">
        <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-warning ring-1 ring-warning-soft">
          i
        </span>
        <div>
          <p className="font-semibold text-warning">Source des données</p>
          <p className="mt-1 leading-relaxed">
            Tous les indicateurs proviennent de la base (aucune donnée inventée). Le chiffre d&apos;affaires
            ne compte que les commandes au statut payé/terminé ; les commissions validées/payables/payées.
            Tant qu&apos;il n&apos;y a pas d&apos;activité, les valeurs restent à 0 (état réel, pas de faux chiffres).
          </p>
        </div>
      </div>
    </AdminPage>
  );
}
