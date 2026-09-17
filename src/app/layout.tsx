import type { Metadata, Viewport } from 'next';
import { Inter, Poppins } from 'next/font/google';
import type { ReactNode } from 'react';
import Dock from '@/components/layout/Dock';
import Footer from '@/components/layout/Footer';
import Header from '@/components/layout/Header';
import JsonLd from '@/components/seo/JsonLd';
import ScrollReveal from '@/components/ui/ScrollReveal';
import { getSiteUrl } from '@/lib/env';
import { jsonLdGraph, organizationSchema, websiteSchema } from '@/lib/seo';
import { site } from '@/lib/site';
import '@/styles/globals.css';

/**
 * Polices officielles du site, chargées et auto-hébergées par Next.js :
 * plus de requête vers Google Fonts, plus de blocage du rendu.
 */
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-poppins',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: 'MORA Shawiri — Agence digitale aux Comores | Sites web, branding & formations',
    template: '%s | MORA Shawiri',
  },
  description: site.description,
  applicationName: site.name,
  authors: [{ name: site.name }],
  // Pas de `keywords` : la balise est ignorée par les moteurs depuis 2009 et son
  // contenu ressemblait à une liste de positionnement — à l'opposé de la
  // discipline demandée par `00_EXIGENCES_SEO.md` § 31.
  icons: {
    icon: '/favicon.png',
    apple: '/logo-circle.png',
  },
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    siteName: site.name,
    locale: 'fr_FR',
  },
};

export const viewport: Viewport = {
  themeColor: '#003366',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${poppins.variable} ${inter.variable}`}>
      <body>
        <JsonLd data={jsonLdGraph([organizationSchema(), websiteSchema()])} />
        <a className="skip-link" href="#main">
          Aller au contenu principal
        </a>
        <Header />
        <main id="main" data-page-transition>
          {children}
        </main>
        <Footer />
        <Dock />
        <ScrollReveal />
      </body>
    </html>
  );
}
