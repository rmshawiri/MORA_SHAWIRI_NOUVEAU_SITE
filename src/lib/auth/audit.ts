import 'server-only';

/**
 * Journalisation des événements d'authentification.
 *
 * `04_AUTHENTIFICATION.md` § 140 autorise l'enregistrement des connexions,
 * déconnexions, réinitialisations et changements de mot de passe. Le § 141
 * interdit d'y faire figurer un mot de passe, un jeton ou un code secret — et
 * la base elle-même refuse l'enregistrement dont une clé de métadonnée
 * ressemblerait à un secret (déclencheur `audit_logs_reject_secrets`).
 *
 * ## Deux chemins d'écriture, et pourquoi
 *
 * Quand une session existe, l'écriture passe par `record_audit_event()` : cette
 * fonction attribue l'action au compte connecté, sans que l'appelant puisse
 * désigner quelqu'un d'autre. C'est la garantie d'un journal non falsifiable.
 *
 * Certains événements n'ont pourtant aucune session : une connexion **échouée**
 * est précisément un cas où personne n'est authentifié. Ils passent alors par
 * la clé à privilèges, seule habilitée à écrire dans une table dépourvue de
 * politique d'insertion.
 *
 * ## Ce qui n'est pas enregistré
 *
 * Aucun identifiant saisi lors d'une tentative échouée. Un journal qui
 * consignerait chaque identifiant essayé deviendrait, sur la durée, une liste
 * d'adresses et de noms d'utilisateurs — exactement ce que le § 59 demande de
 * ne pas collecter, et ce qu'un attaquant lisant le journal exploiterait.
 * Le motif du refus suffit à la surveillance demandée au § 175.
 */

import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { getServerSupabaseClient } from '@/lib/supabase/server';

export type AuthAuditAction =
  | 'auth.connexion'
  | 'auth.connexion_refusee'
  | 'auth.deconnexion'
  | 'auth.inscription'
  | 'auth.reinitialisation_demandee'
  | 'auth.mot_de_passe_modifie'
  | 'auth.double_facteur_enrole'
  | 'auth.double_facteur_verifie'
  | 'auth.double_facteur_retire'
  | 'auth.limite_atteinte';

type AuditInput = {
  action: AuthAuditAction;
  result?: 'SUCCES' | 'REFUS' | 'ECHEC';
  /** Contexte non identifiant. Aucune clé ne doit évoquer un secret. */
  metadata?: Record<string, string | number | boolean>;
  /** Compte concerné lorsqu'aucune session ne le porte (inscription). */
  actorId?: string;
};

/**
 * Enregistre un événement au nom du compte connecté.
 * Silencieux en cas d'échec : un journal indisponible ne doit pas empêcher une
 * personne de se connecter.
 */
export async function recordAuthEvent(input: AuditInput): Promise<void> {
  try {
    const supabase = await getServerSupabaseClient();
    if (!supabase) return;

    await supabase.rpc('record_audit_event', {
      p_action: input.action,
      p_resource_type: 'auth',
      p_resource_id: null,
      p_result: input.result ?? 'SUCCES',
      p_metadata: (input.metadata ?? {}) as never,
    });
  } catch {
    // Sans effet sur le parcours.
  }
}

/**
 * Enregistre un événement survenu hors session.
 *
 * Réservé aux cas où `auth.uid()` est nul par nature : connexion refusée,
 * inscription avant confirmation, limite de fréquence atteinte.
 */
export async function recordAnonymousAuthEvent(input: AuditInput): Promise<void> {
  try {
    const client = getAdminSupabaseClient();
    if (!client) return;

    await client.from('audit_logs').insert({
      actor_id: input.actorId ?? null,
      actor_label: null,
      action: input.action,
      resource_type: 'auth',
      resource_id: null,
      result: input.result ?? 'REFUS',
      metadata: (input.metadata ?? {}) as never,
    });
  } catch {
    // Sans effet sur le parcours.
  }
}
