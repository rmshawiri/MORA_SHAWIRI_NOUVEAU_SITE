"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { createFaq, updateFaq, deleteFaq, type FaqInput } from "@/app/actions/contenus";

interface FaqRow {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  is_active: boolean;
}

export function FaqManager({ faqs }: { faqs: FaqRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FaqInput>({ question: "", answer: "", category: "Général", is_active: true });

  function reset() {
    setEditingId(null);
    setForm({ question: "", answer: "", category: "Général", is_active: true });
    setError(null);
  }

  function save() {
    if (editingId) {
      startTransition(async () => {
        const r = await updateFaq(editingId, form);
        if (r.error) setError(r.error);
        else { reset(); router.refresh(); }
      });
    } else {
      startTransition(async () => {
        const r = await createFaq(form);
        if (r.error) setError(r.error);
        else { reset(); router.refresh(); }
      });
    }
  }

  function remove(id: string) {
    if (!confirm("Supprimer cette question ?")) return;
    startTransition(async () => {
      const r = await deleteFaq(id);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  function edit(row: FaqRow) {
    setEditingId(row.id);
    setForm({ question: row.question, answer: row.answer, category: row.category ?? "Général", is_active: row.is_active });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Formulaire */}
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold text-gray-900">
          {editingId ? "Modifier la question" : "Ajouter une question"}
        </h2>
        <div className="mt-4 space-y-4">
          <label className="block text-sm font-medium text-gray-700">Question
            <textarea value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} rows={2} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none" />
          </label>
          <label className="block text-sm font-medium text-gray-700">Réponse
            <textarea value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} rows={3} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-gray-700">Catégorie
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none" />
            </label>
            <label className="flex items-end gap-2 pb-3 text-sm text-gray-700">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Visible (publié)
            </label>
          </div>
          {error && <p className="rounded-xl bg-error-soft p-3 text-sm text-error">{error}</p>}
          <div className="flex gap-3">
            <Button onClick={save} variant="primary" size="md" disabled={pending}>
              {pending ? "Enregistrement..." : editingId ? "Enregistrer" : "Ajouter"}
            </Button>
            {editingId && <Button onClick={reset} variant="secondary" size="md">Annuler</Button>}
          </div>
        </div>
      </div>

      {/* Liste */}
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold text-gray-900">Questions ({faqs.length})</h2>
        {faqs.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">Aucune question. Ajoutez-en une.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {faqs.map((f) => (
              <li key={f.id} className="rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-800">{f.question}</p>
                    <p className="mt-1 text-sm text-gray-600 line-clamp-2">{f.answer}</p>
                    <p className="mt-2 text-xs text-gray-400">
                      {f.category ?? "Général"} · {f.is_active ? "publié" : "masqué"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => edit(f)} variant="secondary" size="sm">Modifier</Button>
                    <Button onClick={() => remove(f.id)} variant="danger" size="sm">Supprimer</Button>
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
