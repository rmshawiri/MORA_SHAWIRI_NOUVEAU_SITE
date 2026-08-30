import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { siteConfig, absoluteUrl } from "@/lib/config";

export const metadata: Metadata = {
  title: "Programme d'affiliation",
  description:
    "Rejoignez le programme d'affiliation MORA Shawiri : recommandez nos services et produits et gagnez des commissions (10 %, 15 % ou 20 %).",
  alternates: { canonical: absoluteUrl("/affiliation") },
};

const tiers = [
  { label: "Particulier", rate: "10 %", text: "Pour toute personne recommandant MORA Shawiri.", tone: "blue" },
  { label: "Influenceur", rate: "15 %", text: "Pour les créateurs de contenus et influenceurs.", tone: "blue" },
  { label: "Équipe MORA Shawiri", rate: "20 %", text: "Pour les membres de l'équipe de la structure.", tone: "gold" },
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
    <div className="bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <SectionHeading
          eyebrow="Programme d'affiliation"
          title="Recommandez MORA Shawiri, gagnez des commissions"
          description="Recommandez les services et produits MORA Shawiri et gagnez une commission sur chaque vente éligible réalisée via votre lien ou code affilié."
        />

        {/* Taux de commission */}
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {tiers.map((t, i) => (
            <Reveal key={t.label} delay={i * 80}>
              <div className="group relative h-full overflow-hidden rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-mora-blue-40/40 hover:shadow-lift">
                <div
                  aria-hidden
                  className={`absolute inset-x-0 top-0 h-1 transition-opacity ${t.tone === "gold" ? "bg-mora-or" : "bg-mora-gradient"} opacity-0 group-hover:opacity-100`}
                />
                <p className="font-display text-5xl font-extrabold tracking-tight text-mora-blue tabular-nums">
                  {t.rate}
                </p>
                <p className="mt-3 font-display text-lg font-bold text-gray-900">{t.label}</p>
                <p className="mt-2 text-sm text-gray-600">{t.text}</p>
                {t.tone === "gold" && (
                  <Badge tone="gold" className="mt-4">Recommandé</Badge>
                )}
              </div>
            </Reveal>
          ))}
        </div>

        {/* Lien affilié */}
        <div className="mt-14 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <Reveal>
            <div className="relative h-full overflow-hidden rounded-3xl bg-mora-gradient p-8 text-white shadow-lift">
              <div aria-hidden className="absolute inset-0 bg-mora-grid opacity-50" />
              <div aria-hidden className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-mora-or/15 blur-3xl" />
              <div className="relative">
                <Badge tone="gold">Recrutement</Badge>
                <h2 className="mt-4 font-display text-xl font-bold">Votre lien affilié</h2>
                <p className="mt-3 text-sm text-blue-100/90">
                  Un lien unique et personnel vous est attribué. Exemple de format :
                </p>
                <code className="mt-3 block rounded-2xl bg-black/30 px-4 py-3 font-mono text-sm text-mora-or">
                  {siteConfig.url}/?ref=VOTRE_CODE
                </code>
                <p className="mt-4 text-sm text-blue-100/80">
                  La commission est calculée côté serveur selon les règles du programme et le montant
                  réellement encaissé. Les commandes annulées ou remboursées sont réajustées.
                </p>
              </div>
            </div>
          </Reveal>

          {/* Parcours */}
          <Reveal delay={100}>
            <div className="h-full rounded-3xl border border-gray-100 bg-white p-8 shadow-soft card-lift">
              <h2 className="font-display text-xl font-bold tracking-tight text-mora-blue">
                Comment ça marche ?
              </h2>
              <ol className="mt-6 space-y-3">
                {steps.map((s, i) => (
                  <li key={s} className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-mora-gradient font-display text-sm font-bold text-mora-or shadow-soft">
                      {i + 1}
                    </span>
                    <span className="text-gray-700">{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>
        </div>

        <Reveal>
          <div className="mt-14 text-center">
            <h2 className="font-display text-2xl font-bold tracking-tight text-gray-900">
              Prêt à devenir affilié ?
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-gray-600">
              Inscrivez-vous, obtenez votre lien et recommandez honnêtement les services MORA Shawiri.
            </p>
            <div className="mt-6">
              <Button href="/inscription?type=affilie" variant="primary" size="lg">
                Devenir affilié
              </Button>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
