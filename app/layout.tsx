import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import { siteConfig } from "@/lib/config";

// Typographie officielle recommandée : Outfit (titres), Inter (textes/interfaces).
// Police monospace système conservée pour les références (nom de fichier, réf. document, etc.)
const inter = Inter({
  variable: "--font-inter-var",
  subsets: ["latin"],
  display: "swap",
});

const outfit = Outfit({
  variable: "--font-outfit-var",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — ${siteConfig.slogan}`,
    template: `%s — ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  authors: [{ name: "MORA Shawiri" }],
  keywords: [
    "MORA Shawiri",
    "services numériques Comores",
    "création de site web Comores",
    "création de logo",
    "solutions digitales Moroni",
    "e-commerce Comores",
    "affiliation",
  ],
  formatDetection: { email: false, address: false, telephone: false },
  openGraph: {
    type: "website",
    locale: siteConfig.locale,
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.slogan}`,
    description: siteConfig.description,
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — ${siteConfig.slogan}`,
    description: siteConfig.description,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#003366",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteConfig.name,
    slogan: siteConfig.slogan,
    description: siteConfig.description,
    url: siteConfig.url,
    email: siteConfig.contact.email,
    telephone: siteConfig.contact.phoneE164,
    address: {
      "@type": "PostalAddress",
      addressLocality: siteConfig.contact.city,
      addressCountry: "KM",
      streetAddress: "Moroni, Magoudjou",
    },
    sameAs: [
      siteConfig.social.facebook,
      siteConfig.social.instagram,
      siteConfig.social.youtube,
      siteConfig.social.tiktok,
      siteConfig.social.linkedin,
      siteConfig.social.telegram,
    ],
  };

  return (
    <html
      lang={siteConfig.language}
      className={`${inter.variable} ${outfit.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-gray-900">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}

// Note : `absoluteUrl` est exposé pour une éventuelle utilisation dans des
// composants serveur ; les liens canonicaux des pages l'utilisent (voir SEO).
