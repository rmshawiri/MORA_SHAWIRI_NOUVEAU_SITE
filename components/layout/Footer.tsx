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

// Icônes sociales compactes (SVG inline, style cohérent) — chaque lien provient de la config.
function SocialIcon({ name }: { name: string }) {
  const cls = "h-4 w-4";
  switch (name) {
    case "facebook":
      return <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.8 3.7-3.8 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z"/></svg>;
    case "instagram":
      return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>;
    case "youtube":
      return <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden><path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.9C18.2 5 12 5 12 5s-6.2 0-7.8.3A2.6 2.6 0 0 0 2.4 7.2 27 27 0 0 0 2 12a27 27 0 0 0 .4 4.8 2.6 2.6 0 0 0 1.8 1.9C5.8 19 12 19 12 19s6.2 0 7.8-.3a2.6 2.6 0 0 0 1.8-1.9A27 27 0 0 0 22 12a27 27 0 0 0-.4-4.8ZM10 15V9l5.2 3Z"/></svg>;
    case "tiktok":
      return <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden><path d="M16.6 5.8a4.9 4.9 0 0 0 1.9 1.6c.7.3 1.4.5 2 .5v3a7.9 7.9 0 0 1-4-1.1v5.7a5.5 5.5 0 1 1-5.5-5.5c.3 0 .7 0 1 .1v3.2a2.4 2.4 0 1 0 1.6 2.2V3.5h2.9c0 .8.4 1.6.8 2.2Z"/></svg>;
    case "linkedin":
      return <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3Zm6 0h3.8v1.7h.05c.53-1 1.8-2.07 3.7-2.07 4 0 4.7 2.6 4.7 6V21h-4v-5.6c0-1.3 0-3-1.9-3s-2.2 1.4-2.2 2.9V21H9Z"/></svg>;
    case "telegram":
      return <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden><path d="M21.9 4.4 18.9 19c-.2 1-.8 1.2-1.6.8l-4.4-3.3-2.1 2c-.2.3-.4.5-.9.5l.3-4.5 8.3-7.5c.4-.3-.1-.5-.6-.2L6.6 13.2 2.2 11.8c-1-.3-1-1 .2-1.4l18.2-7c.8-.3 1.5.2 1.3 1Z"/></svg>;
    case "whatsapp":
      return <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.4 14.2c-.2.6-1.3 1.2-1.8 1.3-.5.1-1.1.1-1.7-.1a9 9 0 0 1-3.2-1.2 11.6 11.6 0 0 1-3.9-4.7c-.5-1-.2-2 .3-2.6.2-.3.5-.6.9-.7h.4c.2 0 .4 0 .6.4l.7 1.7c.1.2.1.4 0 .6l-.6.7c-.2.2-.2.4-.1.6.7 1.1 1.6 2.1 2.7 2.8.2.1.4.1.6-.1l.8-.7c.2-.2.4-.2.6-.1l1.7.8c.2.1.3.2.3.4v.2c0 .2-.2.5-.3.8Z"/></svg>;
    default:
      return null;
  }
}

export function Footer() {
  const year = new Date().getFullYear();
  const socials = Object.entries(siteConfig.social).filter(([name]) =>
    ["facebook", "instagram", "youtube", "tiktok", "linkedin", "telegram"].includes(name),
  );

  return (
    <footer className="relative overflow-hidden bg-mora-gradient text-white">
      <div aria-hidden className="absolute inset-0 bg-mora-grid opacity-70" />
      <div aria-hidden className="absolute -left-20 top-0 h-64 w-64 rounded-full bg-mora-or/10 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          {/* Identité */}
          <div>
            <div className="flex items-center gap-3.5">
              <Logo className="block h-12 w-12" sizes="48px" />
              <div className="leading-tight">
                <p className="font-display text-lg font-bold">{siteConfig.name}</p>
                <p className="text-xs text-blue-100/80">{siteConfig.slogan}</p>
              </div>
            </div>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-blue-100/80">
              {siteConfig.description}
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              {socials.map(([name, url]) => (
                <a
                  key={name}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`MORA Shawiri sur ${name}`}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-mora-or hover:text-mora-blue focus-visible:outline-white"
                >
                  <SocialIcon name={name} />
                </a>
              ))}
            </div>
          </div>

          {/* Navigation */}
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.16em] text-mora-or">
              Navigation
            </h2>
            <ul className="mt-5 space-y-3 text-sm">
              {siteConfig.nav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-blue-100/85 transition-colors hover:text-white"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.16em] text-mora-or">
              Contact
            </h2>
            <ul className="mt-5 space-y-3 text-sm text-blue-100/85">
              <li>
                <a href={siteConfig.contact.whatsappUrl} target="_blank" rel="noreferrer" className="transition-colors hover:text-white">
                  WhatsApp : {siteConfig.contact.phoneDisplay}
                </a>
              </li>
              <li>
                <a href={`mailto:${siteConfig.contact.email}`} className="transition-colors hover:text-white">
                  {siteConfig.contact.email}
                </a>
              </li>
              <li>{siteConfig.contact.address}</li>
              <li className="flex items-center gap-2 text-blue-100/70">
                <span aria-hidden className="h-2 w-2 rounded-full bg-mora-green" />
                Basé à {siteConfig.contact.city}, {siteConfig.contact.country}
              </li>
            </ul>
          </div>

          {/* Légal */}
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.16em] text-mora-or">
              Informations
            </h2>
            <ul className="mt-5 space-y-3 text-sm">
              {legalLinks.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-blue-100/85 transition-colors hover:text-white"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2.5 px-4 py-6 text-xs text-blue-100/70 sm:flex-row sm:px-6">
          <p>© {year} {siteConfig.name}. Tous droits réservés.</p>
          <p className="flex items-center gap-2">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-mora-or" />
            {siteConfig.slogan}
          </p>
        </div>
      </div>
    </footer>
  );
}
