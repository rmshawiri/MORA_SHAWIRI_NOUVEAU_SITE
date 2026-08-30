import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles } from "@/lib/rbac";
import { CreateAdminForm } from "@/components/admin/CreateAdminForm";

export const metadata = { title: "Administrateurs — Administration", robots: { index: false, follow: false } };

const ADMIN_NAMES = new Set(["ADMIN", "SUPER_ADMIN"]);

export default async function AdminAdministrateursPage() {
  const supabase = createAdminClient();
  const { isSuperAdmin } = await getUserRoles();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, username, status, user_roles(roles(name))")
    .limit(200);

  const admins = (profiles ?? [])
    .map((p: { id: string; email: string | null; username: string | null; status: string | null; user_roles?: Array<{ roles?: { name: string } | { name: string }[] | null }> }) => {
      const roles = (p.user_roles ?? [])
        .flatMap((r) => {
          const v = r.roles as { name: string } | { name: string }[] | null;
          if (!v) return [];
          return Array.isArray(v) ? v.map((x) => x.name) : [v.name];
        });
      return { ...p, roles };
    })
    .filter((p) => p.roles.some((r) => ADMIN_NAMES.has(r)));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-gray-900">Administrateurs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Gestion des comptes administrateurs et de leurs rôles.
          </p>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Identifiant</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Rôle</th>
              <th className="px-4 py-3">Statut</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id} className="border-b border-gray-50">
                <td className="px-4 py-3 font-medium text-gray-800">{a.username ?? "—"}</td>
                <td className="px-4 py-3 text-gray-600">{a.email}</td>
                <td className="px-4 py-3">
                  {a.roles.map((r) => (
                    <span key={r} className="mr-1 rounded-full bg-mora-blue-20 px-2 py-0.5 text-xs font-medium text-mora-blue">
                      {r}
                    </span>
                  ))}
                </td>
                <td className="px-4 py-3 text-gray-600">{a.status ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isSuperAdmin ? (
        <div className="mt-8 max-w-xl">
          <CreateAdminForm />
        </div>
      ) : (
        <p className="mt-6 rounded-xl bg-gray-100 p-3 text-sm text-gray-500">
          Seul le super administrateur peut créer ou modifier des administrateurs.
        </p>
      )}
    </div>
  );
}
