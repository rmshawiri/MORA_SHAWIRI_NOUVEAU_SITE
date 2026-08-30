import { services, priceLabel } from "@/lib/data/services";
import { AdminPage } from "@/components/admin/AdminPage";
import { AdminTable, AdminRow, AdminCell } from "@/components/admin/AdminTable";
import { Badge } from "@/components/ui/Badge";

export const metadata = { title: "Services — Administration", robots: { index: false, follow: false } };

export default function AdminServicesPage() {
  return (
    <AdminPage
      icon="▣"
      title="00 — Gestion des services"
      subtitle="Catalogue officiel des 14 services MORA Shawiri."
      actions={<Badge tone="blue">{services.length} services</Badge>}
    >
      <AdminTable headers={["Service", "Catégorie", "Tarif", "Commande", "Affiliation"]}>
        {services.map((s) => (
          <AdminRow key={s.id}>
            <AdminCell className="font-medium text-gray-800">{s.name}</AdminCell>
            <AdminCell>{s.category}</AdminCell>
            <AdminCell className="font-semibold text-mora-blue">{priceLabel(s)}</AdminCell>
            <AdminCell>{s.directPurchase ? "Directe" : "Devis"}</AdminCell>
            <AdminCell>{s.affiliateEligible ? "Oui" : "Non"}</AdminCell>
          </AdminRow>
        ))}
      </AdminTable>

      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-mora-blue-10 bg-mora-blue-10/50 p-4 text-sm text-gray-600">
        <span aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-mora-blue ring-1 ring-mora-blue-20">
          i
        </span>
        <p className="leading-relaxed">
          Liste de référence issue du catalogue officiel. La gestion complète (création, publication,
          prix, images, SEO) sera disponible via la base de données — un service ajouté ici est ensuite
          visible sur le site.
        </p>
      </div>
    </AdminPage>
  );
}
