import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { BecomeAffiliateForm } from "@/components/affiliate/BecomeAffiliateForm";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusPill } from "@/components/ui/StatusPill";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Mon espace affilié", robots: { index: false, follow: false } };

const categoryLabel: Record<string, string> = {
  particulier: "Particulier",
  influenceur: "Influenceur",
  equipe: "Équipe MORA Shawiri",
};

export default async function EspaceAffiliePage() {
  const user = await getUser();
  if (!user) redirect("/connexion?next=/espace-affilie");

  const supabase = await createClient();
  const { data: affiliate } = await supabase
    .from("affiliates")
    .select("id, category, code, status, created_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!affiliate) {
    return (
      <div className="bg-surface">
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Badge tone="blue">Espace affilié</Badge>
              <h1 className="mt-3 font-display text-3xl font-bold text-gray-900">Devenir affilié</h1>
            </div>
            <form action={signOut} className="shrink-0">
              <Button type="submit" variant="secondary" size="sm">Se déconnecter</Button>
            </form>
          </div>
          <div className="mt-8">
            <BecomeAffiliateForm />
          </div>
        </div>
      </div>
    );
  }

  const { data: commissions } = await supabase
    .from("commissions")
    .select("id, amount, rate_applied, status, created_at")
    .eq("affiliate_id", affiliate.id)
    .order("created_at", { ascending: false });

  const list = commissions ?? [];
  const sum = (statuses: string[]) =>
    list.filter((c) => statuses.includes(c.status)).reduce((s, c) => s + Number(c.amount || 0), 0);
  const totalValidated = sum(["validated", "payable", "paid"]);
  const totalPending = sum(["pending"]);
  const totalPaid = sum(["paid"]);
  const isActive = affiliate.status === "active";

  const affiliateUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/?ref=${affiliate.code}`;

  return (
    <div className="bg-surface">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        {/* En-tête */}
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full bg-mora-gradient text-lg font-bold text-white sm:flex"
            >
              {(user.email?.[0] ?? "M").toUpperCase()}
            </span>
            <div>
              <Badge tone="gold">Affilié</Badge>
              <h1 className="mt-3 font-display text-3xl font-bold text-gray-900">Mon espace affilié</h1>
              <p className="mt-1 text-gray-600">{user.email}</p>
            </div>
          </div>
          <form action={signOut} className="shrink-0">
            <Button type="submit" variant="secondary" size="sm">Se déconnecter</Button>
          </form>
        </div>

        {/* Lien & code */}
        <section className="relative mt-8 overflow-hidden rounded-3xl bg-mora-gradient p-6 text-white shadow-lift sm:p-8">
          <div aria-hidden className="absolute inset-0 bg-mora-grid opacity-50" />
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-mora-or/20 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" />

          <div className="relative">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.16em] text-blue-200">Votre lien affilié</p>
                <p className="mt-1 max-w-md text-xs text-blue-200/80">
                  Partagez ce lien : les conversions éligibles génèrent des commissions.
                </p>
              </div>
              <Badge tone={isActive ? "success" : "warning"} dot={isActive}>
                {affiliate.status === "active" ? "Actif" : affiliate.status === "pending" ? "En attente" : affiliate.status}
              </Badge>
            </div>

            <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
              <code className="block flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-mora-or">
                {affiliateUrl}
              </code>
              <Button href={`${affiliateUrl}`} target="_blank" rel="noreferrer" variant="primary" size="md" className="shrink-0">
                Ouvrir mon lien
              </Button>
            </div>

            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-xs uppercase tracking-wide text-blue-200">Code</dt>
                <dd className="mt-1 font-mono text-2xl font-bold text-white">{affiliate.code}</dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-xs uppercase tracking-wide text-blue-200">Catégorie</dt>
                <dd className="mt-1 font-semibold text-white">{categoryLabel[affiliate.category] ?? affiliate.category}</dd>
              </div>
            </dl>
          </div>
        </section>

        {/* Performance */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <CommissionCard label="Commissions validées" value={totalValidated} tone="blue" icon="✦" />
          <CommissionCard label="En attente" value={totalPending} tone="warning" icon="⏳" />
          <CommissionCard label="Payées" value={totalPaid} tone="success" icon="✅" />
        </div>

        {/* Commissions */}
        <section className="mt-8" aria-labelledby="mes-commissions">
          <div className="flex items-center gap-3">
            <h2 id="mes-commissions" className="font-display text-xl font-bold text-mora-blue">Commissions</h2>
            <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-mora-blue-20 to-transparent" />
          </div>

          {list.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                icon={<span aria-hidden className="text-2xl">💸</span>}
                title="Aucune commission pour le moment"
                description="Partagez votre lien affilié : dès qu&apos;une conversion éligible est validée, votre commission apparaîtra ici."
              />
            </div>
          ) : (
            <div className="surface-card mt-5 overflow-hidden rounded-2xl">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-5 py-3.5">Date</th>
                      <th className="px-5 py-3.5">Montant</th>
                      <th className="px-5 py-3.5">Taux</th>
                      <th className="px-5 py-3.5">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((c) => (
                      <tr
                        key={c.id}
                        className="border-b border-gray-50 transition-colors last:border-0 hover:bg-mora-blue-10/60"
                      >
                        <td className="px-5 py-3.5 whitespace-nowrap text-gray-600">{new Date(c.created_at).toLocaleDateString("fr-FR")}</td>
                        <td className="px-5 py-3.5 font-semibold text-gray-800 tabular-nums">{Number(c.amount || 0).toLocaleString("fr-FR")} KMF</td>
                        <td className="px-5 py-3.5 font-mono text-xs text-gray-600">{Math.round(Number(c.rate_applied || 0) * 100)}&nbsp;%</td>
                        <td className="px-5 py-3.5"><StatusPill status={c.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <p className="mt-8 text-sm text-gray-500">
          Une question ?{" "}
          <Link href="/contact" className="link-accent">Contactez-nous</Link>.
        </p>
      </div>
    </div>
  );
}

function CommissionCard({
  label,
  value,
  tone = "blue",
  icon,
}: {
  label: string;
  value: number;
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
      <p className={cn("mt-1 font-display text-3xl font-bold tabular-nums", color)}>
        {value.toLocaleString("fr-FR")} <span className="text-base font-semibold">KMF</span>
      </p>
    </div>
  );
}
