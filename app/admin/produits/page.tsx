import { createAdminClient } from "@/lib/supabase/admin";
import { ProductManager } from "@/components/admin/ProductManager";

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
    <div className="p-6">
      <h1 className="font-display text-2xl font-bold text-gray-900">01 — Gestion des produits</h1>
      <p className="mt-1 text-sm text-gray-500">
        Produits de la boutique. Ajoutez, modifiez ou supprimez — un produit publié apparaît sur la boutique.
      </p>
      <div className="mt-6">
        <ProductManager products={products} />
      </div>
    </div>
  );
}
