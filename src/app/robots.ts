import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
