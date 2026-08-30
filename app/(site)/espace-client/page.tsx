import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/Button";

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

  return (
    <div className="bg-gray-structure">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-3xl font-bold text-gray-900">Mon espace client</h1>
            <p className="mt-1 text-gray-600">Bienvenue, {user.email}.</p>
          </div>
          <form action={signOut}>
            <Button type="submit" variant="secondary" size="sm">Se déconnecter</Button>
          </form>
        </div>

        <section className="mt-8">
          <h2 className="font-display text-xl font-bold text-mora-blue">Mes commandes</h2>
          {ordersList.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
              <p className="font-semibold text-gray-800">Aucune commande pour le moment</p>
              <p className="mt-2 text-sm text-gray-500">
                Découvrez nos services disponibles dès maintenant.
              </p>
              <div className="mt-5">
                <Button href="/boutique" variant="primary" size="md">Voir la boutique</Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-2xl bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Référence</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3">Paiement</th>
                  </tr>
                </thead>
                <tbody>
                  {ordersList.map((o) => (
                    <tr key={o.id} className="border-b border-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-mora-blue">{o.order_number}</td>
                      <td className="px-4 py-3 font-semibold text-gray-800">
                        {(o.total ?? 0).toLocaleString("fr-FR")} {o.currency}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{o.status}</td>
                      <td className="px-4 py-3 text-gray-600">{o.payment_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="mt-8 text-sm text-gray-500">
          Besoin d&apos;aide ?{" "}
          <Link href="/contact" className="text-mora-blue hover:underline">Contactez-nous</Link>.
        </p>
      </div>
    </div>
  );
}
