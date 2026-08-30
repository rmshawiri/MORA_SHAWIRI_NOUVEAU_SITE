"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { siteConfig } from "@/lib/config";

/**
 * Formulaire de contact MORA Shawiri (client).
 * Aucune donnée inventée : il compose un message pré-rempli vers WhatsApp
 * (ou une boîte mail) à partir des coordonnées réelles de `siteConfig.contact`.
 * Le champ message libre est conservé (obligatoire).
 */
export function ContactForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length >= 2 && message.trim().length >= 5;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setError("Merci de renseigner votre nom et un message (au moins 5 caractères).");
      return;
    }
    setError(null);

    // Message pré-rempli vers WhatsApp (données réelles de la config).
    const text = `Bonjour MORA Shawiri,\n\nJe suis ${name.trim()}.${phone.trim() ? `\nTéléphone : ${phone.trim()}.` : ""}${
      email.trim() ? `\nEmail : ${email.trim()}.` : ""
    }\n\n${message.trim()}`;

    const waUrl = `https://wa.me/${siteConfig.contact.whatsappNumber}?text=${encodeURIComponent(text)}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <form onSubmit={submit} className="surface-card rounded-3xl p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-2xl bg-mora-blue-20 text-mora-blue">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </span>
        <h2 className="font-display text-xl font-bold text-mora-blue">Écrivez-nous</h2>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-gray-600">
        Une question ou un projet ? Remplissez ce court message : il sera pré-rempli vers notre
        WhatsApp, pour une réponse rapide. Vous pouvez aussi nous écrire par email.
      </p>

      <div className="mt-6 space-y-4">
        <Field label="Nom" htmlFor="contact-nom">
          <Input
            id="contact-nom"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder="Votre nom complet"
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Téléphone / WhatsApp (facultatif)" htmlFor="contact-tel">
            <Input
              id="contact-tel"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              placeholder="+269 …"
            />
          </Field>
          <Field label="Email (facultatif)" htmlFor="contact-email">
            <Input
              id="contact-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="vous@exemple.com"
            />
          </Field>
        </div>
        <Field label="Message" htmlFor="contact-message">
          <Textarea
            id="contact-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="Décrivez votre demande ou votre projet."
            required
          />
        </Field>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-error-soft px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button type="submit" variant="primary" size="md" disabled={!valid}>
          Envoyer via WhatsApp
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={() =>
            router.push(
              `mailto:${siteConfig.contact.email}?subject=${encodeURIComponent(
                `Contact — ${name.trim() || "Nouvelle demande"}`,
              )}&body=${encodeURIComponent(message.trim())}`,
            )
          }
        >
          Envoyer par email
        </Button>
      </div>
    </form>
  );
}
