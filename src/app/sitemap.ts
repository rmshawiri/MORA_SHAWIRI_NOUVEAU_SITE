import type { MetadataRoute } from 'next';
import { legalDocuments } from '@/content/legal';
import { postPath } from '@/content/posts';
import { getPublicBlog } from '@/lib/contenus/blog';
import { getSiteUrl } from '@/lib/env';

/** Pages fixes du site, de la plus stratégique à la moins prioritaire. */
const staticRoutes: { path: string; priority: number; changeFrequency: 'monthly' | 'yearly' }[] = [
  { path: '/', priority: 1, changeFrequency: 'monthly' },
  { path: '/services/', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/boutique/', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/formation-prospection-relation-client/', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/faq/', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/qui-sommes-nous/', priority: 0.7, changeFrequency: 'yearly' },
  { path: '/affiliation/', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/rendez-vous/', priority: 0.7, changeFrequency: 'yearly' },
  { path: '/contact/', priority: 0.7, changeFrequency: 'yearly' },
  { path: '/blog/', priority: 0.6, changeFrequency: 'monthly' },
  // Pages légales : indexables et partageables depuis qu'elles ont une URL propre.
  ...legalDocuments.map((doc) => ({
    path: `/${doc.slug}/`,
    priority: 0.3,
    changeFrequency: 'yearly' as const,
  })),
];

/**
 * Le plan de site suit désormais les articles **réellement publiés**.
 *
 * C'est une exigence, pas un raffinement : le § 70 demande un SEO préservé, et
 * annoncer à un moteur une adresse qui répond 404 — parce que l'article a été
 * dépublié — est exactement ce qu'il faut éviter. Les pages légales, elles,
 * restent en code (décision D-21 = A), donc lues depuis le registre.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const now = new Date();
  const { posts } = await getPublicBlog();

  return [
    ...staticRoutes.map((route) => ({
      url: `${siteUrl}${route.path}`,
      lastModified: now,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    })),
    ...posts.map((post) => ({
      url: `${siteUrl}${postPath(post)}`,
      lastModified: new Date(post.date),
      changeFrequency: 'yearly' as const,
      priority: 0.5,
    })),
  ];
}
