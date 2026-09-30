/**
 * Libellés, transitions et mises en forme de la relation client — phase 4F.
 *
 * ## Pourquoi ce fichier n'est pas dans `admin.ts`
 *
 * `admin.ts` porte `server-only` : il ouvre le client Supabase de session, et
 * l'importer depuis le navigateur exposerait des lectures qui n'ont rien à y
 * faire. Or les mêmes libellés servent aux formulaires, qui sont des
 * composants client.
 *
 * Les dupliquer garantirait qu'un statut renommé ne le soit qu'à un endroit.
 * Ce module ne contient donc que des valeurs et des fonctions pures — aucune
 * lecture, aucun secret, rien qui coûte quoi que ce soit à embarquer.
 */

import type {
  AppointmentStatus,
  QuoteRequestEventRow,
  QuoteRequestStatus,
  QuoteStatus,
} from '@/lib/supabase/types';

/* --------------------------------------------------------------- libellés --- */

/** Décision C1 — `03_ESPACE_CLIENT.md` § 26. */
export const QUOTE_REQUEST_STATUS_LABELS: Record<QuoteRequestStatus, string> = {
  NOUVELLE: 'Nouvelle',
  EN_ETUDE: 'En cours d’étude',
  DEVIS_ENVOYE: 'Devis envoyé',
  ACCEPTEE: 'Acceptée',
  REFUSEE: 'Refusée',
  TERMINEE: 'Terminée',
  ANNULEE: 'Annulée',
};

/** Décision C1 — `05_TABLEAU_DE_BORD_ADMINISTRATEUR.md` § 39. */
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  BROUILLON: 'Brouillon',
  ENVOYE: 'Envoyé',
  ACCEPTE: 'Accepté',
  REFUSE: 'Refusé',
  EXPIRE: 'Expiré',
  ANNULE: 'Annulé',
};

/** § 59 de la prise de rendez-vous. */
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  EN_ATTENTE: 'En attente',
  CONFIRME: 'Confirmé',
  ANNULE: 'Annulé',
  TERMINE: 'Terminé',
};

export const APPOINTMENT_CHANNEL_LABELS = {
  SUR_PLACE: 'Sur place',
  TELEPHONE: 'Téléphone',
  VISIOCONFERENCE: 'Visioconférence',
  WHATSAPP: 'WhatsApp',
  AUTRE: 'Autre',
} as const;

export const AVAILABILITY_KIND_LABELS = {
  OUVERTURE: 'Ouverture hebdomadaire',
  EXCEPTION: 'Ouverture exceptionnelle',
  BLOCAGE: 'Indisponibilité',
} as const;

/**
 * Jours de la semaine, dans la convention de `extract(dow)` : 0 = dimanche.
 *
 * Cette liste nomme des jours, elle n'en ouvre aucun. Aucun horaire n'est
 * proposé par défaut — le § 86 l'interdit, et les horaires réels de MORA
 * Shawiri ne sont pas arrêtés.
 */
export const WEEKDAY_LABELS = [
  'Dimanche',
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
] as const;

/* ------------------------------------------------------------ transitions --- */

/**
 * Le graphe légal des statuts, tel que les déclencheurs de la migration 0008
 * l'appliquent.
 *
 * ## Une copie, et elle est assumée
 *
 * La règle qui fait foi est en base : c'est elle qui refuse, y compris un
 * appel direct au serveur. Cette table sert à ne proposer que des boutons qui
 * marchent — proposer « Accepter » sur une demande annulée serait promettre un
 * échec.
 *
 * Deux copies d'une règle divergent toujours, un jour. Celle-ci est donc
 * comparée au SQL par un test unitaire (`tests/unit/relation.test.ts`), qui
 * lit la migration et échoue si l'un des deux bouge sans l'autre. C'est la
 * méthode déjà retenue en 4E pour les statuts du catalogue.
 */
export const QUOTE_REQUEST_TRANSITIONS: Record<QuoteRequestStatus, readonly QuoteRequestStatus[]> =
  {
    NOUVELLE: ['EN_ETUDE', 'ANNULEE'],
    EN_ETUDE: ['DEVIS_ENVOYE', 'REFUSEE', 'TERMINEE', 'ANNULEE'],
    DEVIS_ENVOYE: ['ACCEPTEE', 'REFUSEE', 'ANNULEE'],
    ACCEPTEE: ['TERMINEE', 'ANNULEE'],
    REFUSEE: [],
    TERMINEE: [],
    ANNULEE: [],
  };

