"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { signUp } from "@/app/actions/auth";

export default function InscriptionPage() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setError(null);
    setPending(true);
    const result = await signUp(formData);
    if (result.error) {
      setError(result.error);
      setPending(false);
    } else if (result.success) {
      setSuccess(true);
      setPending(false);
    }
  }

  return (
    <form action={onSubmit} className="surface-card animate-fade-up rounded-3xl p-6 sm:p-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-balance text-gray-900">
          Créer un compte
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
          Rejoignez l&apos;espace MORA Shawiri.
        </p>
      </div>

      <div className="space-y-4">
        <Field label="Nom complet" htmlFor="inscription-nom">
          <Input id="inscription-nom" name="name" type="text" autoComplete="name" placeholder="Votre nom complet" />
        </Field>
        <Field label="Adresse email" htmlFor="inscription-email">
          <Input id="inscription-email" name="email" type="email" autoComplete="email" required placeholder="vous@exemple.com" />
        </Field>
        <Field label="Mot de passe" htmlFor="inscription-password" hint="Au moins 8 caractères.">
          <Input id="inscription-password" name="password" type="password" autoComplete="new-password" required minLength={8} placeholder="••••••••" />
        </Field>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-error-soft bg-error-soft px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}
      {success && (
        <div role="status" className="mt-4 rounded-xl border border-success-soft bg-success-soft p-4 text-sm">
          <p className="font-semibold text-success">Compte créé.</p>
          <p className="mt-1 text-gray-700">
            Vérifiez votre boîte mail pour confirmer votre adresse email, puis connectez-vous.
          </p>
        </div>
      )}

      <div className="mt-6">
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending ? "Création..." : "Créer mon compte"}
        </Button>
      </div>

      <p className="mt-6 border-t border-gray-100 pt-5 text-center text-sm text-gray-600">
        Déjà un compte ?{" "}
        <Link href="/connexion" className="link-accent">Se connecter</Link>
      </p>
    </form>
  );
}
