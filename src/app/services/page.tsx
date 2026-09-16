import Image from 'next/image';
import Link from 'next/link';
import CheckList from '@/components/sections/CheckList';
import CtaBand from '@/components/sections/CtaBand';
import Faq from '@/components/sections/Faq';
import PageHero from '@/components/sections/PageHero';
import SectionHead from '@/components/sections/SectionHead';
import JsonLd from '@/components/seo/JsonLd';
import { ArrowRight, Cart, ChartBars, Database, Globe, GraduationCap, Palette } from '@/components/ui/Icon';
import { audiences, emphasizedRows, formulaRows, servicePoles, servicesFaq } from '@/content/services';
import { getSiteUrl } from '@/lib/env';
import { breadcrumbSchema, faqSchema, jsonLdGraph, pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Services — Toutes les expertises numériques, un seul partenaire',
  description:
    'Sites web, boutiques en ligne, identité visuelle, marketing digital, gestion documentaire, conseil et formations : les six pôles d’expertise de MORA Shawiri à Moroni.',
  path: '/services/',
});

const poleIcons = {
  globe: Globe,
  cart: Cart,
  palette: Palette,
  chart: ChartBars,
  database: Database,
  graduation: GraduationCap,
} as const;

/** Liste des services au format schema.org, alimentée par la même source. */
function servicesSchema() {
  const siteUrl = getSiteUrl();
  return {
    '@type': 'ItemList',
    itemListElement: servicePoles.map((pole, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Service',
        name: pole.title,
        description: pole.description,
        provider: { '@id': `${siteUrl}/#organisation` },
        areaServed: 'Union des Comores',
      },
    })),
  };
}

export default function ServicesPage() {
  return (
    <>
      <JsonLd
        data={jsonLdGraph([
          breadcrumbSchema([
            { label: 'Accueil', path: '/' },
            { label: 'Services', path: '/services/' },
          ]),
          servicesSchema(),
          faqSchema(servicesFaq),
        ])}
      />

      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Services' }]}
        eyebrow="Nos services"
        title="Toutes les expertises numériques, un seul partenaire"
        lead="Du premier logo à l’organisation de vos données, MORA Shawiri couvre l’ensemble de vos besoins numériques. Vous gagnez du temps, de la cohérence et de la performance."
      />

      <section className="section" aria-labelledby="poles-title">
        <div className="container">
          <SectionHead
            eyebrow="Six pôles d’expertise"
            title="Ce que nous faisons, concrètement"
            titleId="poles-title"
            lead="Chaque pôle peut être mobilisé seul ou combiné aux autres dans un accompagnement global."
          />
          <div className="grid grid--2 reveal-group">
            {servicePoles.map((pole) => {
              const PoleIcon = poleIcons[pole.icon];
              return (
                <article className="card card--accent" id={pole.id} key={pole.id}>
                  <div className="card__icon">
                    <PoleIcon />
                  </div>
                  <h3>{pole.title}</h3>
                  <p>{pole.description}</p>
                  <CheckList items={pole.points} style={{ marginTop: 8 }} />
                  <Link className="arrow-link" href="/contact/">
                    Demander un devis pour ce service <ArrowRight />
                  </Link>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="formules-title">
        <div className="container">
          <SectionHead
            eyebrow="Tableau comparatif"
            title="Trois niveaux d’accompagnement, un objectif : votre performance"
            titleId="formules-title"
            lead="Des formules lisibles pour choisir en connaissance de cause. Chaque formule est ajustée sur devis selon votre projet."
            center
          />
          <div className="compare-wrap reveal">
            <table className="compare">
              <caption className="sr-only">
                Comparaison des formules Essentiel, Croissance et Performance
              </caption>
              <thead>
                <tr>
                  <th scope="col">Ce qui est couvert</th>
                  <th scope="col">Essentiel</th>
                  <th scope="col">Croissance</th>
                  <th scope="col">Performance</th>
                </tr>
              </thead>
              <tbody>
                {formulaRows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" style={{ fontWeight: 600 }}>
                      {row.label}
                    </th>
                    {row.cells.map((cell, index) => (
                      <td key={index}>
                        {cell === '—' ? (
                          <span className="no">—</span>
                        ) : emphasizedRows.has(row.label) ? (
                          <strong>{cell}</strong>
                        ) : (
                          cell
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="btn-row" style={{ marginTop: 32, justifyContent: 'center' }}>
            <Link className="btn btn--primary btn--lg" href="/contact/">
              Faire chiffrer ma formule <ArrowRight />
            </Link>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="publics-title">
        <div className="container">
          <div className="split">
            <div className="split__body reveal">
              <p className="eyebrow">Pour qui&nbsp;?</p>
              <h2 id="publics-title">Des solutions pensées pour chaque type d’organisation</h2>
              <p className="lead">
                Quelle que soit votre taille, nous adaptons la méthode, les outils et le budget à
                votre réalité.
              </p>
              <ul className="pill-row" style={{ marginTop: 24 }}>
                {audiences.map((audience) => (
                  <li key={audience}>{audience}</li>
                ))}
              </ul>
            </div>
            <div className="split__media reveal">
              <Image
                src="/images/section-pour-qui.webp"
                alt="Deux profils d’organisations accompagnées par MORA Shawiri"
                width={1536}
                height={1024}
                sizes="(max-width: 767px) 100vw, 45vw"
                loading="lazy"
                style={{
                  width: '100%',
                  height: 'auto',
                  aspectRatio: '3 / 2',
                  objectFit: 'cover',
                  borderRadius: 16,
                  boxShadow: 'var(--shadow-lg)',
                }}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="faq-title">
        <div className="container">
          <SectionHead
            eyebrow="FAQ services"
            title="Avant de démarrer, ce qu’il faut savoir"
            titleId="faq-title"
            center
          />
          <Faq items={servicesFaq} />
        </div>
      </section>

      <CtaBand
        title="Quel service correspond à votre projet ?"
        text="Décrivez-nous votre besoin : nous recommandons la solution la plus rentable, devis gratuit à l’appui."
        primaryLabel="Demander un devis gratuit"
        whatsappMessage="Bonjour MORA Shawiri, je souhaite être conseillé sur le service adapté à mon projet."
      />
    </>
  );
}
