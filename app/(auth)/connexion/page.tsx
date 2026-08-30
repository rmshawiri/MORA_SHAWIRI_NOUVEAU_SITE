"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { signIn } from "@/app/actions/auth";

export default function ConnexionPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setError(null);
    setPending(true);
    const result = await signIn(formData);
    if (result.error) {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <form action={onSubmit} className="surface-card animate-fade-up rounded-3xl p-6 sm:p-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-balance text-gray-900">
          Se connecter
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
          Accédez à votre espace MORA Shawiri.
        </p>
      </div>

      <div className="space-y-4">
        <Field label="Adresse email" htmlFor="connexion-email">
          <Input id="connexion-email" name="email" type="email" autoComplete="email" required placeholder="vous@exemple.com" />
        </Field>
        <Field label="Mot de passe" htmlFor="connexion-password">
          <Input id="connexion-password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
        </Field>
      </div>

      <div className="mt-5 flex justify-end">
        <Link href="/mot-de-passe-oublie" className="link-accent text-sm">Mot de passe oublié ?</Link>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-error-soft bg-error-soft px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      <div className="mt-6">
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending ? "Connexion..." : "Se connecter"}
        </Button>
      </div>

      <p className="mt-6 border-t border-gray-100 pt-5 text-center text-sm text-gray-600">
        Pas encore de compte ?{" "}
        <Link href="/inscription" className="link-accent">Créer un compte</Link>
      </p>
    </form>
  );
}
