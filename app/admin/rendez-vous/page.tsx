import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Rendez-vous — Administration", robots: { index: false, follow: false } };

export default async function AdminRdvPage() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("appointments")
    .select("id, starts_at, ends_at, status, notes, services(name)")
    .order("starts_at", { ascending: false })
    .limit(200);

  const list = data ?? [];

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl font-bold text-gray-900">06 — Gestion des rendez-vous</h1>
      <p className="mt-1 text-sm text-gray-500">Réservations et statuts.</p>

      {list.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="font-semibold text-gray-800">Aucun rendez-vous</p>
          <p className="mt-2 text-sm text-gray-500">Les prises de rendez-vous apparaîtront ici.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Statut</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className="border-b border-gray-50">
                  <td className="px-4 py-3 text-gray-600">{new Date(a.starts_at).toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-3 text-gray-800">
                    {(Array.isArray(a.services) ? a.services[0] : a.services)?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
