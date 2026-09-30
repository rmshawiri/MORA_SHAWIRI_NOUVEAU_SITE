import AppointmentWizard from '@/components/interactive/AppointmentWizard';
import PageHero from '@/components/sections/PageHero';
import SectionHead from '@/components/sections/SectionHead';
import JsonLd from '@/components/seo/JsonLd';
import { Check, Clock, Mail, MapPin } from '@/components/ui/Icon';
import { getContenus } from '@/lib/contenus/public';
import { breadcrumbSchema, jsonLdGraph, pageMetadata } from '@/lib/seo';
import { site, whatsappLink } from '@/lib/site';

export const metadata = pageMetadata({
  title: 'Prendre rendez-vous — Réservez votre échange en moins de deux minutes',
  description:
    'Réservez un échange gratuit avec MORA Shawiri : quelques questions, une à la fois, puis confirmation de votre créneau sous 24 h ouvrées. À Moroni ou à distance.',
  path: '/rendez-vous/',
});

const facts = [
  {
    Icon: Clock,
    strong: '30 à 45 minutes',
    text: 'Le temps de comprendre votre besoin et de cadrer la suite.',
  },
  {
    Icon: MapPin,
    strong: 'À Moroni ou à distance',
    text: 'En agence, par téléphone, en visioconférence ou sur WhatsApp.',
  },
  {
    Icon: Check,
    strong: 'Sans engagement',
    text: 'Vous repartez avec des recommandations concrètes, même sans suite.',
  },
  {
    Icon: Mail,
    strong: 'Confirmation sous 24 h',
    text: 'Vous recevez un accusé de réception, puis nous validons le créneau avec vous.',
  },
];

// Next.js exige ici un littéral : la valeur est lue par analyse statique, pas
// à l'exécution, et une constante importée est refusée au build. Elle doit donc
// rester égale à CONTENUS_REVALIDATE_SECONDS — ce que le test
// `contenus-revalidation` vérifie, pour que la duplication ne dérive pas.
export const revalidate = 300;

export default async function RendezVousPage() {
  const contenus = await getContenus();

  return (
    <>
      <JsonLd
        data={jsonLdGraph([
          breadcrumbSchema([
            { label: 'Accueil', path: '/' },
            { label: 'Prendre rendez-vous', path: '/rendez-vous/' },
          ]),
        ])}
      />

      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Prendre rendez-vous' }]}
        {...contenus.texte('rendez-vous.hero')}
      />

      <section className="section" aria-labelledby="rdv-title">
        <div className="container">
          <SectionHead
            {...contenus.texte('rendez-vous.section')}
            titleId="rdv-title"
            lead="Aucune inscription, aucun formulaire interminable : une conversation guidée, et vous gardez la main sur chaque réponse."
          />

          <div className="rdv-shell">
            <AppointmentWizard />

            <aside className="rdv-aside">
              <div className="card card--brand">
                <h3>Comment se passe le rendez-vous&nbsp;?</h3>
                <ul className="rdv-facts">
                  {facts.map(({ Icon, strong, text }) => (
                    <li key={strong}>
                      <Icon size={20} strokeWidth={2} />
                      <span>
                        <strong>{strong}</strong>
                        <span>{text}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="card">
                <h3>Vous préférez parler tout de suite&nbsp;?</h3>
                <p>
                  Nous sommes joignables du lundi au samedi, de 08H à 17H (heure de Moroni).
                </p>
                <div className="btn-row">
                  <a className="btn btn--primary" href={site.phoneHref}>
                    Appeler {site.phone}
                  </a>
                  <a
                    className="btn btn--ghost"
                    href={whatsappLink('Bonjour MORA Shawiri, je souhaite prendre rendez-vous.')}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Écrire sur WhatsApp
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
