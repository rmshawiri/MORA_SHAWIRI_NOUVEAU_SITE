"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { resetPassword } from "@/app/actions/auth";

export default function MotDePasseOubliePage() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setError(null);
    setPending(true);
    const result = await resetPassword(formData);
    if (result.error) {
      setError(result.error);
      setPending(false);
    } else {
      setSuccess(true);
      setPending(false);
    }
  }

  return (
    <form action={onSubmit} className="rounded-3xl bg-white p-8 shadow-sm">
      <h1 className="font-display text-2xl font-bold text-gray-900">Mot de passe oublié</h1>
      <p className="mt-1 text-sm text-gray-500">
        Indiquez votre adresse email pour recevoir un lien de réinitialisation.
      </p>

      <div className="mt-6">
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
      </div>

      {error && <p className="mt-4 rounded-xl bg-error-soft p-3 text-sm text-error">{error}</p>}
      {success && (
        <p className="mt-4 rounded-xl bg-success-soft p-3 text-sm text-success">
          Si un compte existe avec cette adresse, un lien de réinitialisation a été envoyé.
        </p>
      )}

      <div className="mt-6">
        <Button type="submit" variant="primary" size="md" className="w-full" disabled={pending}>
          {pending ? "Envoi..." : "Envoyer le lien"}
        </Button>
      </div>

      <div className="mt-4 text-sm text-gray-600">
        <Link href="/connexion" className="text-mora-blue hover:underline">
          Retour à la connexion
        </Link>
      </div>
    </form>
  );
}
