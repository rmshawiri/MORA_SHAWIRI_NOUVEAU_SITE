import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";
import { siteConfig, absoluteUrl } from "@/lib/config";

export const metadata: Metadata = {
  title: "Programme d'affiliation",
  description:
    "Rejoignez le programme d'affiliation MORA Shawiri : recommandez nos services et produits et gagnez des commissions (10 %, 15 % ou 20 %).",
  alternates: { canonical: absoluteUrl("/affiliation") },
};

const tiers = [
  { label: "Particulier", rate: "10 %", text: "Pour toute personne recommandant MORA Shawiri." },
  { label: "Influenceur", rate: "15 %", text: "Pour les créateurs de contenus et influenceurs." },
  { label: "Équipe MORA Shawiri", rate: "20 %", text: "Pour les membres de l'équipe de la structure." },
];

const steps = [
  "S'inscrire",
  "Être validé",
  "Obtenir son lien",
  "Promouvoir",
  "Générer des commandes",
  "Suivre les commissions",
  "Recevoir les paiements",
];

export default function AffiliationPage() {
  return (
    <div className="bg-gray-structure">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="max-w-2xl">
          <h1 className="font-display text-3xl font-bold text-gray-900 sm:text-4xl">
            Programme d&apos;affiliation
          </h1>
          <p className="mt-3 text-gray-600">
            Recommandez les services et produits MORA Shawiri et gagnez une commission sur chaque
            vente éligible réalisée via votre lien ou code affilié.
          </p>
        </div>

        {/* Taux */}
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {tiers.map((t) => (
            <div key={t.label} className="rounded-3xl bg-white p-8 text-center shadow-sm">
              <p className="font-display text-4xl font-bold text-mora-blue">{t.rate}</p>
              <p className="mt-2 font-semibold text-gray-800">{t.label}</p>
              <p className="mt-2 text-sm text-gray-600">{t.text}</p>
            </div>
          ))}
        </div>

        {/* Lien affilié */}
        <div className="mt-10 rounded-3xl bg-mora-blue p-8">
          <h2 className="font-display text-xl font-bold text-white">Votre lien affilié</h2>
          <p className="mt-3 text-blue-100">
            Un lien unique et personnel vous est attribué. Exemple de format :
          </p>
          <code className="mt-3 block rounded-xl bg-black/30 px-4 py-3 font-mono text-sm text-mora-or">
            {siteConfig.url}/?ref=VOTRE_CODE
          </code>
          <p className="mt-4 text-sm text-blue-100">
            La commission est calculée côté serveur selon les règles du programme et le montant
            réellement encaissé. Les commandes annulées ou remboursées sont réajustées.
          </p>
        </div>

        {/* Parcours */}
        <div className="mt-10 rounded-3xl bg-white p-8">
          <h2 className="font-display text-xl font-bold text-mora-blue">Comment ça marche ?</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2">
            {steps.map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-mora-blue-20 text-sm font-bold text-mora-blue">
                  {i + 1}
                </span>
                <span className="text-gray-700">{s}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-10 text-center">
          <h2 className="font-display text-xl font-bold text-gray-900">Prêt à devenir affilié ?</h2>
          <p className="mx-auto mt-2 max-w-xl text-gray-600">
            Inscrivez-vous, obtenez votre lien et recommandez honnêtement les services MORA Shawiri.
          </p>
          <div className="mt-6">
            <Button href="/inscription?type=affilie" variant="primary" size="lg">
              Devenir affilié
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
