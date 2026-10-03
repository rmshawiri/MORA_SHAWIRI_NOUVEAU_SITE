/**
 * Où mène une notification — phase 4J-1.
 *
 * Une notification ne stocke **aucune URL**. Sa cible se calcule ici, à
 * partir de trois éléments contrôlés : l'espace, le type de ressource, et
 * l'identifiant (UUID) ou la référence MORA-… de cette ressource. La table
 * ci-dessous est fermée : une combinaison absente ne mène nulle part.
 *
 * Conséquences :
 *   * aucune redirection ouverte — le résultat est toujours un chemin interne
 *     commençant par l'un des trois préfixes privés, jamais une URL absolue ;
 *   * une donnée malformée (UUID invalide, référence hors format) donne
 *     `null`, pas un chemin approximatif ;
 *   * la cible n'accorde aucun droit : la page visée refait ses propres
 *     contrôles et répond « introuvable » à qui n'y a pas accès.
 *
 * Module pur.
 */

import type { NotificationAudience, NotificationEntityType } from './catalogue';
import { REFERENCE_PATTERN, type NotificationParams } from './params';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Key = 'id' | 'reference';
type Route = { key: Key; build: (value: string) => string } | { key: null; build: () => string };

const byId = (prefix: string): Route => ({ key: 'id', build: (id) => `${prefix}${id}/` });
const byReference = (prefix: string): Route => ({ key: 'reference', build: (reference) => `${prefix}${reference}/` });
const fixed = (path: string): Route => ({ key: null, build: () => path });

/** La seule table de correspondance. */
export const NOTIFICATION_ROUTES: Record<NotificationAudience, Partial<Record<NotificationEntityType, Route>>> = {
  ADMINISTRATION: {
    quote_request: byReference('/administration/demandes/'),
    appointment: byId('/administration/rendez-vous/'),
    // Paiements et remboursements se traitent depuis la fiche de leur
    // commande : la référence portée est celle de la commande.
    payment: byReference('/administration/commandes/'),
    refund: byReference('/administration/commandes/'),
    order: byReference('/administration/commandes/'),
    client: byReference('/administration/clients/'),
    affiliate_application: byId('/administration/affiliation/candidatures/'),
    affiliate_prospect: fixed('/administration/affiliation/prospects/'),
    affiliate: byId('/administration/affiliation/affilies/'),
    affiliate_commission: byId('/administration/affiliation/commissions/'),
    affiliate_payout: byId('/administration/affiliation/versements/'),
  },
  CLIENT: {
    quote: byReference('/espace-client/devis/'),
    appointment: byId('/espace-client/rendez-vous/'),
    order: byReference('/espace-client/commandes/'),
    payment: byReference('/espace-client/commandes/'),
    refund: byReference('/espace-client/commandes/'),
  },
  AFFILIE: {
    affiliate_prospect: fixed('/espace-affilie/prospects/'),
    affiliate_commission: fixed('/espace-affilie/commissions/'),
    affiliate_payout: fixed('/espace-affilie/versements/'),
    // Fiche affilié (FIAF) et coordonnées : deux rubriques distinctes, choisies
    // par le type de notification (voir `notificationTarget`).
    affiliate: fixed('/espace-affilie/documents/'),
  },
};

/** Exceptions par type, quand une même ressource mène à deux rubriques. */
const TYPE_ROUTES: Partial<Record<string, Route>> = {
  'affilie.coordonnees.validees': fixed('/espace-affilie/profil/'),
  'affilie.coordonnees.refusees': fixed('/espace-affilie/profil/'),
};

const PRIVATE_PREFIXES = ['/administration/', '/espace-client/', '/espace-affilie/'] as const;

export type NotificationTargetInput = {
  audience: NotificationAudience;
  typeCode: string;
  entityType: NotificationEntityType;
  entityId: string;
  params: NotificationParams;
};

/**
 * Chemin interne de la ressource, ou `null` si aucune cible sûre ne peut
 * être construite.
 */
export function notificationTarget(input: NotificationTargetInput): string | null {
  const route = TYPE_ROUTES[input.typeCode] ?? NOTIFICATION_ROUTES[input.audience]?.[input.entityType];
  if (!route) return null;

  let path: string;
  if (route.key === null) {
    path = route.build();
  } else if (route.key === 'id') {
    if (!UUID.test(input.entityId)) return null;
    path = route.build(input.entityId.toLowerCase());
  } else {
    const reference = input.params.reference;
    if (!reference || !REFERENCE_PATTERN.test(reference)) return null;
    path = route.build(reference);
  }

  return isSafeInternalPath(path, input.audience) ? path : null;
}

/** Dernier garde : un chemin privé de l'espace attendu, sans schéma ni hôte. */
export function isSafeInternalPath(path: string, audience: NotificationAudience): boolean {
  const expected = audience === 'ADMINISTRATION' ? PRIVATE_PREFIXES[0] : audience === 'CLIENT' ? PRIVATE_PREFIXES[1] : PRIVATE_PREFIXES[2];
  return (
    path.startsWith(expected) &&
    !path.startsWith('//') &&
    !path.includes('\\') &&
    !path.includes('..') &&
    !/[?#\s]/.test(path) &&
    /^[A-Za-z0-9/_-]+$/.test(path)
  );
}
