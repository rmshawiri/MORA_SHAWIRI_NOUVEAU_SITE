import 'server-only';

/**
 * Persistance d'une demande reçue depuis le site — phase 4F.
 *
 * ## Ce que ce fichier décide, et ce qu'il ne décide pas
 *
 * Il enregistre, et il rend compte. La route `/api/contact` décide seule de ce
 * que le visiteur voit — c'est elle qui connaît l'e-mail, et l'ordre des deux
 * responsabilités appartient au point 6 du cadrage, pas à ce module.
 *
 * ## Pourquoi le client de session, et pas le client public
 *
 * `getPublicSupabaseClient()` met ses appels en cache pendant cinq minutes :
 * c'est ce qui garde la Boutique en HTML statique, et ce serait absurde ici —
 * la seconde demande recevrait la réponse de la première. Surtout, ce client
 * n'ouvre aucun cookie, donc `auth.uid()` y est toujours nul : un CLIENT
 * connecté verrait sa demande enregistrée comme celle d'un visiteur.
 *
 * Le client de session lit les cookies. Le rattachement au compte se fait donc
 * tout seul, côté serveur, sans qu'aucun identifiant traverse le navigateur.
 *
 * ## Pourquoi tout passe par une fonction de base
 *
 * Les tables de la phase 4F n'accordent aucune écriture aux rôles `anon` et
 * `authenticated`. `submit_quote_request` et `submit_appointment_request` sont
 * la seule porte, et elles lisent `auth.uid()` en interne. Il n'existe donc
 * aucun champ à falsifier pour rattacher une demande au compte d'un tiers :
 * ce n'est pas une validation, c'est une impossibilité de construction
 * (point 9 du cadrage).
 */

import { createHash } from 'node:crypto';

import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/supabase/types';

/** Ce que la route doit savoir pour choisir sa réponse. */
export type PersistOutcome =
  /** La demande existe en base. `duplicate` : c'était un second envoi identique. */
  | { state: 'stored'; reference: string | null; duplicate: boolean }
  /** Base injoignable ou non configurée. Le site doit continuer de fonctionner. */
  | { state: 'unavailable'; detail: string }
  /** La base a refusé : trop d'envois, ou charge utile invalide. */
  | { state: 'rejected'; reason: 'rate_limited' | 'invalid' };

export type RelationDetail = { label: string; value: string };

export type QuoteSubmission = {
  nom: string;
  email: string;
  telephone?: string;
  organisation?: string;
  sujet: string;
  budget?: string;
  message: string;
  /** Slug d'offre, revalidé en base contre une prestation publiée. */
  offreSlug?: string;
  offreTitre?: string;
  details?: readonly RelationDetail[];
  source?: string;
};

export type AppointmentSubmission = {
  nom: string;
  email: string;
  telephone?: string;
  organisation?: string;
  sujet: string;
  /** Libellé exact choisi dans le formulaire ; le code est normalisé en base. */
  canal?: string;
  /** Date souhaitée au format ISO. Le formulaire affiche une date longue. */
  dateSouhaitee?: string;
  creneauSouhaite?: string;
  budget?: string;
  message?: string;
  offreSlug?: string;
  details?: readonly RelationDetail[];
  source?: string;
};

/**
 * Empreinte de l'appelant.
 *
 * Le compteur de fréquence de la phase 4A ne stocke que des empreintes, « ce
 * qui évite de constituer un fichier d'adresses IP en clair ». On tient la même
 * ligne : l'adresse ne quitte pas le processus.
 */
function fingerprint(clientKey: string): string {
  return createHash('sha256').update(`relation:${clientKey}`).digest('hex');
}

/** Date ISO acceptable pour une colonne `date`, ou `null`. */
function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  // Une date que Postgres refuserait (30 février) n'a rien à faire ici :
  // on préfère perdre la précision du souhait que perdre la demande.
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === trimmed ? trimmed : null;
}

function asJsonDetails(details: readonly RelationDetail[] | undefined): Json {
  if (!details || details.length === 0) return [];
  return details.map((row) => ({ label: row.label, value: row.value })) as Json;
}

