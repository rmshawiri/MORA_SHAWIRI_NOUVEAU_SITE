import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";
import { siteConfig, absoluteUrl } from "@/lib/config";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contactez MORA Shawiri à Moroni, Union des Comores : WhatsApp, email ou via notre formulaire de contact.",
  alternates: { canonical: absoluteUrl("/contact") },
};

export default function ContactPage() {
  const { contact, social } = siteConfig;

  return (
    <div className="bg-gray-structure">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="max-w-2xl">
          <h1 className="font-display text-3xl font-bold text-gray-900 sm:text-4xl">Contactez-nous</h1>
          <p className="mt-3 text-gray-600">
            Une question, un projet, une demande de devis ou de rendez-vous ? MORA Shawiri est
            disponible pour vous accompagner.
          </p>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          {/* Coordonnées */}
          <div className="rounded-3xl bg-white p-8">
            <h2 className="font-display text-xl font-bold text-mora-blue">Nos coordonnées</h2>
            <dl className="mt-6 space-y-5 text-sm">
              <div>
                <dt className="font-semibold text-gray-700">WhatsApp</dt>
                <dd>
                  <a href={contact.whatsappUrl} className="text-mora-blue hover:underline">
                    {contact.phoneDisplay}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-700">Email</dt>
                <dd>
                  <a href={`mailto:${contact.email}`} className="text-mora-blue hover:underline">
                    {contact.email}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-700">Adresse</dt>
                <dd>{contact.address} — {contact.city}, {contact.country}</dd>
              </div>
            </dl>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button href={contact.whatsappUrl} variant="whatsapp" size="md">
                Discuter sur WhatsApp
              </Button>
              <Button href={`mailto:${contact.email}`} variant="secondary" size="md">
                Envoyer un email
              </Button>
            </div>
          </div>

          {/* Réseaux sociaux */}
          <div className="rounded-3xl bg-white p-8">
            <h2 className="font-display text-xl font-bold text-mora-blue">Suivez-nous</h2>
            <ul className="mt-6 space-y-3 text-sm">
              <li><a href={social.facebook} target="_blank" rel="noreferrer" className="text-gray-700 hover:text-mora-blue">Facebook</a></li>
              <li><a href={social.instagram} target="_blank" rel="noreferrer" className="text-gray-700 hover:text-mora-blue">Instagram</a></li>
              <li><a href={social.youtube} target="_blank" rel="noreferrer" className="text-gray-700 hover:text-mora-blue">YouTube</a></li>
              <li><a href={social.tiktok} target="_blank" rel="noreferrer" className="text-gray-700 hover:text-mora-blue">TikTok</a></li>
              <li><a href={social.linkedin} target="_blank" rel="noreferrer" className="text-gray-700 hover:text-mora-blue">LinkedIn</a></li>
              <li><a href={social.telegram} target="_blank" rel="noreferrer" className="text-gray-700 hover:text-mora-blue">Telegram</a></li>
            </ul>
            <p className="mt-6 text-xs text-gray-500">
              Vous pouvez aussi demander un devis ou prendre rendez-vous directement via les pages
              dédiées.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
