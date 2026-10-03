/**
 * Catalogue des notifications — phase 4J-1.
 *
 * Miroir exact de `public.notification_types`
 * (`supabase/migrations/20261003200000_notifications_socle.sql`) : même code,
 * même espace, même niveau, même ressource, même permission. Le test
 * `notifications.test.ts` compare les deux ; une divergence est un incident.
 *
 * Ce que la base ne porte pas, et que ce fichier ajoute : la phrase affichée.
 * Elle se construit à partir des seules données minimales d'une notification
 * (une référence MORA-…), jamais d'un montant, d'un nom ou d'une coordonnée
 * (arbitrage N13). Module pur : aucun accès réseau, aucun secret.
 */

/** Les trois boîtes (N9) : un même compte peut en avoir plusieurs, jamais fusionnées. */
export const NOTIFICATION_AUDIENCES = ['ADMINISTRATION', 'CLIENT', 'AFFILIE'] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

/** Exactement trois niveaux métier (N12). Lu / non lu et traité / non traité sont indépendants. */
export const NOTIFICATION_LEVELS = ['A_TRAITER', 'INFORMATION', 'ATTENTION'] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

export const NOTIFICATION_LEVEL_LABELS: Record<NotificationLevel, string> = {
  A_TRAITER: 'À traiter',
  INFORMATION: 'Information',
  ATTENTION: 'Attention',
};

export const NOTIFICATION_ENTITY_TYPES = [
  'quote_request',
  'quote',
  'appointment',
  'order',
  'payment',
  'refund',
  'client',
  'affiliate',
  'affiliate_application',
  'affiliate_prospect',
  'affiliate_commission',
  'affiliate_payout',
] as const;
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

export type NotificationTypeSpec = {
  audience: NotificationAudience;
  level: NotificationLevel;
  entityType: NotificationEntityType;
  /** Administration seulement : la permission qui permet réellement d'agir (N4). */
  permission: string | null;
  /** Libellé court, identique à `notification_types.label`. */
  label: string;
  /**
   * Phrase affichée. `reference` est la référence MORA-… éventuellement
   * portée par la notification ; la phrase reste correcte sans elle.
   */
  title: (reference: string | null) => string;
  /** Libellé du lien vers la ressource. */
  action: string;
};

const ref = (reference: string | null, before = ' ') => (reference ? `${before}${reference}` : '');

