import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminTable, AdminRow, AdminCell } from "@/components/admin/AdminTable";
import { StatusPill } from "@/components/ui/StatusPill";

export const metadata = { title: "Tableau de bord — Administration", robots: { index: false, follow: false } };

const kpiIcons: Record<string, string> = {
  Commandes: "⃞",
  Clients: "●",
  Affiliés: "◈",
  Commissions: "✚",
};

const quickLinks = [
  { href: "/admin/services", label: "Services", glyph: "▣" },
  { href: "/admin/produits", label: "Produits", glyph: "▤" },
  { href: "/admin/commandes", label: "Commandes", glyph: "⃞" },
  { href: "/admin/affilies", label: "Affiliés", glyph: "◈" },
  { href: "/admin/commissions", label: "Commissions", glyph: "✚" },
  { href: "/admin/rendez-vous", label: "Rendez-vous", glyph: "◔" },
  { href: "/admin/statistiques", label: "Statistiques", glyph: "▥" },
  { href: "/admin/parametres", label: "Paramètres", glyph: "⚙" },
];

const kpiAccent: Record<string, string> = {
  blue: "flex h-10 w-10 items-center justify-center rounded-xl bg-mora-blue-10 text-mora-blue ring-1 ring-mora-blue-20",
  gold: "flex h-10 w-10 items-center justify-center rounded-xl bg-mora-or-soft text-mora-or-deep ring-1 ring-mora-or-soft",
  green: "flex h-10 w-10 items-center justify-center rounded-xl bg-success-soft text-success ring-1 ring-success-soft",
};

const attentionAccent: Record<string, string> = {
  blue: "flex h-11 w-11 items-center justify-center rounded-xl bg-mora-blue-10 text-mora-blue ring-1 ring-mora-blue-20",
  gold: "flex h-11 w-11 items-center justify-center rounded-xl bg-mora-or-soft text-mora-or-deep ring-1 ring-mora-or-soft",
  green: "flex h-11 w-11 items-center justify-center rounded-xl bg-success-soft text-success ring-1 ring-success-soft",
};

