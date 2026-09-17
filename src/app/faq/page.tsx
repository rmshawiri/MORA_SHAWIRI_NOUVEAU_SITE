import Link from 'next/link';
import CtaBand from '@/components/sections/CtaBand';
import Faq from '@/components/sections/Faq';
import PageHero from '@/components/sections/PageHero';
import SectionHead from '@/components/sections/SectionHead';
import JsonLd from '@/components/seo/JsonLd';
import { ArrowRight } from '@/components/ui/Icon';
import { faqAllItems, faqCategories } from '@/content/faq';
import { breadcrumbSchema, faqSchema, jsonLdGraph, pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'FAQ — Vos questions sur nos services, tarifs et demandes',
  description:
    'Services, tarifs, demandes de devis, rendez-vous, formation, offres visuelles, affiliation, contact : les réponses officielles aux questions les plus fréquentes posées à MORA Shawiri.',
  path: '/faq/',
});

export default function FaqPage() {
  return (
    <>
      <JsonLd
        data={jsonLdGraph([
          breadcrumbSchema([
            { label: 'Accueil', path: '/' },
            { label: 'FAQ', path: '/faq/' },
          ]),
          faqSchema(faqAllItems),
        ])}
      />

      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'FAQ' }]}
        eyebrow="Questions fréquentes"
        title="Vos questions, nos réponses"
        lead="Tarifs, demandes de devis, rendez-vous, formation, offres visuelles, affiliation : voici les réponses aux questions qui nous sont le plus souvent posées. Si la vôtre n’y figure pas, écrivez-nous — nous y répondrons directement."
      />

      <section className="section" aria-labelledby="faq-title">
        <div className="container">
          <SectionHead
            eyebrow="FAQ"
            title="Tout ce qu’il faut savoir avant de nous solliciter"
            titleId="faq-title"
            lead="Les réponses ci-dessous reprennent les informations officielles de MORA Shawiri. Elles sont mises à jour dès qu’une offre, un tarif ou un parcours évolue."
            center
          />

          {faqCategories.map((category) => (
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
          <SectionHead
            eyebrow="Vous ne trouvez pas votre réponse ?"
            title="Nous répondons directement"
            titleId="faq-suite-title"
            lead="Une question précise, une situation particulière, un doute sur l’offre à choisir : expliquez-nous simplement votre besoin."
            center
          />
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
        title="Un projet, une question, un doute ?"
        text="Le premier échange est gratuit et sans engagement. Il éclaire souvent la décision à lui seul."
        primaryLabel="Demander un devis gratuit"
        whatsappMessage="Bonjour MORA Shawiri, j’ai une question après avoir consulté votre FAQ."
      />
    </>
  );
}
