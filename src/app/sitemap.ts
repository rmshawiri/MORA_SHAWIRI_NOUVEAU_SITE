import type { MetadataRoute } from 'next';
import { posts, postPath } from '@/content/posts';
import { getSiteUrl } from '@/lib/env';

/** Pages fixes du site, de la plus stratégique à la moins prioritaire. */
const staticRoutes: { path: string; priority: number; changeFrequency: 'monthly' | 'yearly' }[] = [
  { path: '/', priority: 1, changeFrequency: 'monthly' },
  { path: '/services/', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/boutique/', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/formation-prospection-relation-client/', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/qui-sommes-nous/', priority: 0.7, changeFrequency: 'yearly' },
  { path: '/affiliation/', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/rendez-vous/', priority: 0.7, changeFrequency: 'yearly' },
  { path: '/contact/', priority: 0.7, changeFrequency: 'yearly' },
  { path: '/blog/', priority: 0.6, changeFrequency: 'monthly' },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const now = new Date();

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
