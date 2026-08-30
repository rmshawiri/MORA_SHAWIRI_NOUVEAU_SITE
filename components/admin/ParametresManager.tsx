"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { updateSettings, type SettingsInput } from "@/app/actions/settings";

const FIELDS: { key: keyof SettingsInput; label: string }[] = [
  { key: "site_name", label: "Nom du site" },
  { key: "site_slogan", label: "Slogan" },
  { key: "site_url", label: "URL du site (canonique)" },
  { key: "site_email", label: "Email de contact" },
  { key: "site_phone", label: "Téléphone" },
  { key: "site_whatsapp", label: "Lien WhatsApp" },
  { key: "site_address", label: "Adresse" },
];

export function ParametresManager({ initial }: { initial: Partial<Record<string, string>> }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState<SettingsInput>({ ...(initial as SettingsInput) });

  function save() {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const r = await updateSettings(form);
      if (r.error) setError(r.error); else { setSuccess(true); router.refresh(); }
    });
  }

  async function restore(file: File) {
    setError(null);
    setRestoring(true);
    try {
      const res = await fetch("/api/backup", { method: "POST", body: file });
      const j = await res.json();
      if (!res.ok) setError(j.error || "Échec de la restauration.");
      else { router.refresh(); router.push(pathname); }
    } catch {
      setError("Échec de la restauration.");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Paramètres */}
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold text-gray-900">Paramètres du site</h2>
        <div className="mt-4 space-y-4">
          {FIELDS.map((f) => (
            <label key={f.key} className="block text-sm font-medium text-gray-700">{f.label}
              <input
                value={(form[f.key] as string) ?? ""}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-mora-blue focus:outline-none"
              />
            </label>
          ))}
          {error && <p className="rounded-xl bg-error-soft p-3 text-sm text-error">{error}</p>}
          {success && <p className="rounded-xl bg-success-soft p-3 text-sm text-success">Paramètres enregistrés.</p>}
          <Button onClick={save} variant="primary" size="md" disabled={pending}>
            {pending ? "Enregistrement..." : "Enregistrer"}
          </Button>
        </div>
      </div>

      {/* Sauvegarde / Restauration */}
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold text-gray-900">Sauvegarde &amp; restauration</h2>
        <p className="mt-2 text-sm text-gray-500">
          Exportez une sauvegarde JSON de la configuration et des contenus. La restauration effectue
          une sauvegarde de sécurité préalable (journalisée) puis réapplique les données.
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <a href="/api/backup" download>
            <Button variant="primary" size="md" className="w-full">⬇ Exporter (JSON)</Button>
          </a>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 px-4 py-6 text-center">
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) restore(f);
              }}
            />
            <span className="text-sm font-medium text-mora-blue">{restoring ? "Restauration..." : "Restaurer depuis un fichier JSON"}</span>
          </label>
          <p className="text-xs text-gray-400">
            La restauration est réservée aux administrateurs autorisés et ne touche pas aux mots de
            passe ni aux secrets.
          </p>
        </div>
      </div>
    </div>
  );
}