/**
 * Traduit une erreur PostgREST en verdict.
 *
 * Deux refus sont **légitimes** et doivent être distingués d'une panne : la
 * limitation de fréquence (`54000`, levée par la fonction) et une charge utile
 * que les contraintes rejettent. Tout le reste est traité comme une
 * indisponibilité : c'est le cas où le site doit continuer de fonctionner sans
 * la base, et non prétendre que la demande était mauvaise.
 */
function classify(error: { code?: string | null; message?: string } | null): PersistOutcome {
  const code = error?.code ?? '';

  if (code === '54000') return { state: 'rejected', reason: 'rate_limited' };
  if (code === '23514' || code === '23502' || code === '22001') {
    return { state: 'rejected', reason: 'invalid' };
  }

  // `check_violation` levé par `raise ... using errcode` remonte en 23514 ;
  // les refus de permission en 42501. Ni l'un ni l'autre ne peut se produire
  // ici — les deux fonctions sont accordées à `anon` — mais les classer évite
  // qu'un refus de droit soit un jour pris pour une panne.
  if (code === '42501') return { state: 'rejected', reason: 'invalid' };

  return { state: 'unavailable', detail: code || 'inconnu' };
}

/** Enregistre une demande de devis. */
export async function persistQuoteRequest(
  submission: QuoteSubmission,
  clientKey: string,
): Promise<PersistOutcome> {
  let client;
  try {
    client = await getServerSupabaseClient();
  } catch {
    return { state: 'unavailable', detail: 'client' };
  }

  if (!client) return { state: 'unavailable', detail: 'non_configure' };

  try {
    const { data, error } = await client.rpc('submit_quote_request', {
      p_full_name: submission.nom,
      p_email: submission.email,
      p_phone: submission.telephone ?? null,
      p_organisation: submission.organisation ?? null,
      p_subject: submission.sujet,
      p_budget: submission.budget ?? null,
      p_message: submission.message,
      p_service_slug: submission.offreSlug ?? null,
      p_offer_title: submission.offreTitre ?? null,
      p_details: asJsonDetails(submission.details),
      p_source: submission.source ?? null,
      p_client_hash: fingerprint(clientKey),
    });

    if (error) return classify(error);

    const row = data?.[0];
    return {
      state: 'stored',
      reference: row?.reference ?? null,
      duplicate: row?.duplicate === true,
    };
  } catch {
    // Réseau injoignable, délai dépassé : la base est indisponible, pas la
    // demande invalide. Aucun détail n'est journalisé — il pourrait contenir
    // l'adresse du projet (§ 71-75 des variables d'environnement).
    return { state: 'unavailable', detail: 'reseau' };
  }
}

/** Enregistre une demande de rendez-vous. */
export async function persistAppointmentRequest(
  submission: AppointmentSubmission,
  clientKey: string,
): Promise<PersistOutcome> {
  let client;
  try {
    client = await getServerSupabaseClient();
  } catch {
    return { state: 'unavailable', detail: 'client' };
  }

  if (!client) return { state: 'unavailable', detail: 'non_configure' };

  try {
    const { data, error } = await client.rpc('submit_appointment_request', {
      p_full_name: submission.nom,
      p_email: submission.email,
      p_phone: submission.telephone ?? null,
      p_organisation: submission.organisation ?? null,
      p_subject: submission.sujet,
      p_channel_label: submission.canal ?? null,
      p_requested_date: isoDate(submission.dateSouhaitee),
      p_requested_slot: submission.creneauSouhaite ?? null,
      p_budget: submission.budget ?? null,
      p_message: submission.message ?? null,
      p_service_slug: submission.offreSlug ?? null,
      p_details: asJsonDetails(submission.details),
      p_source: submission.source ?? null,
      p_client_hash: fingerprint(clientKey),
    });

    if (error) return classify(error);

    const row = data?.[0];
    return {
      state: 'stored',
      // § 43 : un rendez-vous n'est numéroté qu'à sa confirmation. Il n'y a
      // donc aucune référence à rendre ici, et en fabriquer une serait mentir.
      reference: null,
      duplicate: row?.duplicate === true,
    };
  } catch {
    return { state: 'unavailable', detail: 'reseau' };
  }
}
