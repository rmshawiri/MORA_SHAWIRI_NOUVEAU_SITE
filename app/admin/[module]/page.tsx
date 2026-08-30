import Link from "next/link";
import { notFound } from "next/navigation";

const labels: Record<string, string> = {
  produits: "01 — Gestion des produits",
  clients: "03 — Gestion des clients",
  affilies: "04 — Gestion des affiliés",
  commissions: "05 — Gestion des commissions",
  "rendez-vous": "06 — Gestion des rendez-vous",
  contenus: "07 — Gestion des contenus",
  notifications: "08 — Gestion des notifications",
  statistiques: "09 — Statistiques",
  parametres: "10 — Paramètres",
  marketing: "11 — Gestion du marketing",
  popups: "12 — Gestion des popups",
};

export async function generateStaticParams() {
  return Object.keys(labels).map((module) => ({ module }));
}

export default async function AdminModulePlaceholder({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  const label = labels[module];
  if (!label) notFound();

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl font-bold text-gray-900">{label}</h1>
      <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
        <p className="font-semibold text-gray-800">Module en cours de construction</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
          Ce module d&apos;administration sera développé prochainement. Il permettra de gérer cette
          partie de la plateforme depuis l&apos;interface, sans modifier le code.
        </p>
        <div className="mt-5">
          <Link href="/admin" className="text-sm font-semibold text-mora-blue hover:underline">
            ← Retour au tableau de bord
          </Link>
        </div>
      </div>
    </div>
  );
}
