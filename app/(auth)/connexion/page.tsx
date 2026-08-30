"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
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
    <form action={onSubmit} className="rounded-3xl bg-white p-8 shadow-sm">
      <h1 className="font-display text-2xl font-bold text-gray-900">Se connecter</h1>
      <p className="mt-1 text-sm text-gray-500">Accédez à votre espace MORA Shawiri.</p>

      <div className="mt-6 space-y-4">
        <label className="block text-sm font-medium text-gray-700">
          Adresse email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none"
          />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Mot de passe
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none"
          />
        </label>
      </div>

      {error && <p className="mt-4 rounded-xl bg-error-soft p-3 text-sm text-error">{error}</p>}

      <div className="mt-6">
        <Button type="submit" variant="primary" size="md" className="w-full" disabled={pending}>
          {pending ? "Connexion..." : "Se connecter"}
        </Button>
      </div>

      <div className="mt-4 flex flex-col gap-1 text-sm text-gray-600">
        <Link href="/mot-de-passe-oublie" className="text-mora-blue hover:underline">
          Mot de passe oublié ?
        </Link>
        <span>
          Pas encore de compte ?{" "}
          <Link href="/inscription" className="text-mora-blue hover:underline">
            Créer un compte
          </Link>
        </span>
      </div>
    </form>
  );
}
