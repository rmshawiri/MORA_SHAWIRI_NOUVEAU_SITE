"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
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
    <form action={onSubmit} className="rounded-3xl bg-white p-8 shadow-sm">
      <h1 className="font-display text-2xl font-bold text-gray-900">Créer un compte</h1>
      <p className="mt-1 text-sm text-gray-500">Rejoignez l&apos;espace MORA Shawiri.</p>

      <div className="mt-6 space-y-4">
        <label className="block text-sm font-medium text-gray-700">
          Nom complet
          <input
            name="name"
            type="text"
            autoComplete="name"
            className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none"
          />
        </label>
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
            autoComplete="new-password"
            required
            minLength={8}
            className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none"
          />
          <span className="mt-1 block text-xs text-gray-500">Au moins 8 caractères.</span>
        </label>
      </div>

      {error && <p className="mt-4 rounded-xl bg-error-soft p-3 text-sm text-error">{error}</p>}
      {success && (
        <div className="mt-4 rounded-xl bg-success-soft p-4 text-sm text-success">
          <p className="font-semibold">Compte créé.</p>
          <p className="mt-1 text-gray-700">
            Vérifiez votre boîte mail pour confirmer votre adresse email, puis connectez-vous.
          </p>
        </div>
      )}

      <div className="mt-6">
        <Button type="submit" variant="primary" size="md" className="w-full" disabled={pending}>
          {pending ? "Création..." : "Créer mon compte"}
        </Button>
      </div>

      <div className="mt-4 text-sm text-gray-600">
        Déjà un compte ?{" "}
        <Link href="/connexion" className="text-mora-blue hover:underline">
          Se connecter
        </Link>
      </div>
    </form>
  );
}
