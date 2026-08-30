import { services, priceLabel } from "@/lib/data/services";

export const metadata = { title: "Services — Administration", robots: { index: false, follow: false } };

export default function AdminServicesPage() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-gray-900">00 — Gestion des services</h1>
          <p className="mt-1 text-sm text-gray-500">Catalogue officiel des 14 services MORA Shawiri.</p>
        </div>
        <span className="rounded-full bg-mora-blue-20 px-3 py-1 text-xs font-medium text-mora-blue">
          {services.length} services
        </span>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">Catégorie</th>
              <th className="px-4 py-3">Tarif</th>
              <th className="px-4 py-3">Commande</th>
              <th className="px-4 py-3">Affiliation</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} className="border-b border-gray-50">
                <td className="px-4 py-3 font-medium text-gray-800">{s.name}</td>
                <td className="px-4 py-3 text-gray-600">{s.category}</td>
                <td className="px-4 py-3 font-semibold text-mora-blue">{priceLabel(s)}</td>
                <td className="px-4 py-3 text-gray-600">{s.directPurchase ? "Directe" : "Devis"}</td>
                <td className="px-4 py-3 text-gray-600">{s.affiliateEligible ? "Oui" : "Non"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-gray-500">
        Liste de référence issue du catalogue officiel. La gestion complète (création, publication,
        prix, images, SEO) sera disponible via la base de données — un service ajouté ici est ensuite
        visible sur le site.
      </p>
    </div>
  );
}
