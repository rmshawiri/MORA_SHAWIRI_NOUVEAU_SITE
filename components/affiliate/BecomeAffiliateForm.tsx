"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
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
      <div className="surface-card rounded-3xl p-6 sm:p-8">
        <Badge tone="gold" dot>Compte affilié créé</Badge>
        <h2 className="mt-5 font-display text-2xl font-bold text-gray-900">Votre compte affilié est créé</h2>
        <p className="mt-2 text-sm text-gray-600">Votre code affilié :</p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-mora-blue-10 px-4 py-3">
          <code className="font-mono text-xl font-bold text-mora-blue">{code}</code>
        </div>
        <p className="mt-4 text-sm text-gray-500">
          Partagez votre lien : <code className="whitespace-nowrap font-mono text-xs text-mora-blue">{`${window.location.origin}/?ref=${code}`}</code>
        </p>
        <p className="mt-3 text-xs text-gray-500">
          Votre statut est « en attente » tant qu&apos;il n&apos;est pas validé par MORA Shawiri.
        </p>
      </div>
    );
  }

  return (
    <div className="surface-card rounded-3xl p-6 sm:p-8">
      <div className="flex items-center gap-2">
        <Badge tone="blue">Affiliation</Badge>
      </div>
      <h2 className="mt-4 font-display text-2xl font-bold text-gray-900">Devenir affilié</h2>
      <p className="mt-1 text-sm text-gray-600">Choisissez votre catégorie :</p>

      <div className="mt-5 space-y-2.5">
        {categories.map((c) => (
          <label
            key={c.id}
            className={cn(
              "group flex cursor-pointer items-center justify-between gap-4 rounded-xl border px-4 py-3.5 text-sm transition-all",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-mora-blue",
              category === c.id
                ? "border-mora-blue bg-mora-blue-10 shadow-soft"
                : "border-gray-200 hover:border-mora-blue-40 hover:bg-mora-blue-10/40",
            )}
          >
            <span className="flex items-center gap-3">
              <input type="radio" name="category" value={c.id} checked={category === c.id} onChange={() => setCategory(c.id)} className="sr-only" />
              <span
                aria-hidden
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  category === c.id ? "border-mora-blue" : "border-gray-300 group-hover:border-mora-blue-40",
                )}
              >
                {category === c.id && <span className="h-2.5 w-2.5 rounded-full bg-mora-blue" />}
              </span>
              <span>
                <span className="font-semibold text-gray-800">{c.label}</span>
                <span className="block text-xs text-gray-500">{c.desc}</span>
              </span>
            </span>
            <span className="shrink-0 font-display text-lg font-bold text-mora-blue">{c.rate}</span>
          </label>
        ))}
      </div>

      {error && <p className="mt-4 rounded-xl bg-error-soft p-3 text-sm text-error" role="alert">{error}</p>}

      <div className="mt-6">
        <Button onClick={submit} variant="primary" size="md" className="w-full" disabled={pending}>
          {pending ? "Création..." : "Créer mon compte affilié"}
        </Button>
      </div>
    </div>
  );
}
