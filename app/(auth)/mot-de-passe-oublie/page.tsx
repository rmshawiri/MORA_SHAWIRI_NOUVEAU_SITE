"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
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
    <form action={onSubmit} className="surface-card animate-fade-up rounded-3xl p-6 sm:p-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-balance text-gray-900">
          Mot de passe oublié
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
          Indiquez votre adresse email pour recevoir un lien de réinitialisation.
        </p>
      </div>

      <Field label="Adresse email" htmlFor="oublie-email">
        <Input id="oublie-email" name="email" type="email" autoComplete="email" required placeholder="vous@exemple.com" />
      </Field>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-error-soft bg-error-soft px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mt-4 rounded-xl border border-success-soft bg-success-soft px-4 py-3 text-sm text-success">
          Si un compte existe avec cette adresse, un lien de réinitialisation a été envoyé.
        </p>
      )}

      <div className="mt-6">
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending ? "Envoi..." : "Envoyer le lien"}
        </Button>
      </div>

      <p className="mt-6 border-t border-gray-100 pt-5 text-center text-sm text-gray-600">
        <Link href="/connexion" className="link-accent">← Retour à la connexion</Link>
      </p>
    </form>
  );
}
