"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { becomeAffiliate, type BecomeAffiliateInput } from "@/app/actions/affiliate";
import { cn } from "@/lib/utils";

const categories: { id: BecomeAffiliateInput["category"]; label: string; desc: string; rate: string }[] = [
  { id: "particulier", label: "Particulier", desc: "Recommandations personnelles.", rate: "10 %" },
  { id: "influenceur", label: "Influenceur", desc: "Créateur de contenus / influenceur.", rate: "15 %" },
  { id: "equipe", label: "Équipe MORA Shawiri", desc: "Membre de l'équipe de la structure.", rate: "20 %" },
];

export function BecomeAffiliateForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState<BecomeAffiliateInput["category"]>("particulier");
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await becomeAffiliate({ category });
      if (res.error) setError(res.error);
      else if (res.code) {
        setCode(res.code);
        router.refresh();
      }
    });
  }

  if (code) {
    return (
      <div className="rounded-3xl bg-white p-8">
        <p className="font-display text-xl font-bold text-gray-900">Votre compte affilié est créé</p>
        <p className="mt-2 text-sm text-gray-600">Votre code affilié :</p>
        <p className="mt-2 font-mono text-lg font-bold text-mora-blue">{code}</p>
        <p className="mt-3 text-sm text-gray-500">
          Partagez votre lien : <code className="font-mono">{`${window.location.origin}/?ref=${code}`}</code>
        </p>
        <p className="mt-3 text-xs text-gray-500">
          Votre statut est « en attente » tant qu&apos;il n&apos;est pas validé par MORA Shawiri.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-white p-8">
      <h2 className="font-display text-xl font-bold text-gray-900">Devenir affilié</h2>
      <p className="mt-1 text-sm text-gray-600">Choisissez votre catégorie :</p>
      <div className="mt-4 space-y-2">
        {categories.map((c) => (
          <label
            key={c.id}
            className={cn(
              "flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3 text-sm transition-colors",
              category === c.id ? "border-mora-blue bg-mora-blue-20" : "border-gray-200 hover:border-mora-blue",
            )}
          >
            <span className="flex items-center gap-2">
              <input type="radio" name="category" value={c.id} checked={category === c.id} onChange={() => setCategory(c.id)} className="sr-only" />
              <span>
                <span className="font-semibold text-gray-800">{c.label}</span>
                <span className="block text-xs text-gray-500">{c.desc}</span>
              </span>
            </span>
            <span className="font-bold text-mora-blue">{c.rate}</span>
          </label>
        ))}
      </div>
      {error && <p className="mt-4 rounded-xl bg-error-soft p-3 text-sm text-error">{error}</p>}
      <div className="mt-5">
        <Button onClick={submit} variant="primary" size="md" className="w-full" disabled={pending}>
          {pending ? "Création..." : "Créer mon compte affilié"}
        </Button>
      </div>
    </div>
  );
}
