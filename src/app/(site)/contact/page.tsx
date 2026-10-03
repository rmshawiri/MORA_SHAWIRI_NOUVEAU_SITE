import ContactForm from '@/components/interactive/ContactForm';
import ContactItem from '@/components/sections/ContactItem';
import CtaBand from '@/components/sections/CtaBand';
import PageHero from '@/components/sections/PageHero';
import SectionHead from '@/components/sections/SectionHead';
import JsonLd from '@/components/seo/JsonLd';
import { ArrowRight, Clock, Mail, MapPin, Phone, socialIcons } from '@/components/ui/Icon';
import { getPublicCatalogue, toOfferContexts } from '@/lib/catalogue/public';
import { getContenus } from '@/lib/contenus/public';
import { breadcrumbSchema, jsonLdGraph, pageMetadata } from '@/lib/seo';
import { site, socials, whatsappLink } from '@/lib/site';

/**
 * Le formulaire présélectionne le besoin à partir de `?offre=`. Ce contexte
 * vient désormais du catalogue en base ; la page reste pré-rendue, comme la
 * Boutique et l'accueil.
 */
// Next.js exige ici un littéral : la valeur est lue par analyse statique, pas
// à l'exécution, et une constante importée est refusée au build. Elle doit
// donc rester égale à CATALOGUE_REVALIDATE_SECONDS — ce que le test
// `catalogue-revalidation` vérifie, pour que la duplication ne dérive pas.
export const revalidate = 300;

export const metadata = pageMetadata({
  title: 'Contact — Parlons de votre projet',
  description:
    'Contactez MORA Shawiri à Moroni : réponse sous 24 h, devis détaillé sous 48 h, gratuitement et sans engagement. Téléphone, e-mail et WhatsApp.',
  path: '/contact/',
});

const WHATSAPP_MESSAGE = 'Bonjour MORA Shawiri, j’aimerais discuter de mon projet.';

export default async function ContactPage() {
  const [{ offers }, contenus] = await Promise.all([getPublicCatalogue(), getContenus()]);
  const offerContexts = toOfferContexts(offers);

  return (
    <>
      <JsonLd
        data={jsonLdGraph([
          breadcrumbSchema([
            { label: 'Accueil', path: '/' },
            { label: 'Contact', path: '/contact/' },
          ]),
        ])}
      />

      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Contact' }]}
        {...contenus.texte('contact.hero')}
      />

      <section className="section">
        <div className="container">
          <div className="split" style={{ alignItems: 'start' }}>
            <div className="card reveal" style={{ padding: 'clamp(24px,3vw,44px)' }}>
              <p className="eyebrow">Formulaire</p>
              <h2 style={{ fontSize: 'var(--text-h3)' }}>Demander un devis gratuit</h2>
              <p style={{ marginBottom: 8 }}>
                Votre demande nous parvient directement, et vous en recevez un accusé de réception
                par e-mail. Vous pourrez ensuite, si vous le souhaitez, en envoyer une copie sur
                WhatsApp.
              </p>
              <ContactForm offers={offerContexts} />
            </div>

            <div className="split__body reveal">
              <p className="eyebrow">Coordonnées</p>
              <h2 style={{ fontSize: 'var(--text-h3)' }}>Nous joindre directement</h2>
              <div className="grid" style={{ gap: 16, marginBottom: 32 }}>
                <ContactItem
                  icon={<Phone />}
                  title={site.phone}
                  text="Appel et WhatsApp"
                  href={site.phoneHref}
                />
                <ContactItem
                  icon={<Mail />}
                  title={site.email}
                  text="Réponse sous 24 h ouvrées"
                  href={site.emailHref}
                />
                <ContactItem
                  icon={<MapPin />}
                  title={site.addressLabel}
                  text="Rendez-vous sur place ou en visioconférence, sur les trois îles"
                />
                <ContactItem
                  icon={<Clock />}
                  title="Lundi – Samedi, 08H - 17H (Heure de Moroni)"
                  text="Heure d’Afrique de l’Est (EAT, UTC+3)"
                />
              </div>

              <div className="card card--brand">
                <h3>Réponse la plus rapide</h3>
                <p>
                  Pour une question courte ou un besoin urgent, WhatsApp reste le canal le plus
                  efficace : nous répondons généralement dans la journée ouvrée.
                </p>
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <a
                    className="btn btn--gold"
                    href={whatsappLink(WHATSAPP_MESSAGE)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Écrire sur WhatsApp <ArrowRight />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="reseaux-title">
        <div className="container">
          <SectionHead
            {...contenus.texte('contact.reseaux')}
            titleId="reseaux-title"
            lead="Réalisations, conseils et coulisses de nos projets, publiés régulièrement."
            center
          />
          <div className="grid grid--3 reveal-group">
            {socials.map((network) => {
              const IconComponent = socialIcons[network.id];
              return (
                <ContactItem
                  key={network.id}
                  icon={IconComponent ? <IconComponent /> : null}
                  title={network.label}
                  text="Suivre MORA Shawiri"
                  href={network.href}
                  external
                />
              );
            })}
          </div>
        </div>
      </section>

      {/* Le CTA principal pointait auparavant vers /contact/ — c'est-à-dire vers
          la page déjà affichée. Il propose désormais l'étape suivante réelle. */}
      <CtaBand
        {...contenus.texte('contact.cta')}
        primaryHref="/rendez-vous/"
        currentPath="/contact/"
        whatsappMessage="Bonjour MORA Shawiri, j’ai une question sur vos prestations."
      />
    </>
  );
}
