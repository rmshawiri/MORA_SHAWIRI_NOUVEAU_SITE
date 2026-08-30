"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { createPopup, updatePopup, deletePopup, type PopupInput } from "@/app/actions/popups";

interface PopupRow {
  id: string;
  title: string;
  type: string;
  is_active: boolean;
  priority: number;
}

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
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold text-gray-900">{editingId ? "Modifier le popup" : "Créer un popup"}</h2>
        <div className="mt-4 space-y-4">
          <label className="block text-sm font-medium text-gray-700">Titre
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-gray-700">Type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as PopupInput["type"] })} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none">
                <option value="banner">Bannière</option>
                <option value="modal">Modale</option>
                <option value="announcement">Annonce</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-gray-700">Priorité
              <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 0 })} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none" />
            </label>
          </div>
          <label className="block text-sm font-medium text-gray-700">Contenu
            <textarea value={form.content ?? ""} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={3} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none" />
          </label>
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
        <h2 className="font-display text-lg font-bold text-gray-900">Popups ({popups.length})</h2>
        {popups.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">Aucun popup. Créez-en un.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {popups.map((p) => (
              <li key={p.id} className="rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-800">{p.title}</p>
                    <p className="mt-1 text-sm text-gray-600">{p.type} · priorité {p.priority} · {p.is_active ? "actif" : "inactif"}</p>
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
