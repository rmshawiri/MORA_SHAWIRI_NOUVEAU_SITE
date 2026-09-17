import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/env';

/**
 * Les parcours de compte et les espaces privés sont retirés de l'exploration.
 *
 * `06_SEO/01_STRUCTURE_DES_URLS.md` § 41-44 : les pages de l'espace client, de
 * l'espace affilié et de l'administration « ne doivent pas être indexées ».
 * § 42 et `05_ANALYTICS_ET_INDEXATION.md` § 67 ajoutent la page de connexion,
 * qui n'a pas de valeur de référencement.
 *
 * Chaque page porte par ailleurs `robots: { index: false }` dans ses
 * métadonnées. Les deux mécanismes ne font pas double emploi : ce fichier
 * demande de ne pas explorer, la balise demande de ne pas indexer — et une
 * page jamais explorée ne peut pas voir sa balise. Les deux sont donc posés.
 */
const privateAreas = [
  '/api/',
  '/auth/',
  '/connexion/',
  '/inscription/',
  '/mot-de-passe-oublie/',
  '/reinitialiser-mot-de-passe/',
  '/changer-mot-de-passe/',
  '/securite/',
  '/espace-client/',
  '/espace-affilie/',
  '/administration/',
];

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: [{ userAgent: '*', allow: '/', disallow: privateAreas }],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
