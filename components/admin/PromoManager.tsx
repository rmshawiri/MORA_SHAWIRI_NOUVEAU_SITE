"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
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

const card = "rounded-2xl border border-gray-100 bg-white p-6 shadow-soft";

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
      <div className={card}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-gray-900">{editingId ? "Modifier le code" : "Créer un code promo"}</h2>
          {editingId && <Badge tone="blue">Modification</Badge>}
        </div>
        <div className="mt-4 space-y-4">
          <Field label="Code" htmlFor="promo-code">
            <Input id="promo-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="Ex : SHAWIRI10" className="uppercase" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" htmlFor="promo-type">
              <Select id="promo-type" value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value as "percent" | "fixed" })}>
                <option value="percent">Pourcentage (%)</option>
                <option value="fixed">Montant (KMF)</option>
              </Select>
            </Field>
            <Field label={form.discount_type === "percent" ? "Valeur (%)" : "Valeur (KMF)"} htmlFor="promo-value">
              <Input id="promo-value" type="number" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-mora-blue focus:ring-mora-blue" />
            Actif
          </label>
          {error && <p className="rounded-xl bg-error-soft p-3 text-sm text-error">{error}</p>}
          <div className="flex gap-3">
            <Button onClick={save} variant="primary" size="md" disabled={pending}>{pending ? "Enregistrement..." : editingId ? "Enregistrer" : "Créer"}</Button>
            {editingId && <Button onClick={reset} variant="secondary" size="md">Annuler</Button>}
          </div>
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-gray-900">Codes promotionnels</h2>
          <Badge tone="neutral">{promos.length}</Badge>
        </div>
        {promos.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">Aucun code promo. Créez-en un.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {promos.map((p) => (
              <li key={p.id} className="rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-bold text-mora-blue">{p.code}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <Badge tone="neutral">
                        {p.discount_type === "percent" ? `${p.value} %` : `${p.value.toLocaleString("fr-FR")} KMF`}
                      </Badge>
                      <span>{p.used_count} utilisation(s)</span>
                      <Badge tone={p.is_active ? "success" : "warning"}>{p.is_active ? "Actif" : "Inactif"}</Badge>
                      {p.valid_until && <span>· jusqu&apos;au {new Date(p.valid_until).toLocaleDateString("fr-FR")}</span>}
                    </div>
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
