import CtaBand from '@/components/sections/CtaBand';
import PageHero from '@/components/sections/PageHero';
import JsonLd from '@/components/seo/JsonLd';
import type { LegalDocument } from '@/content/legal';
import { breadcrumbSchema, jsonLdGraph } from '@/lib/seo';

/**
 * Gabarit commun aux quatre pages légales.
 *
 * Réutilise la mise en page éditoriale existante (`PageHero` + `.article`) :
 * aucune présentation nouvelle n'est introduite, les documents légaux se lisent
 * exactement comme un article du blog.
 */
export default function LegalArticle({ doc }: { doc: LegalDocument }) {
  return (
    <>
      <JsonLd
        data={jsonLdGraph([
          breadcrumbSchema([
            { label: 'Accueil', path: '/' },
            { label: doc.title, path: `/${doc.slug}/` },
          ]),
        ])}
      />

      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: doc.title }]}
        eyebrow="Informations légales"
        title={doc.title}
        lead={doc.lead}
      />

      <section className="section">
        <div className="container">
          <div className="article reveal">
            <div className="article__note">
              <p>{doc.updated}</p>
            </div>
            {doc.body}
          </div>
        </div>
      </section>

      <CtaBand
        title="Une question sur ce document ?"
        text="Nous répondons directement à toute demande relative à nos informations légales ou au traitement de vos données."
        primaryLabel="Nous contacter"
        whatsappMessage="Bonjour MORA Shawiri, j’ai une question concernant vos informations légales."
      />
    </>
  );
}
