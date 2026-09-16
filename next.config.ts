import type { NextConfig } from 'next';

/**
 * En-têtes de sécurité repris du `.htaccess` de l'ébauche, adaptés à Vercel.
 * Aucune valeur sensible n'est présente ici : la configuration runtime passe
 * exclusivement par les variables d'environnement (voir `src/lib/env.ts`).
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Convention d'URL retenue dans `06_SEO/01_STRUCTURE_DES_URLS.md` : slash final.
  trailingSlash: true,
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async redirects() {
    // Les anciennes URLs `.html` de l'ébauche restent jointes à leur équivalent.
    const legacy: Record<string, string> = {
      '/index.html': '/',
      '/about.html': '/qui-sommes-nous/',
      '/services.html': '/services/',
      '/boutique.html': '/boutique/',
      '/affiliation.html': '/affiliation/',
      '/blog.html': '/blog/',
      '/contact.html': '/contact/',
      '/rendez-vous.html': '/rendez-vous/',
      '/formation-prospection-relation-client.html': '/formation-prospection-relation-client/',
      '/blog-echec-prospection-client.html': '/blog/echec-prospection-client/',
      '/blog-gestion-documentaire-entreprise.html': '/blog/gestion-documentaire-entreprise/',
      '/blog-template-organisation.html': '/blog/template-organisation/',
      '/blog-site-internet-entrepreneur.html': '/blog/site-internet-entrepreneur/',
    };

    return Object.entries(legacy).map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    }));
  },
};

export default nextConfig;
