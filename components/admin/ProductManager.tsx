"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
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

const productTone: Record<string, "success" | "warning" | "neutral" | "info"> = {
  published: "success",
  available: "success",
  draft: "neutral",
  unavailable: "warning",
  archived: "neutral",
};

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
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-soft">
        <h2 className="font-display text-lg font-bold text-gray-900">{editingId ? "Modifier le produit" : "Ajouter un produit"}</h2>
        <div className="mt-4 space-y-4">
          <Field label="Nom">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nom du produit" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prix (KMF)">
              <Input type="number" min={0} value={form.price ?? 0} onChange={(e) => setForm({ ...form, price: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Type">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ProductInput["type"] })}>
                <option value="digital">Numérique</option>
                <option value="physical">Physique</option>
                <option value="service">Service</option>
                <option value="pack">Pack</option>
              </Select>
            </Field>
          </div>
          <Field label="Statut">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProductInput["status"] })}>
              <option value="draft">Brouillon</option>
              <option value="published">Publié</option>
              <option value="available">Disponible</option>
              <option value="unavailable">Indisponible</option>
              <option value="archived">Archivé</option>
            </Select>
          </Field>
          {error && <p className="rounded-xl bg-error-soft p-3 text-sm text-error">{error}</p>}
          <div className="flex gap-3">
            <Button onClick={save} variant="primary" size="md" disabled={pending}>{pending ? "Enregistrement..." : editingId ? "Enregistrer" : "Ajouter"}</Button>
            {editingId && <Button onClick={reset} variant="secondary" size="md">Annuler</Button>}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-soft">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-gray-900">Produits</h2>
          <Badge tone="neutral">{products.length}</Badge>
        </div>
        {products.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">Aucun produit en base. La boutique affiche actuellement un état vide (produits « à venir »).</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {products.map((p) => (
              <li key={p.id} className="rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800">{p.name}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-gray-600">
                      <span className="font-semibold text-mora-blue tabular-nums">{eur(p.price)}</span>
                      <span aria-hidden>·</span>
                      <span className="capitalize">{p.type}</span>
                      <Badge tone={productTone[p.status] ?? "neutral"}>
                        <span className="capitalize">{p.status}</span>
                      </Badge>
                    </div>
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
