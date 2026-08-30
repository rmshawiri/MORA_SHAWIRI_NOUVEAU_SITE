import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { siteConfig } from "@/lib/config";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-mora-gradient">
      {/* Ambiance premium : grille lumineuse + halos discrets, purement décoratifs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-mora-grid" />
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[44rem] -translate-x-1/2 rounded-full bg-mora-or/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -right-20 top-1/3 h-72 w-72 rounded-full bg-mora-blue-40/20 blur-3xl" />

      <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Link
            href="/"
            aria-label="Accueil MORA Shawiri"
            className="rounded-full bg-white p-2.5 shadow-blue-glow transition-transform duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline-mora-or"
          >
            <Logo className="block h-12 w-12" />
          </Link>
          <div>
            <p className="font-display text-2xl font-bold tracking-tight text-white">{siteConfig.name}</p>
            <p className="mt-1 text-sm text-white/70">{siteConfig.slogan}</p>
          </div>
        </div>

        <div className="w-full max-w-md">{children}</div>

        <p className="mt-8 text-sm text-white/60">
          <Link
            href="/"
            className="inline-flex items-center gap-1 font-medium text-white/80 transition-colors hover:text-mora-or focus-visible:outline-mora-or"
          >
            <span aria-hidden>←</span> Retour au site
          </Link>
        </p>
      </div>
    </div>
  );
}
