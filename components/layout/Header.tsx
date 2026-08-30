"use client";

import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { siteConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        {/* Identité */}
        <Link href="/" className="flex items-center gap-3" aria-label="Accueil MORA Shawiri">
          <Logo priority={false} className="block h-10 w-10" />
          <div className="leading-tight">
            <span className="block text-base font-bold text-mora-blue">
              {siteConfig.name}
            </span>
            <span className="block text-[11px] text-gray-500">{siteConfig.slogan}</span>
          </div>
        </Link>

        {/* Navigation desktop */}
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Navigation principale">
          {siteConfig.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-mora-blue-20 hover:text-mora-blue"
            >
              {item.label}
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
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-mora-blue hover:bg-mora-blue-20 lg:hidden"
        >
          <span aria-hidden>{open ? "✕" : "☰"}</span>
        </button>
      </div>

      {/* Navigation mobile */}
      <div
        id="mobile-menu"
        className={cn("lg:hidden", open ? "block" : "hidden")}
      >
        <nav
          className="mx-auto flex max-w-6xl flex-col gap-1 border-t border-gray-100 px-4 py-3"
          aria-label="Navigation mobile"
        >
          {siteConfig.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-3 text-base font-medium text-gray-700 hover:bg-mora-blue-20 hover:text-mora-blue"
            >
              {item.label}
            </Link>
          ))}
          <div className="mt-2 flex flex-col gap-2">
            <Button href="/espace-client" variant="ghost" size="md" className="w-full">
              Mon compte
            </Button>
            <Button href="/devis" variant="primary" size="md" className="w-full">
              Demander un devis
            </Button>
          </div>
        </nav>
      </div>
    </header>
  );
}
