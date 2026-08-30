import Link from "next/link";
import { getUserRoles } from "@/lib/rbac";
import { signOut } from "@/app/actions/auth";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";

const modules = [
  { href: "/admin", label: "Tableau de bord", key: "dashboard" },
  { href: "/admin/services", label: "00 — Services", key: "services" },
  { href: "/admin/produits", label: "01 — Produits", key: "produits" },
  { href: "/admin/commandes", label: "02 — Commandes", key: "commandes" },
  { href: "/admin/clients", label: "03 — Clients", key: "clients" },
  { href: "/admin/affilies", label: "04 — Affiliés", key: "affilies" },
  { href: "/admin/commissions", label: "05 — Commissions", key: "commissions" },
  { href: "/admin/rendez-vous", label: "06 — Rendez-vous", key: "rdv" },
  { href: "/admin/contenus", label: "07 — Contenus", key: "contenus" },
  { href: "/admin/notifications", label: "08 — Notifications", key: "notifications" },
  { href: "/admin/statistiques", label: "09 — Statistiques", key: "stats" },
  { href: "/admin/parametres", label: "10 — Paramètres", key: "parametres" },
  { href: "/admin/marketing", label: "11 — Marketing", key: "marketing" },
  { href: "/admin/popups", label: "12 — Popups", key: "popups" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin } = await getUserRoles();

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-structure px-4 py-10 text-center">
        <Logo className="h-14 w-14" />
        <h1 className="mt-4 font-display text-2xl font-bold text-gray-900">Accès réservé</h1>
        <p className="mt-2 max-w-md text-sm text-gray-600">
          Cette zone est réservée aux administrateurs MORA Shawiri. Si vous êtes administrateur,
          votre compte doit disposer du rôle &laquo; ADMIN &raquo; ou &laquo; SUPER_ADMIN &raquo;.
        </p>
        <div className="mt-6">
          <Button href="/" variant="primary" size="md">Retour à l&apos;accueil</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 lg:flex">
      {/* Sidebar */}
      <aside className="w-full border-b border-gray-200 bg-white lg:min-h-screen lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 px-5 py-4">
          <Logo className="h-9 w-9" />
          <div>
            <p className="text-sm font-bold text-mora-blue">MORA Shawiri</p>
            <p className="text-[11px] text-gray-500">Administration</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 lg:flex-col lg:overflow-visible" aria-label="Administration">
          {modules.map((m) => (
            <Link
              key={m.key}
              href={m.href}
              className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-mora-blue-20 hover:text-mora-blue"
            >
              {m.label}
            </Link>
          ))}
        </nav>
        <div className="px-5 py-4">
          <form action={signOut}>
            <Button type="submit" variant="secondary" size="sm" className="w-full lg:w-auto">Se déconnecter</Button>
          </form>
        </div>
      </aside>

      {/* Contenu */}
      <div className="flex-1">{children}</div>
    </div>
  );
}
