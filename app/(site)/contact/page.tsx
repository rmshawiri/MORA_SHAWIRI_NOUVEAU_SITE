import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ContactForm } from "@/app/(site)/contact/ContactForm";
import { siteConfig, absoluteUrl } from "@/lib/config";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contactez MORA Shawiri à Moroni, Union des Comores : WhatsApp, email ou via notre formulaire de contact.",
  alternates: { canonical: absoluteUrl("/contact") },
};

export default function ContactPage() {
  const { contact, social } = siteConfig;

  const methods = [
    { label: "WhatsApp", value: contact.phoneDisplay, href: contact.whatsappUrl, icon: "WA", note: "Réponse rapide" },
    { label: "Email", value: contact.email, href: `mailto:${contact.email}`, icon: "@", note: "Pour projets & partenariats" },
    { label: "Adresse", value: `${contact.address} — ${contact.city}, ${contact.country}`, icon: "📍", note: "Sur rendez-vous" },
  ];

  const socials = [
    { label: "Facebook", href: social.facebook },
    { label: "Instagram", href: social.instagram },
    { label: "YouTube", href: social.youtube },
    { label: "TikTok", href: social.tiktok },
    { label: "LinkedIn", href: social.linkedin },
    { label: "Telegram", href: social.telegram },
  ];

  return (
    <div className="bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 animate-fade-up">
        <SectionHeading
          eyebrow="Contact"
          title="Contactez-nous"
          description="Une question, un projet, une demande de devis ou de rendez-vous ? MORA Shawiri est disponible pour vous accompagner."
        />

        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          {/* Formulaire de contact */}
          <div>
            <ContactForm />
          </div>

          {/* Coordonnées */}
          <div className="grid gap-8">
            <div className="surface-card rounded-3xl p-8">
            <div className="flex items-center gap-3">
              <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-2xl bg-mora-blue-20 text-mora-blue">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6h16M4 12h16M4 18h10" />
                </svg>
              </span>
              <h2 className="font-display text-xl font-bold text-mora-blue">Nos coordonnées</h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              Réponse rapide sur WhatsApp, et email pour les projets et partenariats.
            </p>

            <div className="mt-6 space-y-3">
              {methods.map((m) => (
                <a
                  key={m.label}
                  href={m.href}
                  target={m.icon === "WA" ? "_blank" : undefined}
                  rel={m.icon === "WA" ? "noreferrer" : undefined}
                  className="card-lift group flex items-start gap-4 rounded-2xl border border-gray-100 bg-gray-50/70 p-4 hover:bg-white"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-mora-blue font-display text-sm font-bold text-mora-or">
                    {m.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-700">{m.label}</p>
                    <p className="truncate text-sm font-medium text-gray-900 group-hover:text-mora-blue">{m.value}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{m.note}</p>
                  </div>
                  <span aria-hidden className="ml-auto self-center text-mora-blue opacity-0 transition-opacity group-hover:opacity-100">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </span>
                </a>
              ))}
            </div>

            <div className="mt-7 flex flex-wrap gap-3">
              <Button href={contact.whatsappUrl} variant="whatsapp" size="md">Discuter sur WhatsApp</Button>
              <Button href={`mailto:${contact.email}`} variant="secondary" size="md">Envoyer un email</Button>
            </div>
          </div>

          {/* Réseaux sociaux */}
          <div className="surface-card rounded-3xl p-8">
            <div className="flex items-center gap-3">
              <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-2xl bg-mora-blue-20 text-mora-blue">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8a6 6 0 10-11.6 2.8L4 20l9.2-2.4A6 6 0 0018 8z" />
                </svg>
              </span>
              <h2 className="font-display text-xl font-bold text-mora-blue">Suivez-nous</h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              Actualités, offres et coulisses de MORA Shawiri sur nos réseaux.
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3">
              {socials.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  className="card-lift flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-mora-blue hover:text-white"
                >
                  <span aria-hidden className="font-display font-bold">{s.label.slice(0, 2).toUpperCase()}</span>
                  {s.label}
                </a>
              ))}
            </div>

            <div className="bg-mora-gradient bg-mora-grid mt-6 overflow-hidden rounded-3xl p-6 text-white">
              <p className="font-display text-lg font-bold">Un projet à lancer ?</p>
              <p className="mt-1 text-sm leading-relaxed text-blue-100/90">
                Demandez un devis ou prenez rendez-vous via les pages dédiées.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button href="/devis" variant="primary" size="sm">Demander un devis</Button>
                <Button href={contact.whatsappUrl} variant="ghost" size="sm" className="border border-white/25 text-white hover:bg-white/10">
                  Discuter sur WhatsApp
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
