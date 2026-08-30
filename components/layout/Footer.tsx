import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { siteConfig } from "@/lib/config";

const legalLinks = [
  { label: "Mentions légales", href: "/mentions-legales" },
  { label: "Confidentialité", href: "/politique-confidentialite" },
  { label: "CGU", href: "/conditions-utilisation" },
  { label: "CGV", href: "/conditions-vente" },
  { label: "Cookies", href: "/politique-cookies" },
  { label: "Remboursement", href: "/politique-remboursement" },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-gray-100 bg-gray-structure">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        {/* Identité */}
        <div className="md:col-span-1">
          <div className="flex items-center gap-3">
            <Logo className="block h-11 w-11" sizes="44px" />
            <div>
              <p className="font-bold text-mora-blue">{siteConfig.name}</p>
              <p className="text-xs text-gray-500">{siteConfig.slogan}</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-gray-600">{siteConfig.description}</p>
        </div>

        {/* Navigation */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-mora-blue">Navigation</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {siteConfig.nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-gray-600 transition-colors hover:text-mora-blue">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Contact */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-mora-blue">Contact</h2>
          <ul className="mt-4 space-y-2 text-sm text-gray-600">
            <li>
              <a href={siteConfig.contact.whatsappUrl} className="hover:text-mora-blue">
                WhatsApp : {siteConfig.contact.phoneDisplay}
              </a>
            </li>
            <li>
              <a href={`mailto:${siteConfig.contact.email}`} className="hover:text-mora-blue">
                {siteConfig.contact.email}
              </a>
            </li>
            <li>{siteConfig.contact.address}</li>
          </ul>

          <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-mora-blue">Suivez-nous</h2>
          <ul className="mt-3 flex flex-wrap gap-3 text-sm">
            <a href={siteConfig.social.facebook} target="_blank" rel="noreferrer" className="text-gray-600 hover:text-mora-blue">Facebook</a>
            <a href={siteConfig.social.instagram} target="_blank" rel="noreferrer" className="text-gray-600 hover:text-mora-blue">Instagram</a>
            <a href={siteConfig.social.tiktok} target="_blank" rel="noreferrer" className="text-gray-600 hover:text-mora-blue">TikTok</a>
            <a href={siteConfig.social.youtube} target="_blank" rel="noreferrer" className="text-gray-600 hover:text-mora-blue">YouTube</a>
            <a href={siteConfig.social.linkedin} target="_blank" rel="noreferrer" className="text-gray-600 hover:text-mora-blue">LinkedIn</a>
            <a href={siteConfig.social.telegram} target="_blank" rel="noreferrer" className="text-gray-600 hover:text-mora-blue">Telegram</a>
          </ul>
        </div>

        {/* Légal */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-mora-blue">Informations</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {legalLinks.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-gray-600 transition-colors hover:text-mora-blue">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-gray-200">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-gray-500 sm:flex-row sm:px-6">
          <p>
            © {year} {siteConfig.name}. Tous droits réservés.
          </p>
          <p>{siteConfig.slogan}</p>
        </div>
      </div>
    </footer>
  );
}
