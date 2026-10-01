/**
 * Prospects déclarés — module pur (phase 4H-4).
 *
 * Libellés, graphe des statuts (miroir de `affiliate_prospect_transition_ok`)
 * et validation de la déclaration : partagés par l'espace affilié, la route
 * serveur et l'administration.
 */

import type { ProspectStatus } from '@/lib/supabase/types-affiliation';

export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  DECLARE: 'Déclaré',
  A_VERIFIER: 'À vérifier',
  RECONNU: 'Reconnu',
  CONVERTI: 'Converti',
  REFUSE: 'Non reconnu',
  ANNULE: 'Annulé',
};

export const PROSPECT_TRANSITIONS: Record<ProspectStatus, readonly ProspectStatus[]> = {
  DECLARE: ['A_VERIFIER', 'RECONNU', 'REFUSE', 'ANNULE'],
  A_VERIFIER: ['RECONNU', 'REFUSE', 'ANNULE'],
  RECONNU: ['CONVERTI'],
  CONVERTI: [],
  REFUSE: [],
  ANNULE: [],
};

export type ProspectDraft = {
  fullName: string;
  company: string;
  phone: string;
  email: string;
  need: string;
  comment: string;
  consent: boolean;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Le strict nécessaire : nom, téléphone, besoin, et l'accord du prospect. */
export function validateProspect(draft: ProspectDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.fullName.trim()) errors.fullName = 'Le nom est requis.';
  else if (draft.fullName.trim().length > 120) errors.fullName = '120 caractères au plus.';
  if (draft.phone.replace(/\D/g, '').length < 6) errors.phone = 'Un numéro joignable est requis.';
  if (draft.email.trim() && !EMAIL.test(draft.email.trim())) errors.email = 'Le format de l’adresse n’est pas reconnu.';
  if (!draft.need.trim()) errors.need = 'Décrivez son besoin en une phrase.';
  else if (draft.need.trim().length > 1000) errors.need = '1 000 caractères au plus.';
  if (draft.company.trim().length > 160) errors.company = '160 caractères au plus.';
  if (draft.comment.trim().length > 1000) errors.comment = '1 000 caractères au plus.';
  if (!draft.consent) errors.consent = 'L’accord du prospect est requis avant de transmettre ses coordonnées.';
  return errors;
}
