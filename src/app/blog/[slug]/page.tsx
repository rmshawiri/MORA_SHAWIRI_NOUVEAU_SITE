import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ArticleBody from '@/components/sections/ArticleBody';
import PageHero from '@/components/sections/PageHero';
import PostCard from '@/components/sections/PostCard';
import SectionHead from '@/components/sections/SectionHead';
import JsonLd from '@/components/seo/JsonLd';
import { ArrowRight } from '@/components/ui/Icon';
import { getPost, postBody, postPath, posts, relatedPosts } from '@/content/posts';
import { getSiteUrl } from '@/lib/env';
import { breadcrumbSchema, jsonLdGraph, pageMetadata } from '@/lib/seo';
import { site } from '@/lib/site';

type PageProps = { params: Promise<{ slug: string }> };

/** Les quatre articles sont connus à la compilation : génération statique. */
export function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};

  return pageMetadata({
    title: post.title,
    description: post.excerpt,
    path: postPath(post),
    images: [post.cover.src],
  });
}

function articleSchema(slug: string) {
  const post = getPost(slug);
  if (!post) return null;
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
  const post = getPost(slug);
  if (!post) notFound();

  const blocks = postBody(slug);
  const related = relatedPosts(slug);
  const schema = articleSchema(slug);

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
