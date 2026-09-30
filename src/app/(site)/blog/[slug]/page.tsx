import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ArticleBody from '@/components/sections/ArticleBody';
import PageHero from '@/components/sections/PageHero';
import PostCard from '@/components/sections/PostCard';
import SectionHead from '@/components/sections/SectionHead';
import JsonLd from '@/components/seo/JsonLd';
import { ArrowRight } from '@/components/ui/Icon';
import { postPath, type Post } from '@/content/posts';
import { getPublicArticle, getPublicBlog, relatedFrom } from '@/lib/contenus/blog';
import { getSiteUrl } from '@/lib/env';
import { breadcrumbSchema, jsonLdGraph, pageMetadata } from '@/lib/seo';
import { site } from '@/lib/site';

type PageProps = { params: Promise<{ slug: string }> };

/**
 * Articles pré-rendus au build.
 *
 * Lus en base depuis la phase 4E-2, avec repli sur ceux du code : une base
 * injoignable au moment du build ne doit pas produire un site sans blog.
 *
 * `dynamicParams` reste à sa valeur par défaut (`true`). C'est voulu : un
 * article publié après le déploiement est alors rendu à la demande, puis mis en
 * cache — il apparaît donc sans redéploiement, ce qui est précisément l'objet de
 * la phase. Un slug inexistant, lui, reçoit un 404 par `notFound()`.
 */
export async function generateStaticParams() {
  const { posts } = await getPublicBlog();
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const article = await getPublicArticle(slug);
  if (!article) return {};

  const { post } = article;

  return pageMetadata({
    title: post.title,
    description: post.excerpt,
    path: postPath(post),
    images: [post.cover.src],
  });
}

function articleSchema(post: Post) {
  const siteUrl = getSiteUrl();

  return {
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    image: `${siteUrl}${post.cover.src}`,
    datePublished: post.date,
    dateModified: post.date,
    inLanguage: 'fr-FR',
    author: { '@id': `${siteUrl}/#organisation` },
    publisher: { '@id': `${siteUrl}/#organisation` },
    mainEntityOfPage: `${siteUrl}${postPath(post)}`,
    articleSection: post.category,
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;

  // L'article et le fil sont lus en parallèle : le fil ne sert qu'aux
  // suggestions de fin de lecture, il n'a pas à attendre l'article.
  const [article, blog] = await Promise.all([getPublicArticle(slug), getPublicBlog()]);

  // Un article non publié n'est pas « masqué » : RLS ne renvoie pas la ligne,
  // donc il n'existe pas pour cette session. Connaître son slug ne donne rien
  // (point 14 du cadrage).
  if (!article) notFound();

  const { post, body: blocks } = article;
  const related = relatedFrom(blog.posts, slug);
  const schema = articleSchema(post);

  return (
    <>
      {schema ? (
        <JsonLd
          data={jsonLdGraph([
            breadcrumbSchema([
              { label: 'Accueil', path: '/' },
              { label: 'Blog', path: '/blog/' },
              { label: post.category, path: postPath(post) },
            ]),
            schema,
          ])}
        />
      ) : null}

      <PageHero
        breadcrumb={[
          { label: 'Accueil', href: '/' },
          { label: 'Blog', href: '/blog/' },
          { label: post.category },
        ]}
        eyebrow={post.category}
        title={post.title}
        lead={post.lead}
      >
        <p style={{ marginTop: 24, fontSize: '.875rem', color: 'rgba(255,255,255,.66)' }}>
          Publié le <time dateTime={post.date}>{post.dateLabel}</time> · {post.readingTime} · Par{' '}
          {site.name}
        </p>
      </PageHero>

      <section className="section">
        <div className="container">
          <figure style={{ maxWidth: 900, margin: '0 auto 56px' }}>
            <Image
              src={post.cover.src}
              alt={`${post.title} — ${site.name}`}
              width={post.cover.width}
              height={post.cover.height}
              priority
              sizes="(max-width: 900px) 100vw, 900px"
              style={{
                width: '100%',
                height: 'auto',
                borderRadius: 16,
                boxShadow: 'var(--shadow-lg)',
              }}
            />
          </figure>

          <div className="article">
            <ArticleBody blocks={blocks} />

            <div className="cta-band" style={{ marginTop: 64 }}>
              <div className="cta-band__body">
                <h2 style={{ fontSize: 'var(--text-h3)' }}>{post.cta.title}</h2>
                <p>{post.cta.text}</p>
              </div>
              <div className="btn-row">
                <Link className="btn btn--gold" href={post.cta.href}>
                  {post.cta.label} <ArrowRight />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="autres-articles">
        <div className="container">
          <SectionHead
            eyebrow="À lire aussi"
            title="D’autres articles pour aller plus loin"
            titleId="autres-articles"
          />
          <div className="grid grid--2 reveal-group">
            {related.map((item) => (
              <PostCard key={item.slug} post={item} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
