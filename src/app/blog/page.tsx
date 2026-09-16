import Link from 'next/link';
import CtaBand from '@/components/sections/CtaBand';
import PageHero from '@/components/sections/PageHero';
import PostCard from '@/components/sections/PostCard';
import SectionHead from '@/components/sections/SectionHead';
import JsonLd from '@/components/seo/JsonLd';
import { ArrowRight, Mail } from '@/components/ui/Icon';
import { posts } from '@/content/posts';
import { breadcrumbSchema, jsonLdGraph, pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Blog & conseils — Des conseils applicables, pas des théories',
  description:
    'Prospection, gestion documentaire, templates, site internet : les conseils de MORA Shawiri pour les entrepreneurs et PME des Comores, tirés du terrain.',
  path: '/blog/',
});

const topics = [
  'Stratégie digitale',
  'Identité visuelle',
  'Organisation & données',
  'Vente en ligne',
  'Référencement local',
  'Formation & autonomie',
];

export default function BlogPage() {
  return (
    <>
      <JsonLd
        data={jsonLdGraph([
          breadcrumbSchema([
            { label: 'Accueil', path: '/' },
            { label: 'Blog', path: '/blog/' },
          ]),
        ])}
      />

      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Blog' }]}
        eyebrow="Blog & conseils"
        title="Des conseils applicables, pas des théories"
        lead="Nous partageons ce que nous observons sur le terrain auprès des entrepreneurs et PME des Comores : ce qui fonctionne, ce qui coûte cher, et par quoi commencer."
      />

      <section className="section" aria-labelledby="articles-title">
        <div className="container">
          <SectionHead eyebrow="Derniers articles" title="À lire en ce moment" titleId="articles-title" />
          <div className="grid grid--3 reveal-group">
            {posts.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        </div>
      </section>

      <section className="section section--alt">
        <div className="container">
          <div className="split">
            <div className="split__body reveal">
              <p className="eyebrow">Nos thématiques</p>
              <h2>Ce que nous traitons dans ce blog</h2>
              <p className="lead">
                Chaque article part d’une question réellement posée par un client, et se termine par
                une action concrète à mettre en œuvre.
              </p>
              <ul className="pill-row" style={{ marginTop: 24 }}>
                {topics.map((topic) => (
                  <li key={topic}>{topic}</li>
                ))}
              </ul>
            </div>
            <div className="card reveal">
              <div className="card__icon">
                <Mail size={18} />
              </div>
              <h3>Une question précise&nbsp;?</h3>
              <p>
                Si le sujet qui vous intéresse n’est pas encore traité, écrivez-nous : nous répondons
                directement, et cela nourrit les prochains articles.
              </p>
              <div className="btn-row" style={{ marginTop: 8 }}>
                <Link className="btn btn--primary" href="/contact/">
                  Poser ma question <ArrowRight />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <CtaBand
        title="Passer de la lecture à l’action"
        text="Un diagnostic gratuit permet d’identifier les deux ou trois chantiers les plus rentables pour votre organisation."
        primaryLabel="Demander un devis gratuit"
        whatsappMessage="Bonjour MORA Shawiri, je souhaite un diagnostic pour mon organisation."
      />
    </>
  );
}
