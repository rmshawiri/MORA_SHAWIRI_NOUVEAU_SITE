import { getUserRoles } from "@/lib/rbac";
import { AdminShell } from "@/components/admin/AdminShell";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin } = await getUserRoles();

  if (!isAdmin) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-10 text-center">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-mora-gradient" />
        <div className="relative">
          <div className="mx-auto w-fit rounded-full bg-white p-2 shadow-lift">
            <Logo className="h-14 w-14" />
          </div>
          <h1 className="mt-5 font-display text-2xl font-bold text-gray-900">Accès réservé</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
            Cette zone est réservée aux administrateurs MORA Shawiri. Si vous êtes administrateur,
            votre compte doit disposer du rôle &laquo; ADMIN &raquo; ou &laquo; SUPER_ADMIN &raquo;.
          </p>
          <div className="mt-6">
            <Button href="/" variant="primary" size="md">Retour à l&apos;accueil</Button>
          </div>
        </div>
      </div>
    );
  }

  return <AdminShell>{children}</AdminShell>;
}
