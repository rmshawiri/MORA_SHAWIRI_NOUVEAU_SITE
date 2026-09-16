'use client';

import { useRef, useState } from 'react';
import { Whatsapp } from '@/components/ui/Icon';
import { site, whatsappLink } from '@/lib/site';

const SUBJECTS = [
  { value: 'Site vitrine', label: 'Site vitrine professionnel' },
  { value: 'Boutique e-commerce', label: 'Boutique en ligne' },
  { value: 'Identité visuelle / logo', label: 'Identité visuelle ou logo' },
  { value: 'Visuels produits', label: 'Visuels produits / marketplace' },
  { value: 'Marketing digital et SEO', label: 'Marketing digital et référencement' },
  { value: 'Gestion documentaire / données', label: 'Gestion documentaire ou saisie de données' },
  { value: 'Audit stratégique', label: 'Audit stratégique' },
  { value: 'Formation', label: 'Formation professionnelle' },
  { value: 'Programme d’affiliation', label: 'Programme d’affiliation' },
  { value: 'Autre demande', label: 'Autre demande' },
];

const BUDGETS = [
  { value: '', label: 'À définir ensemble' },
  { value: 'moins de 200 000 KMF', label: 'Moins de 200 000 KMF' },
  { value: '200 000 à 500 000 KMF', label: '200 000 à 500 000 KMF' },
  { value: '500 000 à 1 500 000 KMF', label: '500 000 à 1 500 000 KMF' },
  { value: 'plus de 1 500 000 KMF', label: 'Plus de 1 500 000 KMF' },
];

type Status = 'idle' | 'sent';

/**
 * Formulaire de demande de devis.
 *
 * Deux canaux, une seule action : la demande est transmise à MORA Shawiri par
 * e-mail (route serveur `/api/contact`, identifiants SMTP jamais exposés au
 * navigateur) et la conversation WhatsApp s'ouvre avec le message pré-rempli.
 * Un échec de l'envoi e-mail ne bloque jamais le parcours WhatsApp.
 */
export default function ContactForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<Status>('idle');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;

    const data = new FormData(form);
    const get = (key: string) => (data.get(key) ?? '').toString().trim();

    const payload = {
      nom: get('nom'),
      organisation: get('organisation'),
      email: get('email'),
      telephone: get('telephone'),
      sujet: get('sujet'),
      budget: get('budget'),
      message: get('message'),
    };

    const lines = [
      'Bonjour MORA Shawiri,',
      '',
      `Nom : ${payload.nom}`,
      `Organisation : ${payload.organisation || '—'}`,
      `E-mail : ${payload.email || '—'}`,
      `Téléphone : ${payload.telephone || '—'}`,
      `Besoin : ${payload.sujet}`,
      `Budget indicatif : ${payload.budget || 'à définir'}`,
      '',
      'Message :',
      payload.message,
    ];

    // La fenêtre WhatsApp doit s'ouvrir dans le geste de l'utilisateur :
    // l'envoi e-mail part en parallèle, sans bloquer.
    window.open(whatsappLink(lines.join('\n')), '_blank', 'noopener');

    // Slash final : `trailingSlash` est activé, une URL sans slash serait redirigée.
    void fetch('/api/contact/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Silencieux : le message reste transmissible par WhatsApp.
    });

    setStatus('sent');
  };

  return (
    <form className="form" ref={formRef} onSubmit={handleSubmit} noValidate>
      <div className="form__row">
        <div className="field">
          <label htmlFor="nom">
            Nom et prénom{' '}
            <span className="req" aria-hidden="true">
              *
            </span>
          </label>
          <input id="nom" name="nom" type="text" required autoComplete="name" />
        </div>
        <div className="field">
          <label htmlFor="organisation">Organisation</label>
          <input id="organisation" name="organisation" type="text" autoComplete="organization" />
        </div>
      </div>

      <div className="form__row">
        <div className="field">
          <label htmlFor="email">Adresse e-mail</label>
          <input id="email" name="email" type="email" autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="telephone">Téléphone / WhatsApp</label>
          <input
            id="telephone"
            name="telephone"
            type="tel"
            autoComplete="tel"
            placeholder="+269 ..."
          />
        </div>
      </div>

      <div className="form__row">
        <div className="field">
          <label htmlFor="sujet">
            Votre besoin{' '}
            <span className="req" aria-hidden="true">
              *
            </span>
          </label>
          <select id="sujet" name="sujet" required defaultValue={SUBJECTS[0]!.value}>
            {SUBJECTS.map((subject) => (
              <option key={subject.value} value={subject.value}>
                {subject.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="budget">Budget indicatif</label>
          <select id="budget" name="budget" defaultValue="">
            {BUDGETS.map((budget) => (
              <option key={budget.label} value={budget.value}>
                {budget.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="message">
          Votre projet en quelques lignes{' '}
          <span className="req" aria-hidden="true">
            *
          </span>
        </label>
        <textarea
          id="message"
          name="message"
          required
          placeholder="Votre activité, votre objectif, votre échéance si vous en avez une."
        />
        <p className="field__hint">Plus votre description est précise, plus notre devis sera juste.</p>
      </div>

      <button className="btn btn--gold btn--lg btn--block" type="submit">
        <Whatsapp /> Envoyer ma demande sur WhatsApp
      </button>

      <p className="form__note" role="status" hidden={status !== 'sent'}>
        Votre message a été préparé dans WhatsApp et transmis à notre équipe. S’il ne s’est pas
        ouvert, écrivez-nous directement au <a href={site.phoneHref}>{site.phone}</a> ou à{' '}
        <a href={site.emailHref}>{site.email}</a>.
      </p>

      <p className="form__note">
        Ce site fonctionne sans base de données : vos informations ne sont pas stockées et ne sont
        transmises à aucun tiers. Elles servent uniquement à composer votre message et à nous le
        faire parvenir.
      </p>
    </form>
  );
}