export const NOTIFICATION_TYPES = {
  'client.devis.disponible': {
    audience: 'CLIENT', level: 'A_TRAITER', entityType: 'quote', permission: null,
    label: 'Devis disponible',
    title: (r) => `Votre devis${ref(r)} est disponible.`,
    action: 'Voir le devis',
  },
  'client.rendez_vous.confirme': {
    audience: 'CLIENT', level: 'INFORMATION', entityType: 'appointment', permission: null,
    label: 'Rendez-vous confirmé',
    title: (r) => `Votre rendez-vous${ref(r)} est confirmé.`,
    action: 'Voir le rendez-vous',
  },
  'client.rendez_vous.reprogramme': {
    audience: 'CLIENT', level: 'INFORMATION', entityType: 'appointment', permission: null,
    label: 'Rendez-vous reprogrammé',
    title: (r) => `Votre rendez-vous${ref(r)} a été reprogrammé.`,
    action: 'Voir le rendez-vous',
  },
  'client.rendez_vous.annule': {
    audience: 'CLIENT', level: 'ATTENTION', entityType: 'appointment', permission: null,
    label: 'Rendez-vous annulé',
    title: (r) => `Votre rendez-vous${ref(r)} a été annulé.`,
    action: 'Voir le rendez-vous',
  },
  'client.commande.enregistree': {
    audience: 'CLIENT', level: 'INFORMATION', entityType: 'order', permission: null,
    label: 'Commande enregistrée',
    title: (r) => `Votre commande${ref(r)} a été enregistrée.`,
    action: 'Voir la commande',
  },
  'client.commande.confirmee': {
    audience: 'CLIENT', level: 'INFORMATION', entityType: 'order', permission: null,
    label: 'Commande confirmée',
    title: (r) => `Votre commande${ref(r)} a été confirmée.`,
    action: 'Voir la commande',
  },
  'client.commande.attente_information': {
    audience: 'CLIENT', level: 'A_TRAITER', entityType: 'order', permission: null,
    label: 'Commande en attente d’information',
    title: (r) => `Votre commande${ref(r)} attend des informations de votre part.`,
    action: 'Voir la commande',
  },
  'client.commande.prete': {
    audience: 'CLIENT', level: 'INFORMATION', entityType: 'order', permission: null,
    label: 'Commande prête',
    title: (r) => `Votre commande${ref(r)} est prête.`,
    action: 'Voir la commande',
  },
  'client.commande.terminee': {
    audience: 'CLIENT', level: 'INFORMATION', entityType: 'order', permission: null,
    label: 'Commande terminée',
    title: (r) => `Votre commande${ref(r)} est terminée.`,
    action: 'Voir la commande',
  },
  'client.commande.annulee': {
    audience: 'CLIENT', level: 'ATTENTION', entityType: 'order', permission: null,
    label: 'Commande annulée',
    title: (r) => `Votre commande${ref(r)} a été annulée.`,
    action: 'Voir la commande',
  },
  'client.paiement.confirme': {
    audience: 'CLIENT', level: 'INFORMATION', entityType: 'payment', permission: null,
    label: 'Paiement confirmé',
    title: (r) => `Votre paiement${ref(r, ' pour la commande ')} a été confirmé.`,
    action: 'Voir la commande',
  },
  'client.paiement.rejete': {
    audience: 'CLIENT', level: 'ATTENTION', entityType: 'payment', permission: null,
    label: 'Paiement rejeté',
    title: (r) => `Votre paiement${ref(r, ' pour la commande ')} n’a pas pu être confirmé.`,
    action: 'Voir la commande',
  },
  'client.paiement.annule': {
    audience: 'CLIENT', level: 'INFORMATION', entityType: 'payment', permission: null,
    label: 'Paiement annulé',
    title: (r) => `Un paiement${ref(r, ' de la commande ')} a été annulé.`,
    action: 'Voir la commande',
  },
  'client.remboursement.effectue': {
    audience: 'CLIENT', level: 'INFORMATION', entityType: 'refund', permission: null,
    label: 'Remboursement effectué',
    title: (r) => `Un remboursement a été effectué${ref(r, ' pour votre commande ')}.`,
    action: 'Voir la commande',
  },
  'client.facture.disponible': {
    audience: 'CLIENT', level: 'INFORMATION', entityType: 'order', permission: null,
    label: 'Facture disponible',
    title: (r) => `La facture de votre commande${ref(r)} est disponible.`,
    action: 'Voir la commande',
  },
  'admin.demande.nouvelle': {
    audience: 'ADMINISTRATION', level: 'A_TRAITER', entityType: 'quote_request', permission: 'quotes.manage',
    label: 'Nouvelle demande de devis',
    title: (r) => `Nouvelle demande de devis${ref(r)} à traiter.`,
    action: 'Voir la demande',
  },
  'admin.rendez_vous.nouveau': {
    audience: 'ADMINISTRATION', level: 'A_TRAITER', entityType: 'appointment', permission: 'appointments.update',
    label: 'Nouvelle demande de rendez-vous',
    title: () => 'Nouvelle demande de rendez-vous à traiter.',
    action: 'Voir le rendez-vous',
  },
  'admin.rendez_vous.annule_client': {
    audience: 'ADMINISTRATION', level: 'INFORMATION', entityType: 'appointment', permission: 'appointments.update',
    label: 'Rendez-vous annulé par le client',
    title: (r) => `Rendez-vous${ref(r)} annulé par le client.`,
    action: 'Voir le rendez-vous',
  },
  'admin.devis.accepte': {
    audience: 'ADMINISTRATION', level: 'A_TRAITER', entityType: 'quote_request', permission: 'orders.update',
    label: 'Devis accepté : commande à créer',
    title: (r) => `Devis accepté sur la demande${ref(r)} : la commande est à créer.`,
    action: 'Voir la demande',
  },
  'admin.devis.refuse': {
    audience: 'ADMINISTRATION', level: 'INFORMATION', entityType: 'quote_request', permission: 'quotes.manage',
    label: 'Devis refusé',
    title: (r) => `Devis refusé sur la demande${ref(r)}.`,
    action: 'Voir la demande',
  },
  'admin.paiement.a_verifier': {
    audience: 'ADMINISTRATION', level: 'A_TRAITER', entityType: 'payment', permission: 'payments.verify',
    label: 'Paiement à vérifier',
    title: (r) => `Un paiement${ref(r, ' de la commande ')} nécessite votre vérification.`,
    action: 'Voir la commande',
  },
  'admin.remboursement.a_executer': {
    audience: 'ADMINISTRATION', level: 'A_TRAITER', entityType: 'refund', permission: 'payments.refund',
    label: 'Remboursement à exécuter',
    title: (r) => `Un remboursement${ref(r, ' de la commande ')} est à exécuter.`,
    action: 'Voir la commande',
  },
  'admin.candidature.nouvelle': {
    audience: 'ADMINISTRATION', level: 'A_TRAITER', entityType: 'affiliate_application', permission: 'affiliate_applications.manage',
    label: 'Candidature d’affiliation à examiner',
    title: () => 'Nouvelle candidature d’affiliation à examiner.',
    action: 'Voir la candidature',
  },
  'admin.prospect.a_examiner': {
    audience: 'ADMINISTRATION', level: 'A_TRAITER', entityType: 'affiliate_prospect', permission: 'affiliate_attributions.manage',
    label: 'Prospect déclaré à examiner',
    title: () => 'Un prospect déclaré par un affilié est à examiner.',
    action: 'Voir les prospects',
  },
  'admin.coordonnees.a_examiner': {
    audience: 'ADMINISTRATION', level: 'A_TRAITER', entityType: 'affiliate', permission: 'payouts.manage',
    label: 'Coordonnées de versement à examiner',
    title: (r) => `Des coordonnées de versement${ref(r, ' de l’affilié ')} sont à examiner.`,
    action: 'Voir l’affilié',
  },
  'admin.client.nouveau': {
    audience: 'ADMINISTRATION', level: 'INFORMATION', entityType: 'client', permission: 'users.view',
    label: 'Nouveau client',
    title: (r) => `Nouveau client${ref(r)}.`,
    action: 'Voir le client',
  },
  'affilie.prospect.valide': {
    audience: 'AFFILIE', level: 'INFORMATION', entityType: 'affiliate_prospect', permission: null,
    label: 'Prospect validé',
    title: () => 'Un prospect que vous avez déclaré a été validé.',
    action: 'Voir mes prospects',
  },
  'affilie.prospect.refuse': {
    audience: 'AFFILIE', level: 'ATTENTION', entityType: 'affiliate_prospect', permission: null,
    label: 'Prospect refusé',
    title: () => 'Un prospect que vous avez déclaré n’a pas été retenu.',
    action: 'Voir mes prospects',
  },
  'affilie.commission.enregistree': {
    audience: 'AFFILIE', level: 'INFORMATION', entityType: 'affiliate_commission', permission: null,
    label: 'Commission enregistrée',
    title: (r) => `Une nouvelle commission${ref(r)} a été enregistrée.`,
    action: 'Voir mes commissions',
  },
  'affilie.commission.acquise': {
    audience: 'AFFILIE', level: 'INFORMATION', entityType: 'affiliate_commission', permission: null,
    label: 'Commission acquise',
    title: (r) => `Votre commission${ref(r)} est acquise.`,
    action: 'Voir mes commissions',
  },
  'affilie.commission.validee': {
    audience: 'AFFILIE', level: 'INFORMATION', entityType: 'affiliate_commission', permission: null,
    label: 'Commission validée',
    title: (r) => `Votre commission${ref(r)} a été validée.`,
    action: 'Voir mes commissions',
  },
  'affilie.commission.ajustee': {
    audience: 'AFFILIE', level: 'ATTENTION', entityType: 'affiliate_commission', permission: null,
    label: 'Commission ajustée',
    title: (r) => `Votre commission${ref(r)} a été ajustée.`,
    action: 'Voir mes commissions',
  },
  'affilie.commission.annulee': {
    audience: 'AFFILIE', level: 'ATTENTION', entityType: 'affiliate_commission', permission: null,
    label: 'Commission annulée',
    title: (r) => `Votre commission${ref(r)} a été annulée.`,
    action: 'Voir mes commissions',
  },
  'affilie.versement.confirme': {
    audience: 'AFFILIE', level: 'INFORMATION', entityType: 'affiliate_payout', permission: null,
    label: 'Versement confirmé',
    title: (r) => `Votre versement${ref(r)} a été confirmé.`,
    action: 'Voir mes versements',
  },
  'affilie.fiche.mise_a_jour': {
    audience: 'AFFILIE', level: 'INFORMATION', entityType: 'affiliate', permission: null,
    label: 'Fiche affilié mise à jour',
    title: (r) => `Votre fiche affilié${ref(r)} a été mise à jour.`,
    action: 'Voir mes documents',
  },
  'affilie.coordonnees.validees': {
    audience: 'AFFILIE', level: 'INFORMATION', entityType: 'affiliate', permission: null,
    label: 'Coordonnées de versement validées',
    title: () => 'Vos coordonnées de versement ont été validées.',
    action: 'Voir mon profil',
  },
  'affilie.coordonnees.refusees': {
    audience: 'AFFILIE', level: 'A_TRAITER', entityType: 'affiliate', permission: null,
    label: 'Coordonnées de versement refusées',
    title: () => 'Vos coordonnées de versement n’ont pas été validées : merci de les vérifier.',
    action: 'Voir mon profil',
  },
} as const satisfies Record<string, NotificationTypeSpec>;

export type NotificationTypeCode = keyof typeof NOTIFICATION_TYPES;

export function isNotificationAudience(value: unknown): value is NotificationAudience {
  return typeof value === 'string' && (NOTIFICATION_AUDIENCES as readonly string[]).includes(value);
}

export function isNotificationLevel(value: unknown): value is NotificationLevel {
  return typeof value === 'string' && (NOTIFICATION_LEVELS as readonly string[]).includes(value);
}

export function isNotificationType(value: unknown): value is NotificationTypeCode {
  return typeof value === 'string' && Object.hasOwn(NOTIFICATION_TYPES, value);
}

export function notificationType(code: string): NotificationTypeSpec | null {
  return isNotificationType(code) ? NOTIFICATION_TYPES[code] : null;
}
