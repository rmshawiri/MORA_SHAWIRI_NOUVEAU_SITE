import Image from 'next/image';
import Link from 'next/link';
import CheckList from '@/components/sections/CheckList';
import CtaBand from '@/components/sections/CtaBand';
import OfferCard from '@/components/sections/OfferCard';
import PageHero from '@/components/sections/PageHero';
import SectionHead from '@/components/sections/SectionHead';
import Steps from '@/components/sections/Steps';
import JsonLd from '@/components/seo/JsonLd';
import { ArrowRight } from '@/components/ui/Icon';
import { offers } from '@/content/offers';
import { getSiteUrl } from '@/lib/env';
import { breadcrumbSchema, jsonLdGraph, pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Boutique — Douze offres prêtes à démarrer',
  description:
    'Site web, identité visuelle, visuels produits, organisation, conseil et formation : les douze prestations MORA Shawiri, chiffrées selon votre besoin réel.',
  path: '/boutique/',
});

const orderSteps = [
  {
    title: 'Choisissez votre offre',
    text: 'Sélectionnez la prestation qui correspond à votre besoin, puis contactez-nous par WhatsApp ou par le formulaire.',
  },
  {
    title: 'Recevez votre devis',
    text: 'Nous précisons ensemble le périmètre, puis vous recevez un devis détaillé sous 48 h, sans engagement.',
  },
  {
    title: 'Validez et démarrez',
    text: 'Après validation et premier règlement, la production démarre selon le planning convenu.',
  },
  {
    title: 'Livraison & prise en main',
    text: 'Vous recevez les livrables avec leurs fichiers sources et une session de prise en main.',
  },
];

/** Catalogue des offres au format schema.org. */
function offerCatalogSchema() {
  const siteUrl = getSiteUrl();
  return {
    '@type': 'OfferCatalog',
    name: 'Boutique MORA Shawiri',
    url: `${siteUrl}/boutique/`,
    itemListElement: offers.map((offer, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Service',
        name: offer.title,
        description: offer.description,
        provider: { '@id': `${siteUrl}/#organisation` },
        areaServed: 'Union des Comores',
      },
    })),
  };
}

export default function BoutiquePage() {
  return (
    <>
      <JsonLd
        data={jsonLdGraph([
          breadcrumbSchema([
            { label: 'Accueil', path: '/' },
            { label: 'Boutique', path: '/boutique/' },
          ]),
          offerCatalogSchema(),
        ])}
      />

      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Boutique' }]}
        eyebrow="Boutique"
        title="Douze offres prêtes à démarrer"
        lead="Site web, identité visuelle, visuels produits, organisation, conseil et formation : choisissez la prestation qui débloque votre prochaine étape. Chaque offre est chiffrée selon votre besoin réel."
      />

      <section className="section" aria-labelledby="offres-title">
        <div className="container">
          <SectionHead
            eyebrow="Nos offres"
            title="Choisissez ce dont vous avez besoin, rien de plus"
            titleId="offres-title"
            lead="Nos tarifs sont établis sur devis : vous ne payez ni fonctionnalité inutile ni forfait surdimensionné. Le périmètre est écrit avant de commencer."
          />
          <div className="grid grid--3 reveal-group">
            {offers.map((offer) => (
              <OfferCard key={offer.id} offer={offer} />
            ))}
          </div>
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="commande-title">
        <div className="container">
          <SectionHead
            eyebrow="Comment commander"
            title="Votre prestation lancée en quatre étapes simples"
            titleId="commande-title"
            center
          />
          <Steps items={orderSteps} />
          <div
            className="card card--brand reveal"
            style={{
              marginTop: 48,
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 24,
            }}
          >
            <div style={{ maxWidth: '60ch' }}>
              <h3>Paiement adapté au contexte local</h3>
              <p>
                Mobile money, virement bancaire ou espèces à Moroni. Une facture est remise pour
                chaque prestation, et les projets se règlent en plusieurs échéances liées aux étapes
                de livraison.
              </p>
            </div>
            <Link className="btn btn--gold" href="/contact/">
              Poser une question <ArrowRight />
            </Link>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="surmesure-title">
        <div className="container">
          <div className="split">
            <div className="split__media reveal">
              <figure className="portrait-panel">
                <Image
                  src="/images/section-pourquoi.webp"
                  alt="Consultante MORA Shawiri, prête à accompagner votre organisation"
                  width={1023}
                  height={1537}
                  sizes="(max-width: 767px) 100vw, 45vw"
                  loading="lazy"
                />
              </figure>
            </div>
            <div className="split__body reveal">
              <p className="eyebrow">Besoin de plus&nbsp;?</p>
              <h2 id="surmesure-title">
                Une seule offre ne suffit pas&nbsp;? Passez à l’accompagnement complet
              </h2>
              <p>
                Nos offres sont idéales pour traiter un besoin précis. Quand votre projet en combine
                plusieurs — site, identité, visuels, données, formation — nos formules
                d’accompagnement prennent le relais avec un pilotage unique.
              </p>
              <CheckList
                items={[
                  'Un seul interlocuteur pour l’ensemble du périmètre',
                  'Diagnostic gratuit pour identifier la solution la plus rentable',
                  'Devis détaillé sous 48 h, sans engagement',
                ]}
              />
              <div className="btn-row" style={{ marginTop: 32 }}>
                <Link className="btn btn--primary" href="/services/">
                  Voir les formules <ArrowRight />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <CtaBand
        title="Une question sur une offre ?"
        text="Nous vous aidons à choisir la prestation adaptée à votre situation, sans frais et sans engagement."
        primaryLabel="Nous contacter"
        whatsappMessage="Bonjour MORA Shawiri, j’ai une question sur une offre de votre boutique."
      />
    </>
  );
}
