"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { createPromo, updatePromo, deletePromo, type PromoInput } from "@/app/actions/marketing";

interface PromoRow {
  id: string;
  code: string;
  discount_type: string;
  value: number;
  is_active: boolean;
  used_count: number;
  valid_until: string | null;
}

export function PromoManager({ promos }: { promos: PromoRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<PromoInput>({ code: "", discount_type: "percent", value: 10, is_active: true });

  function reset() {
    setEditingId(null);
    setForm({ code: "", discount_type: "percent", value: 10, is_active: true });
    setError(null);
  }
  function save() {
    const fn = editingId ? updatePromo(editingId, form) : createPromo(form);
    startTransition(async () => {
      const r = await fn;
      if (r.error) setError(r.error); else { reset(); router.refresh(); }
    });
  }
  function remove(id: string) {
    if (!confirm("Supprimer ce code promo ?")) return;
    startTransition(async () => {
      const r = await deletePromo(id);
      if (r.error) setError(r.error); else router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold text-gray-900">{editingId ? "Modifier le code" : "Créer un code promo"}</h2>
        <div className="mt-4 space-y-4">
          <label className="block text-sm font-medium text-gray-700">Code
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="Ex: SHAWIRI10" className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm uppercase focus:border-mora-blue focus:outline-none" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-gray-700">Type
              <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value as "percent" | "fixed" })} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none">
                <option value="percent">Pourcentage (%)</option>
                <option value="fixed">Montant (KMF)</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-gray-700">{form.discount_type === "percent" ? "Valeur (%)" : "Valeur (KMF)"}
              <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) || 0 })} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Actif
          </label>
          {error && <p className="rounded-xl bg-error-soft p-3 text-sm text-error">{error}</p>}
          <div className="flex gap-3">
            <Button onClick={save} variant="primary" size="md" disabled={pending}>{pending ? "Enregistrement..." : editingId ? "Enregistrer" : "Créer"}</Button>
            {editingId && <Button onClick={reset} variant="secondary" size="md">Annuler</Button>}
          </div>
        </div>
      </div>

      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold text-gray-900">Codes promotionnels ({promos.length})</h2>
        {promos.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">Aucun code promo. Créez-en un.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {promos.map((p) => (
              <li key={p.id} className="rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm font-bold text-mora-blue">{p.code}</p>
                    <p className="mt-1 text-sm text-gray-600">
                      {p.discount_type === "percent" ? `${p.value} %` : `${p.value.toLocaleString("fr-FR")} KMF`} · {p.used_count} utilisation(s) · {p.is_active ? "actif" : "inactif"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => { setEditingId(p.id); setForm({ code: p.code, discount_type: p.discount_type as "percent" | "fixed", value: p.value, is_active: p.is_active }); }} variant="secondary" size="sm">Modifier</Button>
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