export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  BROUILLON: ['ENVOYE', 'ANNULE'],
  ENVOYE: ['ACCEPTE', 'REFUSE', 'EXPIRE', 'ANNULE'],
  ACCEPTE: [],
  REFUSE: [],
  EXPIRE: [],
  ANNULE: [],
};

export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  EN_ATTENTE: ['CONFIRME', 'ANNULE'],
  CONFIRME: ['TERMINE', 'ANNULE'],
  ANNULE: [],
  TERMINE: [],
};

/**
 * Transitions qu'une demande peut réellement subir maintenant.
 *
 * « Devis envoyé » est retiré tant qu'aucun devis n'a été émis : le
 * déclencheur le refuse, et ce statut s'obtient de toute façon par l'émission
 * du devis, pas par un choix dans une liste.
 */
export function offeredQuoteRequestStatuses(
  current: QuoteRequestStatus,
): readonly QuoteRequestStatus[] {
  return QUOTE_REQUEST_TRANSITIONS[current].filter((status) => status !== 'DEVIS_ENVOYE');
}

/* -------------------------------------------------------------- affichage --- */

const DATE_ZONE = 'Indian/Comoro';

/** Date seule, sans heure : une date souhaitée n'en porte pas. */
export function formatDay(value: string | null): string {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Date et heure dans le fuseau du site.
 *
 * Le serveur tourne en UTC ; afficher son heure brute indiquerait 11:00 à
 * quelqu'un dont la montre marque 14:00. Le § 34 exige d'éviter toute
 * ambiguïté, et le fuseau des Comores est fixe, sans heure d'été.
 */
export function formatMoment(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: DATE_ZONE,
  }).format(date);
}

/** Créneau ferme, forme compacte : « 5 octobre 2026, 09:00 – 10:00 ». */
export function formatSlot(start: string | null, end: string | null): string {
  if (!start) return '—';
  const opening = formatMoment(start);
  if (!end) return opening;

  const closing = new Date(end);
  if (Number.isNaN(closing.getTime())) return opening;

  const hour = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: DATE_ZONE,
  }).format(closing);

  return `${opening} – ${hour}`;
}

/** Plage horaire d'une disponibilité. Absente, elle couvre la journée (§ 87). */
export function formatRange(
  starts: string | null,
  ends: string | null,
): string {
  if (!starts || !ends) return 'Journée entière';
  return `${starts.slice(0, 5)} – ${ends.slice(0, 5)}`;
}

/**
 * Montant d'un devis.
 *
 * `numeric` est lu comme une chaîne : c'est voulu, un flottant perdrait des
 * centimes. Le formatage se fait donc sur la valeur exacte reçue.
 */
export function formatAmount(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;

  return `${new Intl.NumberFormat('fr-FR').format(value)} ${currency}`;
}

/** Valeur d'entrée `datetime-local`, dans le fuseau du site. */
export function toLocalInputValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: DATE_ZONE,
  }).format(date);

  // `sv-SE` rend « 2026-10-05 09:00 » ; l'entrée HTML attend un T.
  return parts.replace(' ', 'T');
}

/** Libellé lisible d'un événement d'historique. */
export function describeEvent(
  event: Pick<QuoteRequestEventRow, 'kind' | 'from_status' | 'to_status' | 'quote_reference'>,
  statusLabel: (value: string | null) => string,
): string {
  switch (event.kind) {
    case 'CREATION':
      return 'Demande reçue depuis le site';
    case 'STATUT':
      return `Statut : ${statusLabel(event.from_status)} → ${statusLabel(event.to_status)}`;
    case 'DEVIS_CREE':
      return 'Devis créé en brouillon';
    case 'DEVIS_STATUT':
      return `Devis ${event.quote_reference ?? ''} : ${QUOTE_STATUS_LABELS[
        (event.from_status ?? 'BROUILLON') as QuoteStatus
      ] ?? event.from_status} → ${QUOTE_STATUS_LABELS[
        (event.to_status ?? 'BROUILLON') as QuoteStatus
      ] ?? event.to_status}`;
    case 'AFFECTATION':
      return 'Affectation modifiée';
    default:
      return 'Note';
  }
}
