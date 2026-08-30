import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { BecomeAffiliateForm } from "@/components/affiliate/BecomeAffiliateForm";
import { Button } from "@/components/ui/Button";

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
      <div className="bg-gray-structure">
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
          <div className="flex items-center justify-between">
            <h1 className="font-display text-3xl font-bold text-gray-900">Mon espace affilié</h1>
            <form action={signOut}>
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

  const totalValidated = (commissions ?? [])
    .filter((c) => ["validated", "payable", "paid"].includes(c.status))
    .reduce((s, c) => s + Number(c.amount || 0), 0);

  return (
    <div className="bg-gray-structure">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-3xl font-bold text-gray-900">Mon espace affilié</h1>
            <p className="mt-1 text-gray-600">{user.email}</p>
          </div>
          <form action={signOut}>
            <Button type="submit" variant="secondary" size="sm">Se déconnecter</Button>
          </form>
        </div>

        {/* Lien & code */}
        <section className="mt-8 rounded-3xl bg-mora-blue p-8">
          <p className="text-sm font-medium uppercase tracking-wide text-blue-200">Votre lien affilié</p>
          <code className="mt-3 block rounded-xl bg-black/30 px-4 py-3 font-mono text-sm text-mora-or">
            {`${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/?ref=${affiliate.code}`}
          </code>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-blue-200">Code</p>
              <p className="font-mono text-lg font-bold text-white">{affiliate.code}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-blue-200">Catégorie</p>
              <p className="font-semibold text-white">{categoryLabel[affiliate.category] ?? affiliate.category}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-blue-200">Statut</p>
              <p className="font-semibold text-white">{affiliate.status}</p>
            </div>
          </div>
        </section>

        {/* Commissions */}
        <section className="mt-8">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-xl font-bold text-mora-blue">Commissions</h2>
            <p className="text-sm text-gray-600">
              Validées : <strong className="text-mora-blue">{totalValidated.toLocaleString("fr-FR")} KMF</strong>
            </p>
          </div>

          {(commissions ?? []).length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
              <p className="font-semibold text-gray-800">Aucune commission pour le moment</p>
              <p className="mt-2 text-sm text-gray-500">
                Partagez votre lien et les conversions éligibles généreront des commissions.
              </p>
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-2xl bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Montant</th>
                    <th className="px-4 py-3">Taux</th>
                    <th className="px-4 py-3">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {(commissions ?? []).map((c) => (
                    <tr key={c.id} className="border-b border-gray-50">
                      <td className="px-4 py-3 text-gray-600">{new Date(c.created_at).toLocaleDateString("fr-FR")}</td>
                      <td className="px-4 py-3 font-semibold text-gray-800">{Number(c.amount || 0).toLocaleString("fr-FR")} KMF</td>
                      <td className="px-4 py-3 text-gray-600">{Math.round(Number(c.rate_applied || 0) * 100)} %</td>
                      <td className="px-4 py-3 text-gray-600">{c.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="mt-8 text-sm text-gray-500">
          Une question ?{" "}
          <Link href="/contact" className="text-mora-blue hover:underline">Contactez-nous</Link>.
        </p>
      </div>
    </div>
  );
}
