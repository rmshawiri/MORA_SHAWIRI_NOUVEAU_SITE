"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
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
    <form action={submit} className="rounded-3xl bg-white p-6 shadow-sm">
      <h2 className="font-display text-lg font-bold text-gray-900">Créer un administrateur</h2>
      <p className="mt-1 text-sm text-gray-500">Réservé au super administrateur.</p>

      <div className="mt-5 space-y-4">
        <label className="block text-sm font-medium text-gray-700">Nom
          <input name="name" required className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none" />
        </label>
        <label className="block text-sm font-medium text-gray-700">Email
          <input name="email" type="email" required className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none" />
        </label>
        <label className="block text-sm font-medium text-gray-700">Mot de passe
          <input name="password" type="password" required minLength={8} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none" />
          <span className="mt-1 block text-xs text-gray-500">Au moins 8 caractères.</span>
        </label>
        <div className="block text-sm font-medium text-gray-700">Rôle
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(["ADMIN", "SUPER_ADMIN"] as const).map((r) => (
              <label key={r} className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm", role === r ? "border-mora-blue bg-mora-blue-20 text-mora-blue" : "border-gray-200")}>
                <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />
                {r === "ADMIN" ? "Administrateur" : "Super administrateur"}
              </label>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="mt-4 rounded-xl bg-error-soft p-3 text-sm text-error">{error}</p>}
      {success && <p className="mt-4 rounded-xl bg-success-soft p-3 text-sm text-success">Administrateur créé avec succès.</p>}

      <div className="mt-6">
        <Button type="submit" variant="primary" size="md" className="w-full" disabled={pending}>
          {pending ? "Création..." : "Créer l'administrateur"}
        </Button>
      </div>
    </form>
  );
}
