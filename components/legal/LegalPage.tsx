import type { Metadata } from "next";
import { siteConfig, absoluteUrl } from "@/lib/config";

interface Section {
  heading: string;
  body: string[];
}

/**
 * Gabarit de page légale MORA Shawiri.
 * Les contenus légaux réels de MORA Shawiri sont partiellement « à compléter »
 * (voir documentation). On n'invente pas de donnée juridique ; on affiche les
 * informations réelles connues et on marque les champs à valider avant déploiement.
 */
export function LegalPage({
  title,
  description,
  sections,
  updated = "À compléter avant mise en production",
}: {
  title: string;
  description: string;
  sections: Section[];
  updated?: string;
}) {
  return (
    <div className="bg-white">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-bold text-gray-900">{title}</h1>
        <p className="mt-2 text-gray-600">{description}</p>
        <p className="mt-2 text-sm text-gray-500">Dernière mise à jour : {updated}</p>

        <div className="mt-8 space-y-8">
          {sections.map((s) => (
            <section key={s.heading}>
              <h2 className="font-display text-xl font-bold text-mora-blue">{s.heading}</h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-gray-700">
                {s.body.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 rounded-2xl bg-warning-soft p-5 text-sm text-gray-700">
          <p className="font-semibold text-warning">Validation requise avant mise en production</p>
          <p className="mt-1">
            Certaines informations légales (forme juridique, n&apos;° d&apos;immatriculation,
            n&apos;° fiscal, adresse complète, hébergeur, droit applicable) doivent être
            complétées et vérifiées avant la mise en production définitive, conformément à la
            documentation. Aucune donnée juridique n&apos;est inventée.
          </p>
        </div>

        <div className="mt-8 border-t border-gray-200 pt-6 text-sm text-gray-500">
          <p>
            {siteConfig.name} — {siteConfig.slogan}
          </p>
        </div>
      </div>
    </div>
  );
}

export function makeLegalMetadata(title: string, description: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(`/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`) },
    robots: { index: true, follow: true },
  };
}