export default async function AdminDashboardPage() {
  const supabase = createAdminClient();

  const [orders, customers, affiliates, commissions, attentionOrders, attentionCommissions, attentionDraft, recentOrders] =
    await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("affiliates").select("id", { count: "exact", head: true }),
      supabase.from("commissions").select("id", { count: "exact", head: true }),
      supabase.from("orders").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"]),
      supabase.from("commissions").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "draft"),
      supabase
        .from("orders")
        .select("id, order_number, customer_name, total, currency, status, payment_status, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const stat = (r: { error: unknown; count: number | null }) => (r.error ? null : (r.count ?? 0));

  const cards = [
    { key: "Commandes", value: stat(orders), href: "/admin/commandes", accent: "blue" },
    { key: "Clients", value: stat(customers), href: "/admin/clients", accent: "blue" },
    { key: "Affiliés", value: stat(affiliates), href: "/admin/affilies", accent: "gold" },
    { key: "Commissions", value: stat(commissions), href: "/admin/commissions", accent: "green" },
  ];

  const attention = [
    { label: "Commandes en attente", count: stat(attentionOrders), href: "/admin/commandes", icon: "⃞", accent: "blue" },
    { label: "Commissions à valider", count: stat(attentionCommissions), href: "/admin/commissions", icon: "✚", accent: "gold" },
    { label: "Produits en brouillon", count: stat(attentionDraft), href: "/admin/produits", icon: "▤", accent: "green" },
  ];
  const flagged = attention.filter((a) => a.count !== null && a.count > 0);
  const recent = (recentOrders.data ?? []).slice(0, 5);

  return (
    <div className="p-5 sm:p-8">
      {/* En-tête */}
      <div className="relative overflow-hidden rounded-3xl bg-mora-gradient p-6 text-white shadow-lift sm:p-8">
        <div aria-hidden className="absolute inset-0 bg-mora-grid opacity-50" />
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-mora-or/15 blur-3xl" />
        <div className="relative">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-mora-or">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-mora-or" />
            Administration
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">Tableau de bord</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-blue-100/90">
            Vue d&apos;ensemble de la plateforme MORA Shawiri. Les compteurs reflètent l&apos;activité
            réelle du système.
          </p>
        </div>
      </div>

      {/* KPI */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            className="group rounded-2xl border border-gray-100 bg-white p-5 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-mora-blue-40/40 hover:shadow-lift"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-500">{c.key}</p>
              <span className={kpiAccent[c.accent]}>{kpiIcons[c.key]}</span>
            </div>
            <p className="mt-3 font-display text-3xl font-bold text-gray-900 tabular-nums">
              {c.value === null ? "—" : c.value.toLocaleString("fr-FR")}
            </p>
            <p className="mt-1 text-xs font-medium text-gray-400 transition-colors group-hover:text-mora-blue">
              Gérer →
            </p>
          </Link>
        ))}
      </div>

      {/* Ce qui demande attention */}
      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-gray-900">Ce qui demande votre attention</h2>
          <span className="text-xs text-gray-400">Données réelles du système</span>
        </div>
        {flagged.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-success-soft bg-success-soft px-5 py-5 text-sm text-gray-700">
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-success ring-1 ring-success-soft">
              ✓
            </span>
            <div>
              <p className="font-semibold text-success">Tout est à jour</p>
              <p className="mt-0.5">Aucune commande en attente, commission à valider ni produit en brouillon.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {flagged.map((a) => (
              <Link
                key={a.label}
                href={a.href}
                className="group flex items-center gap-3.5 rounded-2xl border border-gray-100 bg-white p-4 shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:border-mora-blue-40/40 hover:shadow-lift"
              >
                <span className={attentionAccent[a.accent]}>{a.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-500">{a.label}</p>
                  <p className="font-display text-2xl font-bold text-gray-900 tabular-nums">
                    {a.count?.toLocaleString("fr-FR")}
                  </p>
                </div>
                <span aria-hidden className="text-gray-300 transition-all group-hover:translate-x-0.5 group-hover:text-mora-blue">
                  →
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Dernières commandes */}
      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-gray-900">Dernières commandes</h2>
          <Link href="/admin/commandes" className="link-accent text-sm">
            Tout voir →
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center shadow-soft">
            <p className="font-display text-lg font-bold text-gray-900">Aucune commande</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
              Les commandes passées sur la boutique apparaîtront ici dès la première vente.
            </p>
          </div>
        ) : (
          <AdminTable headers={["Référence", "Client", "Total", "Paiement", "Statut", "Date"]}>
            {recent.map((o) => (
              <AdminRow key={o.id}>
                <AdminCell className="font-mono text-xs font-medium text-mora-blue">{o.order_number}</AdminCell>
                <AdminCell className="text-gray-800">{o.customer_name ?? "—"}</AdminCell>
                <AdminCell className="font-semibold text-gray-800 tabular-nums">
                  {(o.total ?? 0).toLocaleString("fr-FR")} {o.currency}
                </AdminCell>
                <AdminCell><StatusPill status={o.payment_status} /></AdminCell>
                <AdminCell><StatusPill status={o.status} /></AdminCell>
                <AdminCell>{new Date(o.created_at).toLocaleDateString("fr-FR")}</AdminCell>
              </AdminRow>
            ))}
          </AdminTable>
        )}
      </div>

      {/* Accès rapide */}
      <div className="mt-8 rounded-2xl border border-gray-100 bg-white p-6 shadow-soft">
        <h2 className="font-display text-lg font-bold text-gray-900">Accès rapide aux modules</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {quickLinks.map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className="flex items-center gap-2.5 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700 transition-all hover:-translate-y-0.5 hover:bg-mora-blue hover:text-white"
            >
              <span aria-hidden className="text-mora-or">{q.glyph}</span>
              <span className="truncate">{q.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Note de transparence */}
      <div className="mt-8 rounded-2xl border border-warning-soft bg-warning-soft p-5 text-sm text-gray-700">
        <p className="flex items-center gap-2 font-semibold text-warning">
          <span aria-hidden>⚠</span> À noter
        </p>
        <p className="mt-1 leading-relaxed">
          Les statistiques proviennent des données réelles du système. Tant que la plateforme est
          en exploitation, les compteurs reflètent l&apos;activité réelle (états vides tant qu&apos;il
          n&apos;y a pas de données). Les services (catalogue) sont gérés dans le module
          &laquo; Services &raquo;.
        </p>
      </div>
    </div>
  );
}
