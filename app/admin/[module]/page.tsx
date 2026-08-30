import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPage } from "@/components/admin/AdminPage";
import { Badge } from "@/components/ui/Badge";

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

const glyphs: Record<string, string> = {
  produits: "▤",
  clients: "●",
  affilies: "◈",
  commissions: "✚",
  "rendez-vous": "◔",
  contenus: "▤",
  notifications: "◉",
  statistiques: "▥",
  parametres: "⚙",
  marketing: "◆",
  popups: "◧",
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
    <AdminPage icon={glyphs[module] ?? "▣"} title={label} subtitle="Module d'administration">
      <div className="relative overflow-hidden rounded-3xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center shadow-soft">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-mora-blue-10/60" />
        <div className="relative">
          <span aria-hidden className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-mora-blue-10 text-3xl text-mora-blue ring-1 ring-mora-blue-20">
            {glyphs[module] ?? "▣"}
          </span>
          <div className="mt-5 flex justify-center">
            <Badge tone="neutral">En construction</Badge>
          </div>
          <p className="mt-4 font-display text-xl font-bold text-gray-900">Module en cours de construction</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-500">
            Ce module d&apos;administration sera développé prochainement. Il permettra de gérer cette
            partie de la plateforme depuis l&apos;interface, sans modifier le code.
          </p>
          <div className="mt-6">
            <Link href="/admin" className="link-accent text-sm">← Retour au tableau de bord</Link>
          </div>
        </div>
      </div>
    </AdminPage>
  );
}
