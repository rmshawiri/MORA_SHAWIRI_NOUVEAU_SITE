import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles } from "@/lib/rbac";
import { CreateAdminForm } from "@/components/admin/CreateAdminForm";
import { AdminPage } from "@/components/admin/AdminPage";
import { AdminTable, AdminRow, AdminCell } from "@/components/admin/AdminTable";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusPill } from "@/components/ui/StatusPill";

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
    <AdminPage icon="◉" title="Administrateurs" subtitle="Gestion des comptes administrateurs et de leurs rôles.">
      {admins.length === 0 ? (
        <EmptyState
          icon={<span aria-hidden className="text-2xl">🔐</span>}
          title="Aucun administrateur"
          description="Les comptes administrateurs apparaîtront ici."
        />
      ) : (
        <AdminTable headers={["Identifiant", "Email", "Rôle", "Statut"]}>
          {admins.map((a) => (
            <AdminRow key={a.id}>
              <AdminCell className="font-medium text-gray-800">{a.username ?? "—"}</AdminCell>
              <AdminCell>{a.email}</AdminCell>
              <AdminCell>
                <div className="flex flex-wrap gap-1.5">
                  {a.roles.map((r) => (
                    <Badge key={r} tone={r === "SUPER_ADMIN" ? "gold" : "blue"}>{r}</Badge>
                  ))}
                </div>
              </AdminCell>
              <AdminCell>{a.status ? <StatusPill status={a.status} /> : "—"}</AdminCell>
            </AdminRow>
          ))}
        </AdminTable>
      )}

      {isSuperAdmin ? (
        <div className="mt-8 max-w-xl">
          <CreateAdminForm />
        </div>
      ) : (
        <p className="mt-6 rounded-xl bg-gray-100 p-3 text-sm text-gray-500">
          Seul le super administrateur peut créer ou modifier des administrateurs.
        </p>
      )}
    </AdminPage>
  );
}
