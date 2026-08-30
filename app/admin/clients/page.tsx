import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Clients — Administration", robots: { index: false, follow: false } };

export default async function AdminClientsPage() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, username, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const clients = data ?? [];

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl font-bold text-gray-900">03 — Gestion des clients</h1>
      <p className="mt-1 text-sm text-gray-500">Comptes clients de la plateforme.</p>

      {clients.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="font-semibold text-gray-800">Aucun client pour le moment</p>
          <p className="mt-2 text-sm text-gray-500">Les comptes créés via l&apos;inscription apparaîtront ici.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Identifiant</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-b border-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{c.username ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.email}</td>
                  <td className="px-4 py-3 text-gray-600">{c.status}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(c.created_at).toLocaleDateString("fr-FR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
