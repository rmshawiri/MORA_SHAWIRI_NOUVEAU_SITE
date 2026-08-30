"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { createPopup, updatePopup, deletePopup, type PopupInput } from "@/app/actions/popups";

interface PopupRow {
  id: string;
  title: string;
  type: string;
  is_active: boolean;
  priority: number;
}

const card = "rounded-2xl border border-gray-100 bg-white p-6 shadow-soft";

export function PopupManager({ popups }: { popups: PopupRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<PopupInput>({ title: "", type: "banner", is_active: false, priority: 0 });

  function reset() { setEditingId(null); setForm({ title: "", type: "banner", is_active: false, priority: 0 }); setError(null); }
  function save() {
    const fn = editingId ? updatePopup(editingId, form) : createPopup(form);
    startTransition(async () => {
      const r = await fn;
      if (r.error) setError(r.error); else { reset(); router.refresh(); }
    });
  }
  function remove(id: string) {
    if (!confirm("Supprimer ce popup ?")) return;
    startTransition(async () => {
      const r = await deletePopup(id);
      if (r.error) setError(r.error); else router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className={card}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-gray-900">{editingId ? "Modifier le popup" : "Créer un popup"}</h2>
          {editingId && <Badge tone="blue">Modification</Badge>}
        </div>
        <div className="mt-4 space-y-4">
          <Field label="Titre" htmlFor="popup-title">
            <Input id="popup-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex : Offre de bienvenue" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" htmlFor="popup-type">
              <Select id="popup-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as PopupInput["type"] })}>
                <option value="banner">Bannière</option>
                <option value="modal">Modale</option>
                <option value="announcement">Annonce</option>
              </Select>
            </Field>
            <Field label="Priorité" htmlFor="popup-priority">
              <Input id="popup-priority" type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          <Field label="Contenu" htmlFor="popup-content">
            <Textarea id="popup-content" value={form.content ?? ""} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={3} />
          </Field>
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
          <h2 className="font-display text-lg font-bold text-gray-900">Popups</h2>
          <Badge tone="neutral">{popups.length}</Badge>
        </div>
        {popups.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">Aucun popup. Créez-en un.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {popups.map((p) => (
              <li key={p.id} className="rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-800">{p.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <Badge tone="neutral">{p.type}</Badge>
                      <span>priorité {p.priority}</span>
                      <Badge tone={p.is_active ? "success" : "warning"}>{p.is_active ? "Actif" : "Inactif"}</Badge>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => { setEditingId(p.id); setForm({ title: p.title, type: p.type as PopupInput["type"], is_active: p.is_active, priority: p.priority }); }} variant="secondary" size="sm">Modifier</Button>
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
