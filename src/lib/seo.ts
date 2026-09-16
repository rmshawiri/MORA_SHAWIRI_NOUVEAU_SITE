import type { Metadata } from 'next';
import { getSiteUrl } from '@/lib/env';
import { site, socials } from '@/lib/site';

/**
 * Fabrique les métadonnées d'une page.
 *
 * L'URL de base provient de `NEXT_PUBLIC_SITE_URL` : changer de domaine ne
 * demande aucune modification du code (§ 110 du document des variables).
 */
export function pageMetadata({
  title,
  description,
  path,
  images,
}: {
  title: string;
  description: string;
  /** Chemin absolu de la page, slash final inclus. */
  path: string;
  images?: string[];
}): Metadata {
  const siteUrl = getSiteUrl();
  const url = `${siteUrl}${path}`;
  const ogImages = images ?? ['/logo-circle.png'];

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: site.name,
      locale: 'fr_FR',
      title,
      description,
      url,
      images: ogImages,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ogImages,
    },
  };
}

/** Fiche organisation, référencée par les autres blocs de données structurées. */
export function organizationSchema() {
  const siteUrl = getSiteUrl();

  return {
    '@type': 'ProfessionalService',
    '@id': `${siteUrl}/#organisation`,
    name: site.name,
    slogan: site.slogan,
    url: `${siteUrl}/`,
    logo: `${siteUrl}/logo-circle.png`,
    image: `${siteUrl}/logo-circle.png`,
    telephone: site.phone,
    email: site.email,
    priceRange: 'Sur devis',
    address: {
      '@type': 'PostalAddress',
      addressLocality: site.locality,
      addressRegion: site.region,
      addressCountry: site.country,
    },
    areaServed: ['Union des Comores', 'Océan Indien', 'Monde francophone'],
    knowsLanguage: ['fr'],
    sameAs: socials.map((network) => network.href),
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      opens: '08:00',
      closes: '17:00',
    },
  };
}

export function websiteSchema() {
  const siteUrl = getSiteUrl();
  return {
    '@type': 'WebSite',
    '@id': `${siteUrl}/#site`,
    url: `${siteUrl}/`,
    name: site.name,
    inLanguage: 'fr-FR',
    publisher: { '@id': `${siteUrl}/#organisation` },
  };
}

/** Bloc FAQPage à partir des questions réellement affichées sur la page. */
export function faqSchema(items: readonly { question: string; answer: string }[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export function breadcrumbSchema(crumbs: readonly { label: string; path: string }[]) {
  const siteUrl = getSiteUrl();
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.label,
      item: `${siteUrl}${crumb.path}`,
    })),
  };
}

/** Assemble un graphe schema.org prêt à être injecté. */
export function jsonLdGraph(nodes: readonly object[]) {
  return { '@context': 'https://schema.org', '@graph': nodes };
}
