import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Tableau de bord — Administration", robots: { index: false, follow: false } };

export default async function AdminDashboardPage() {
  const supabase = createAdminClient();

  const [orders, customers, affiliates, commissions] = await Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("affiliates").select("id", { count: "exact", head: true }),
    supabase.from("commissions").select("id", { count: "exact", head: true }),
  ]);

  const stat = (r: { error: unknown; count: number | null }) =>
    r.error ? null : (r.count ?? 0);

  const cards = [
    { label: "Commandes", value: stat(orders), href: "/admin/commandes" },
    { label: "Clients", value: stat(customers), href: "/admin/clients" },
    { label: "Affiliés", value: stat(affiliates), href: "/admin/affilies" },
    { label: "Commissions", value: stat(commissions), href: "/admin/commissions" },
  ];

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl font-bold text-gray-900">Tableau de bord</h1>
      <p className="mt-1 text-sm text-gray-500">Vue d&apos;ensemble de la plateforme MORA Shawiri.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <a
            key={c.label}
            href={c.href}
            className="group rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <p className="text-sm font-medium text-gray-500">{c.label}</p>
            <p className="mt-1 font-display text-3xl font-bold text-mora-blue">
              {c.value === null ? "—" : c.value}
            </p>
            <p className="mt-2 text-xs text-gray-400 group-hover:text-mora-blue">Gérer →</p>
          </a>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-warning-200 bg-warning-soft p-5 text-sm text-gray-700">
        <p className="font-semibold text-warning">À noter</p>
        <p className="mt-1">
          Les statistiques proviennent des données réelles du système. Tant que la plateforme est
          en exploitation, les compteurs reflètent l&apos;activité réelle (états vides tant qu&apos;il
          n&apos;y a pas de données). Les services (catalogue) sont gérés dans le module
          &laquo; Services &raquo;.
        </p>
      </div>
    </div>
  );
}
