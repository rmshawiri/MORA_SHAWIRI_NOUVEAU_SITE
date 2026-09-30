import Link from 'next/link';
import CtaBand from '@/components/sections/CtaBand';
import PageHero from '@/components/sections/PageHero';
import PostCard from '@/components/sections/PostCard';
import SectionHead from '@/components/sections/SectionHead';
import JsonLd from '@/components/seo/JsonLd';
import { ArrowRight, Mail } from '@/components/ui/Icon';
import { getPublicBlog } from '@/lib/contenus/blog';
import { getContenus } from '@/lib/contenus/public';
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

// Next.js exige ici un littéral : la valeur est lue par analyse statique, pas
// à l'exécution, et une constante importée est refusée au build. Elle doit donc
// rester égale à CONTENUS_REVALIDATE_SECONDS — ce que le test
// `contenus-revalidation` vérifie, pour que la duplication ne dérive pas.
export const revalidate = 300;

export default async function BlogPage() {
  const [contenus, blog] = await Promise.all([getContenus(), getPublicBlog()]);

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
        {...contenus.texte('blog.hero')}
      />

      <section className="section" aria-labelledby="articles-title">
        <div className="container">
          <SectionHead {...contenus.texte('blog.articles')} titleId="articles-title" />
          <div className="grid grid--3 reveal-group">
            {blog.posts.map((post) => (
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
        {...contenus.texte('blog.cta')}
      />
    </>
  );
}
