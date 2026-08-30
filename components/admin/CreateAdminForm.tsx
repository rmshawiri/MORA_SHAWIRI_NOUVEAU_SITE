"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { createAdmin } from "@/app/actions/admins";
import { cn } from "@/lib/utils";

export function CreateAdminForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [role, setRole] = useState<"ADMIN" | "SUPER_ADMIN">("ADMIN");

  function submit(formData: FormData) {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await createAdmin({
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        role,
      });
      if (res.error) setError(res.error);
      else {
        setSuccess(true);
        router.refresh();
      }
    });
  }

  return (
    <form action={submit} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-soft">
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-mora-or-soft text-xl text-mora-or-deep ring-1 ring-mora-or-soft">
          🔐
        </span>
        <div>
          <Badge tone="gold">Super administrateur</Badge>
          <h2 className="mt-2 font-display text-lg font-bold text-gray-900">Créer un administrateur</h2>
          <p className="mt-1 text-sm text-gray-500">Réservé au super administrateur.</p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <Field label="Nom">
          <Input name="name" required placeholder="Nom complet" />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" required placeholder="admin@morashawiri.com" />
        </Field>
        <Field label="Mot de passe" hint="Au moins 8 caractères.">
          <Input name="password" type="password" required minLength={8} placeholder="••••••••" />
        </Field>
        <Field label="Rôle">
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(["ADMIN", "SUPER_ADMIN"] as const).map((r) => (
              <label
                key={r}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm transition-all",
                  role === r ? "border-mora-blue bg-mora-blue-10 text-mora-blue shadow-soft" : "border-gray-200 hover:border-mora-blue-40",
                )}
              >
                <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />
                {r === "ADMIN" ? "Administrateur" : "Super administrateur"}
              </label>
            ))}
          </div>
        </Field>
      </div>

      {error && <p className="mt-4 rounded-xl bg-error-soft p-3 text-sm text-error">{error}</p>}
      {success && <p className="mt-4 rounded-xl border border-success-soft bg-success-soft p-3 text-sm text-success">Administrateur créé avec succès.</p>}

      <div className="mt-6">
        <Button type="submit" variant="primary" size="md" className="w-full" disabled={pending}>
          {pending ? "Création..." : "Créer l'administrateur"}
        </Button>
      </div>
    </form>
  );
}
