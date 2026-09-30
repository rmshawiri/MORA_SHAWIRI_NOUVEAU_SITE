import Link from 'next/link';
import CtaBand from '@/components/sections/CtaBand';
import Faq from '@/components/sections/Faq';
import PageHero from '@/components/sections/PageHero';
import SectionHead from '@/components/sections/SectionHead';
import JsonLd from '@/components/seo/JsonLd';
import { ArrowRight } from '@/components/ui/Icon';
import { getPublicFaq } from '@/lib/contenus/faq';
import { getContenus } from '@/lib/contenus/public';
import { breadcrumbSchema, faqSchema, jsonLdGraph, pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'FAQ — Vos questions sur nos services, tarifs et demandes',
  description:
    'Services, tarifs, demandes de devis, rendez-vous, formation, offres visuelles, affiliation, contact : les réponses officielles aux questions les plus fréquentes posées à MORA Shawiri.',
  path: '/faq/',
});

// Next.js exige ici un littéral : la valeur est lue par analyse statique, pas
// à l'exécution, et une constante importée est refusée au build. Elle doit donc
// rester égale à CONTENUS_REVALIDATE_SECONDS — ce que le test
// `contenus-revalidation` vérifie, pour que la duplication ne dérive pas.
export const revalidate = 300;

export default async function FaqPage() {
  const [contenus, faq] = await Promise.all([getContenus(), getPublicFaq()]);

  return (
    <>
      <JsonLd
        data={jsonLdGraph([
          breadcrumbSchema([
            { label: 'Accueil', path: '/' },
            { label: 'FAQ', path: '/faq/' },
          ]),
          faqSchema(faq.all),
        ])}
      />

      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'FAQ' }]}
        {...contenus.texte('faq.hero')}
      />

      <section className="section" aria-labelledby="faq-title">
        <div className="container">
          <SectionHead {...contenus.texte('faq.principale')} titleId="faq-title" center />

          {faq.categories.map((category) => (
            <div className="faq-group" key={category.id}>
              <h2 className="faq-group__title" id={`faq-${category.id}`}>
                {category.title}
              </h2>
              <Faq items={category.items} />
            </div>
          ))}
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="faq-suite-title">
        <div className="container">
          <SectionHead {...contenus.texte('faq.suite')} titleId="faq-suite-title" center />
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <Link className="btn btn--gold btn--lg" href="/contact/">
              Nous contacter <ArrowRight />
            </Link>
            <Link className="btn btn--ghost btn--lg" href="/boutique/">
              Voir nos prestations
            </Link>
          </div>
        </div>
      </section>

      <CtaBand
        {...contenus.texte('faq.cta')}
      />
    </>
  );
}
