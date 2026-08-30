import { createAdminClient } from "@/lib/supabase/admin";
import { ProductManager } from "@/components/admin/ProductManager";
import { AdminPage } from "@/components/admin/AdminPage";

export const metadata = { title: "Produits — Administration", robots: { index: false, follow: false } };

export default async function AdminProduitsPage() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("products")
    .select("id, name, price, type, status, stock_quantity")
    .order("created_at", { ascending: false })
    .limit(200);

  const products = (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    type: p.type,
    status: p.status,
    stock_quantity: p.stock_quantity,
  }));

  return (
    <AdminPage
      icon="▤"
      title="01 — Gestion des produits"
      subtitle="Produits de la boutique. Ajoutez, modifiez ou supprimez — un produit publié apparaît sur la boutique."
    >
      <ProductManager products={products} />
    </AdminPage>
  );
}
