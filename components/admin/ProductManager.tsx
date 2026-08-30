"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { createProduct, updateProduct, deleteProduct, type ProductInput } from "@/app/actions/produits";

interface ProductRow {
  id: string;
  name: string;
  price: number | null;
  type: string;
  status: string;
  stock_quantity: number | null;
}

const eur = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("fr-FR")} KMF`);

export function ProductManager({ products }: { products: ProductRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ProductInput>({ name: "", price: 0, type: "digital", status: "draft", affiliate_eligible: false });

  function reset() {
    setEditingId(null);
    setForm({ name: "", price: 0, type: "digital", status: "draft", affiliate_eligible: false });
    setError(null);
  }

  function save() {
    if (editingId) {
      startTransition(async () => {
        const r = await updateProduct(editingId, form);
        if (r.error) setError(r.error); else { reset(); router.refresh(); }
      });
    } else {
      startTransition(async () => {
        const r = await createProduct(form);
        if (r.error) setError(r.error); else { reset(); router.refresh(); }
      });
    }
  }

  function remove(id: string) {
    if (!confirm("Supprimer ce produit ?")) return;
    startTransition(async () => {
      const r = await deleteProduct(id);
      if (r.error) setError(r.error); else router.refresh();
    });
  }

  function edit(row: ProductRow) {
    setEditingId(row.id);
    setForm({ name: row.name, price: row.price, type: row.type as ProductInput["type"], status: row.status as ProductInput["status"], affiliate_eligible: false });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold text-gray-900">{editingId ? "Modifier le produit" : "Ajouter un produit"}</h2>
        <div className="mt-4 space-y-4">
          <label className="block text-sm font-medium text-gray-700">Nom
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-gray-700">Prix (KMF)
              <input type="number" min={0} value={form.price ?? 0} onChange={(e) => setForm({ ...form, price: Number(e.target.value) || 0 })} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none" />
            </label>
            <label className="block text-sm font-medium text-gray-700">Type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ProductInput["type"] })} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none">
                <option value="digital">Numérique</option>
                <option value="physical">Physique</option>
                <option value="service">Service</option>
                <option value="pack">Pack</option>
              </select>
            </label>
          </div>
          <label className="block text-sm font-medium text-gray-700">Statut
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProductInput["status"] })} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none">
              <option value="draft">Brouillon</option>
              <option value="published">Publié</option>
              <option value="available">Disponible</option>
              <option value="unavailable">Indisponible</option>
              <option value="archived">Archivé</option>
            </select>
          </label>
          {error && <p className="rounded-xl bg-error-soft p-3 text-sm text-error">{error}</p>}
          <div className="flex gap-3">
            <Button onClick={save} variant="primary" size="md" disabled={pending}>{pending ? "Enregistrement..." : editingId ? "Enregistrer" : "Ajouter"}</Button>
            {editingId && <Button onClick={reset} variant="secondary" size="md">Annuler</Button>}
          </div>
        </div>
      </div>

      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold text-gray-900">Produits ({products.length})</h2>
        {products.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">Aucun produit en base. La boutique affiche actuellement un état vide (produits « à venir »).</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {products.map((p) => (
              <li key={p.id} className="rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-800">{p.name}</p>
                    <p className="mt-1 text-sm text-gray-600">{eur(p.price)} · {p.type} · {p.status}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => edit(p)} variant="secondary" size="sm">Modifier</Button>
                    <Button onClick={() => remove(p.id)} variant="danger" size="sm">Supprimer</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
