import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Affiliés — Administration", robots: { index: false, follow: false } };

const catLabel: Record<string, string> = {
  particulier: "Particulier",
  influenceur: "Influenceur",
  equipe: "Équipe MORA Shawiri",
};

export default async function AdminAffiliesPage() {
  const supabase = createAdminClient();
  const { data: affiliates } = await supabase
    .from("affiliates")
    .select("id, category, code, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const list = affiliates ?? [];

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl font-bold text-gray-900">04 — Gestion des affiliés</h1>
      <p className="mt-1 text-sm text-gray-500">Comptes affiliés, catégories et statuts.</p>

      {list.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="font-semibold text-gray-800">Aucun affilié pour le moment</p>
          <p className="mt-2 text-sm text-gray-500">
            Les personnes rejoignant le programme d&apos;affiliation apparaîtront ici.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Catégorie</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className="border-b border-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-mora-blue">{a.code}</td>
                  <td className="px-4 py-3 text-gray-600">{catLabel[a.category] ?? a.category}</td>
                  <td className="px-4 py-3 text-gray-600">{a.status}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(a.created_at).toLocaleDateString("fr-FR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
