import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

/** Manifeste d'application web (installation sur mobile). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MORA Shawiri — Agence digitale',
    short_name: site.name,
    description:
      'Le Choix Optimal pour votre performance. Sites web, identité visuelle, organisation des données et formations aux Comores.',
    lang: 'fr',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#ffffff',
    theme_color: '#003366',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/favicon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/logo-circle.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
