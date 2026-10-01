import AffiliationApplicationWizard from '@/components/interactive/AffiliationApplicationWizard';
import PageHero from '@/components/sections/PageHero';
import SectionHead from '@/components/sections/SectionHead';
import JsonLd from '@/components/seo/JsonLd';
import { isPayoutKind, type PayoutMethodOption } from '@/lib/affiliation/applications';
import { breadcrumbSchema, jsonLdGraph, pageMetadata } from '@/lib/seo';
import { site, whatsappLink } from '@/lib/site';
import { getPublicSupabaseClient } from '@/lib/supabase/public';

import '@/styles/affiliation-inscription.css';

export const metadata = pageMetadata({
  title: 'Rejoindre le programme d’affiliation — Candidature',
  description:
    'Déposez votre candidature au programme d’affiliation de MORA Shawiri : six étapes courtes, étudiées par notre équipe avant toute activation.',
  path: '/affiliation/inscription/',
});

// Même cadence que les autres pages lues en base : la liste des moyens de
// versement suit la configuration de l'administration sous cinq minutes.
export const revalidate = 300;

/**
 * Inscription au programme d'affiliation — phase 4H.
 *
 * Une nouvelle page, ouverte depuis les appels à l'action de `/affiliation/`,
 * qui reste, elle, strictement inchangée. La structure est celle de la prise
 * de rendez-vous : un parcours guidé et, à côté, ce qui se passe ensuite.
 *
 * Les moyens de versement proposés viennent de la configuration de MORA
 * Shawiri (`payment_methods.payout_enabled`) : aucune liste n'est écrite ici.
 * Base injoignable : la page reste lisible, l'étape « Versements » le dit.
 */
async function loadPayoutMethods(): Promise<PayoutMethodOption[]> {
  const client = getPublicSupabaseClient();
  if (!client) return [];
  const { data, error } = await client.rpc('affiliate_payout_methods');
  if (error || !data) return [];
  return data
    .filter((row) => isPayoutKind(row.kind))
    .map((row) => ({ code: row.code, label: row.label, kind: row.kind as PayoutMethodOption['kind'] }));
}

const nextSteps = [
  {
    strong: 'Votre candidature',
    text: 'Six étapes, et un accusé de réception par e-mail.',
  },
  {
    strong: 'L’étude par notre équipe',
    text: 'Nous pouvons vous demander une précision. Vous êtes informé à chaque étape.',
  },
  {
    strong: 'La configuration de votre programme',
    text: 'Catégorie, conditions et moyen de versement sont arrêtés avec vous.',
  },
  {
    strong: 'L’activation',
    text: 'Vous recevez l’accès à votre espace affilié et votre lien personnel.',
  },
];

export default async function AffiliationInscriptionPage() {
  const methods = await loadPayoutMethods();

  return (
    <>
      <JsonLd
        data={jsonLdGraph([
          breadcrumbSchema([
            { label: 'Accueil', path: '/' },
            { label: 'Affiliation', path: '/affiliation/' },
            { label: 'Candidature', path: '/affiliation/inscription/' },
          ]),
        ])}
      />

      <PageHero
        breadcrumb={[
          { label: 'Accueil', href: '/' },
          { label: 'Affiliation', href: '/affiliation/' },
          { label: 'Candidature' },
        ]}
        eyebrow="Programme d’affiliation"
        title="Rejoignez le programme d’affiliation"
        lead="Présentez-vous en quelques étapes. Notre équipe étudie chaque candidature avec attention avant d’ouvrir votre espace affilié."
      />

      <section className="section" aria-labelledby="candidature-title">
        <div className="container">
          <SectionHead
            eyebrow="Votre candidature"
            title="Six étapes, et vous gardez la main"
            titleId="candidature-title"
            lead="Chaque réponse reste modifiable jusqu’à l’envoi, et un récapitulatif vous est présenté avant de valider."
          />

          <div className="rdv-shell">
            <AffiliationApplicationWizard methods={methods} />

            <aside className="rdv-aside">
              <div className="card card--brand">
                <h3>Et ensuite&nbsp;?</h3>
                <ol className="aff-next">
                  {nextSteps.map((item) => (
                    <li key={item.strong}>
                      <span>
                        <strong>{item.strong}</strong>
                        <span>{item.text}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="card">
                <h3>Une question avant de candidater&nbsp;?</h3>
                <p>Écrivez-nous : nous vous répondons volontiers.</p>
                <div className="btn-row">
                  <a
                    className="btn btn--ghost"
                    href={whatsappLink('Bonjour MORA Shawiri, j’ai une question sur le programme d’affiliation.')}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Écrire sur WhatsApp
                  </a>
                  <a className="btn btn--ghost" href={`mailto:${site.email}`}>
                    Écrire un e-mail
                  </a>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </>
  );
}
