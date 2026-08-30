"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { signOut } from "@/app/actions/auth";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  key: string;
  glyph: string;
  section?: string;
}

const modules: NavItem[] = [
  { href: "/admin", label: "Tableau de bord", key: "dashboard", glyph: "◉" },
  { href: "/admin/services", label: "Services", key: "services", glyph: "▣", section: "Catalogue" },
  { href: "/admin/produits", label: "Produits", key: "produits", glyph: "▤", section: "Catalogue" },
  { href: "/admin/commandes", label: "Commandes", key: "commandes", glyph: "⃞", section: "Activité" },
  { href: "/admin/clients", label: "Clients", key: "clients", glyph: "●", section: "Activité" },
  { href: "/admin/affilies", label: "Affiliés", key: "affilies", glyph: "◈", section: "Activité" },
  { href: "/admin/commissions", label: "Commissions", key: "commissions", glyph: "✚", section: "Activité" },
  { href: "/admin/rendez-vous", label: "Rendez-vous", key: "rdv", glyph: "◔", section: "Activité" },
  { href: "/admin/contenus", label: "Contenus", key: "contenus", glyph: "▤", section: "Contenu" },
  { href: "/admin/notifications", label: "Notifications", key: "notifications", glyph: "◉", section: "Contenu" },
  { href: "/admin/statistiques", label: "Statistiques", key: "stats", glyph: "▥", section: "Contenu" },
  { href: "/admin/marketing", label: "Marketing", key: "marketing", glyph: "◆", section: "Pilotage" },
  { href: "/admin/popups", label: "Popups", key: "popups", glyph: "◧", section: "Pilotage" },
  { href: "/admin/parametres", label: "Paramètres", key: "parametres", glyph: "⚙", section: "Système" },
  { href: "/admin/administrateurs", label: "Administrateurs", key: "admins", glyph: "◉", section: "Système" },
];

const sections = ["Catalogue", "Activité", "Contenu", "Pilotage", "Système"];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  const sidebar = (
    <div className="relative flex h-full flex-col overflow-hidden bg-mora-gradient text-white">
      {/* Voile décoratif */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-mora-grid opacity-40" />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 top-0 h-48 w-48 rounded-full bg-mora-or/10 blur-3xl"
      />

      {/* En-tête */}
      <div className="relative flex items-center gap-3 border-b border-white/10 px-5 py-5">
        <Logo className="h-10 w-10 shrink-0" />
        <div className="min-w-0 leading-tight">
          <p className="truncate font-display text-base font-bold tracking-tight">MORA Shawiri</p>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-blue-100/70">
            Administration
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="relative flex-1 overflow-y-auto px-3 py-4" aria-label="Administration">
        {sections.map((section) => {
          const items = modules.filter((m) => m.section === section);
          return (
            <div key={section} className="mb-5">
              <p className="flex items-center gap-2 px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-blue-100/50">
                {section}
              </p>
              <div className="space-y-0.5">
                {items.map((m) => {
                  const active = isActive(m.href);
                  return (
                    <Link
                      key={m.key}
                      href={m.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                        active
                          ? "bg-white/15 text-white"
                          : "text-blue-100/75 hover:bg-white/10 hover:text-white",
                      )}
                    >
                      {active && (
                        <span
                          aria-hidden
                          className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-mora-or shadow-[0_0_12px_rgba(255,215,0,0.5)]"
                        />
                      )}
                      <span
                        aria-hidden
                        className={cn(
                          "w-5 text-center text-base leading-none transition-colors",
                          active ? "text-mora-or" : "text-mora-or/70 group-hover:text-mora-or",
                        )}
                      >
                        {m.glyph}
                      </span>
                      <span className="truncate">{m.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Pied : déconnexion */}
      <div className="relative border-t border-white/10 px-4 py-4">
        <form action={signOut}>
          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <span aria-hidden className="text-base leading-none">⏻</span>
            Se déconnecter
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 lg:flex">
      {/* Sidebar desktop */}
      <aside className="relative hidden w-64 shrink-0 lg:block lg:h-screen lg:sticky lg:top-0">
        {sidebar}
      </aside>

      {/* Topbar mobile */}
      <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <p className="font-display text-sm font-bold text-mora-blue">Administration</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ouvrir le menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-mora-blue-10 text-mora-blue transition-colors hover:bg-mora-blue-20 focus-visible:outline-2 focus-visible:outline-mora-blue"
        >
          <span aria-hidden className="text-lg leading-none">☰</span>
        </button>
      </div>

      {/* Drawer mobile */}
      <div className={cn("fixed inset-0 z-50 lg:hidden", open ? "" : "pointer-events-none")}>
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className={cn("absolute inset-0 bg-black/50 transition-opacity", open ? "opacity-100" : "opacity-0")}
        />
        <aside
          className={cn(
            "absolute left-0 top-0 h-full w-72 max-w-[85vw] transition-transform duration-300",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="relative h-full">
            {sidebar}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fermer le menu"
              className="absolute right-3 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-white"
            >
              ✕
            </button>
          </div>
        </aside>
      </div>

      {/* Contenu */}
      <div className="flex-1">{children}</div>
    </div>
  );
}
