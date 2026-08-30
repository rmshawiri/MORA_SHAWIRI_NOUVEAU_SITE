"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { siteConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

export function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  const close = () => setOpen(false);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  // Ombre cohérente au scroll (discrète, élégante).
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full">
      {/* Barre d'annonce discrète */}
      <div className="hidden bg-mora-blue text-white sm:block">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-1.5 text-xs sm:px-6">
          <p className="truncate text-blue-100/90">
            {siteConfig.tagline} — {siteConfig.contact.city}, {siteConfig.contact.country}
          </p>
          <a
            href={siteConfig.contact.whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1.5 font-medium text-white transition-colors hover:text-mora-or"
          >
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-mora-green" />
            WhatsApp : {siteConfig.contact.phoneDisplay}
          </a>
        </div>
      </div>

      <div
        className={cn(
          "border-b transition-all duration-300",
          scrolled
            ? "border-gray-100 bg-white/95 shadow-[0_1px_0_rgba(0,51,102,0.04),0_8px_24px_rgba(0,51,102,0.06)] backdrop-blur-xl"
            : "border-transparent bg-white/85 backdrop-blur-xl",
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          {/* Identité */}
          <Link href="/" className="group flex items-center gap-3" aria-label="Accueil MORA Shawiri" onClick={close}>
            <Logo priority={false} className="h-11 w-11 shrink-0 transition-transform duration-300 group-hover:scale-105" />
            <div className="leading-tight">
              <span className="block font-display text-base font-bold tracking-tight text-mora-blue">
                {siteConfig.name}
              </span>
              <span className="block text-[11px] font-medium text-gray-500">{siteConfig.slogan}</span>
            </div>
          </Link>

          {/* Navigation desktop */}
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Navigation principale">
            {siteConfig.nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                  isActive(item.href)
                    ? "bg-mora-blue-20 text-mora-blue"
                    : "text-gray-700 hover:bg-mora-blue-10 hover:text-mora-blue",
                )}
              >
                {item.label}
                {isActive(item.href) && (
                  <span aria-hidden className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-mora-or" />
                )}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <Button href="/espace-client" variant="ghost" size="sm">
              Mon compte
            </Button>
            <Button href="/devis" variant="primary" size="sm">
              Demander un devis
            </Button>
          </div>

          {/* Bouton menu mobile */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-mora-blue transition-colors hover:bg-mora-blue-10 lg:hidden"
          >
            <span aria-hidden className="text-xl leading-none">{open ? "✕" : "☰"}</span>
          </button>
        </div>

        {/* Navigation mobile */}
        <div
          id="mobile-menu"
          className={cn(
            "grid transition-all duration-300 ease-out lg:hidden",
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <nav
              className="mx-auto flex max-w-6xl flex-col gap-1 border-t border-gray-100 px-4 py-4"
              aria-label="Navigation mobile"
            >
              {siteConfig.nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={close}
                  className={cn(
                    "rounded-xl px-4 py-3 text-base font-medium transition-colors",
                    isActive(item.href)
                      ? "bg-mora-blue-20 text-mora-blue"
                      : "text-gray-700 hover:bg-mora-blue-10 hover:text-mora-blue",
                  )}
                >
                  {item.label}
                </Link>
              ))}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link
                  href="/espace-client"
                  onClick={close}
                  className="inline-flex h-12 items-center justify-center rounded-full border border-gray-300 bg-white px-4 text-base font-semibold text-gray-800 transition-colors hover:border-mora-blue hover:text-mora-blue"
                >
                  Mon compte
                </Link>
                <Link
                  href="/devis"
                  onClick={close}
                  className="inline-flex h-12 items-center justify-center rounded-full bg-mora-or px-4 text-base font-semibold text-mora-blue shadow-gold transition-transform hover:-translate-y-0.5"
                >
                  Devis
                </Link>
              </div>
              <a
                href={siteConfig.contact.whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 rounded-xl bg-[#25D366]/10 px-4 py-3 text-center text-sm font-semibold text-[#128C7E]"
              >
                Discuter sur WhatsApp
              </a>
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}
