import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusPill } from "@/components/ui/StatusPill";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Mon espace client", robots: { index: false, follow: false } };

export default async function EspaceClientPage() {
  const user = await getUser();
  if (!user) redirect("/connexion?next=/espace-client");

  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_number, total, currency, status, payment_status, created_at")
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const ordersList = orders ?? [];
  const pendingCount = ordersList.filter((o) => ["pending", "processing"].includes(o.status)).length;
  const completedCount = ordersList.filter((o) => o.status === "completed").length;

  return (
    <div className="bg-surface">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        {/* En-tête */}
        <div className="surface-card flex flex-col items-start justify-between gap-4 rounded-3xl p-6 sm:flex-row sm:items-center sm:p-8">
          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full bg-mora-gradient text-lg font-bold text-white sm:flex"
            >
              {(user.email?.[0] ?? "M").toUpperCase()}
            </span>
            <div>
              <Badge tone="blue">Espace client</Badge>
              <h1 className="mt-3 font-display text-3xl font-bold text-gray-900">Bonjour 👋</h1>
              <p className="mt-1 text-gray-600">{user.email}</p>
            </div>
          </div>
          <form action={signOut} className="shrink-0">
            <Button type="submit" variant="secondary" size="sm">Se déconnecter</Button>
          </form>
        </div>

        {/* Vue d'ensemble */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <StatCard label="Commandes" value={ordersList.length.toString()} note="au total" tone="blue" icon="🧾" />
          <StatCard label="En cours" value={pendingCount.toString()} note="à suivre" tone="warning" icon="⏳" />
          <StatCard label="Terminées" value={completedCount.toString()} note="réalisées" tone="success" icon="✅" />
        </div>

        <section className="mt-8" aria-labelledby="mes-commandes">
          <div className="flex items-center gap-3">
            <h2 id="mes-commandes" className="font-display text-xl font-bold text-mora-blue">Mes commandes</h2>
            <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-mora-blue-20 to-transparent" />
          </div>

          {ordersList.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                icon={<span aria-hidden className="text-2xl">🧾</span>}
                title="Aucune commande pour le moment"
                description="Découvrez nos services et notre boutique dès maintenant : vos commandes apparaîtront ici dès le premier achat."
                action={
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button href="/services" variant="blue" size="md">Découvrir nos services</Button>
                    <Button href="/boutique" variant="primary" size="md">Voir la boutique</Button>
                  </div>
                }
              />
            </div>
          ) : (
            <div className="surface-card mt-5 overflow-hidden rounded-2xl">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-5 py-3.5">Référence</th>
                      <th className="px-5 py-3.5">Date</th>
                      <th className="px-5 py-3.5">Total</th>
                      <th className="px-5 py-3.5">Statut</th>
                      <th className="px-5 py-3.5">Paiement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordersList.map((o) => (
                      <tr
                        key={o.id}
                        className="border-b border-gray-50 transition-colors last:border-0 hover:bg-mora-blue-10/60"
                      >
                        <td className="px-5 py-3.5 font-mono text-xs font-medium text-mora-blue">{o.order_number}</td>
                        <td className="px-5 py-3.5 whitespace-nowrap text-gray-600">{new Date(o.created_at).toLocaleDateString("fr-FR")}</td>
                        <td className="px-5 py-3.5 font-semibold text-gray-800 tabular-nums">
                          {(o.total ?? 0).toLocaleString("fr-FR")} {o.currency}
                        </td>
                        <td className="px-5 py-3.5"><StatusPill status={o.status} /></td>
                        <td className="px-5 py-3.5"><StatusPill status={o.payment_status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <p className="mt-8 text-sm text-gray-500">
          Besoin d&apos;aide ?{" "}
          <Link href="/contact" className="link-accent">Contactez-nous</Link>.
        </p>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
  tone = "blue",
  icon,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "blue" | "warning" | "success";
  icon?: string;
}) {
  const color =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-mora-blue";
  return (
    <div className="surface-card card-lift rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {icon && (
          <span aria-hidden className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg", color)}>
            {icon}
          </span>
        )}
      </div>
      <p className={cn("mt-1 font-display text-3xl font-bold tabular-nums", color)}>{value}</p>
      <p className="mt-1 text-xs text-gray-400">{note}</p>
    </div>
  );
}
