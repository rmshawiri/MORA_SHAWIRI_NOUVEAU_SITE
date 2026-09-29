/**
 * Registre des modules d'administration — une seule liste, trois usages.
 *
 * La navigation, le contrôle d'accès de chaque page et la grille des droits
 * d'un administrateur lisent **le même tableau**. C'est ce qui garantit qu'un
 * module ajouté demain apparaît au bon endroit, sous la bonne permission, sans
 * qu'on ait à penser à trois fichiers — et qu'un module ne puisse pas être
 * visible dans le menu tout en étant refusé par sa page, ou l'inverse.
 *
 * ## Ce que ce fichier n'est pas
 *
 * Ce n'est pas une autorisation. Masquer une entrée de menu ne protège rien :
 * le § 102 du tableau de bord le dit, et la phase 4B l'a déjà établi pour la
 * porte de l'administration. Chaque page appelle son garde indépendamment, et
 * c'est le garde qui décide. Le menu ne fait qu'éviter de proposer une porte
 * fermée.
 *
 * ## Les routes
 *
 * `/administration/` est la racine imposée par `01_STRUCTURE_DES_URLS.md` § 44
 * et déjà en service depuis la phase 4B. Les sous-chemins reprennent les **13
 * modules officiels** du prompt maître, regroupés là où les documents traitent
 * deux modules comme un seul écran :
 *
 *   * `catalogue` réunit `00_GESTION_SERVICES` et `01_GESTION_PRODUITS` —
 *     `05_TABLEAU_DE_BORD_ADMINISTRATEUR.md` § 34-35 les présente comme deux
 *     faces d'une même offre ;
 *   * `affiliation` réunit `04_GESTION_AFFILIES` et `05_GESTION_COMMISSIONS` —
 *     § 60-74 les traite d'un seul tenant.
 *
 * Deux entrées ne viennent pas des 13 modules et s'en expliquent :
 * **Administrateurs** et **Journal d'activité**, que le § 113-115 place dans la
 * section Sécurité et que la phase 4C du plan de développement demande
 * explicitement de livrer.
 *
 * Aucune route `documents` n'est créée. Le Moteur de Documents n'est pas un
 * module d'administration mais un service transverse (phase 4D du plan) :
 * devis, commandes et factures s'en servent, il ne s'administre pas seul. En
 * inventer une entrée de menu reviendrait à promettre un écran que les
 * documents de référence ne décrivent pas.
 *
 * Références : prompt maître § 4.7 ; `05_TABLEAU_DE_BORD_ADMINISTRATEUR.md`
 * § 113-115, § 171-174 ; plan de développement, phases 4C à 4L.
 */

import type { Permission } from './catalogue';

/**
 * État réel d'un module. `05_TABLEAU_DE_BORD_ADMINISTRATEUR.md` § 171 est
 * formel : « Ces fonctionnalités ne doivent pas être simulées si elles ne sont
 * pas encore implémentées. » Un module `A_VENIR` affiche donc ce qu'il est —
 * une place réservée, sans chiffre, sans tableau, sans donnée inventée.
 */
export type ModuleStatus = 'DISPONIBLE' | 'A_VENIR';

export type AdminModule = {
  /** Segment d'URL sous `/administration/`. `null` pour le tableau de bord. */
  readonly slug: string | null;
  readonly href: string;
  readonly label: string;
  /** Phrase affichée sur la page et en sous-titre de menu. */
  readonly summary: string;
  /**
   * Permission exigée pour ouvrir le module. `null` signifie « accès
   * administratif suffisant » — le cas du seul tableau de bord.
   */
  readonly permission: Permission | null;
  readonly status: ModuleStatus;
  /** Regroupement dans la barre latérale. */
  readonly group: ModuleGroup;
  /** Phase du plan de développement qui construira le contenu. */
  readonly phase: string;
};

export type ModuleGroup = 'PILOTAGE' | 'ACTIVITE' | 'CONTENU' | 'SYSTEME';

export const MODULE_GROUP_LABELS: Record<ModuleGroup, string> = {
  PILOTAGE: 'Pilotage',
  ACTIVITE: 'Activité',
  CONTENU: 'Contenus et diffusion',
  SYSTEME: 'Système',
};

export const ADMIN_ROOT = '/administration/';

/**
 * L'ordre est celui de la barre latérale. Il suit la hiérarchie du § 174 :
 * commandes, demandes, rendez-vous, clients, affiliation, paiements d'abord —
 * ce que MORA Shawiri regarde tous les jours.
 */
export const ADMIN_MODULES = [
  {
    slug: null,
    href: ADMIN_ROOT,
    label: 'Tableau de bord',
    summary: 'Vue d’ensemble de l’activité et état de votre session.',
    permission: null,
    status: 'DISPONIBLE',
    group: 'PILOTAGE',
    phase: '4C',
  },
  {
    slug: 'commandes',
    href: `${ADMIN_ROOT}commandes/`,
    label: 'Commandes',
    summary: 'Suivi des commandes, statuts, annulations et remboursements.',
    permission: 'orders.view',
    status: 'A_VENIR',
    group: 'ACTIVITE',
    phase: '4G',
  },
  {
    slug: 'demandes',
    href: `${ADMIN_ROOT}demandes/`,
    label: 'Demandes et devis',
    summary: 'Demandes reçues, devis émis, acceptations et refus.',
    permission: 'quotes.view',
    status: 'A_VENIR',
    group: 'ACTIVITE',
    phase: '4F',
  },
  {
    slug: 'rendez-vous',
    href: `${ADMIN_ROOT}rendez-vous/`,
    label: 'Rendez-vous',
    summary: 'Calendrier, disponibilités, créneaux et historique.',
    permission: 'appointments.view',
    status: 'A_VENIR',
    group: 'ACTIVITE',
    phase: '4F',
  },
  {
    slug: 'clients',
    href: `${ADMIN_ROOT}clients/`,
    label: 'Clients',
    summary: 'Fiches clients, historique et données personnelles.',
    permission: 'users.view',
    status: 'A_VENIR',
    group: 'ACTIVITE',
    phase: '4F',
  },
  {
    slug: 'affiliation',
    href: `${ADMIN_ROOT}affiliation/`,
    label: 'Affiliation',
    summary: 'Affiliés, profils, taux, commissions et versements.',
    permission: 'affiliates.view',
    status: 'A_VENIR',
    group: 'ACTIVITE',
    phase: '4H',
  },
  {
    slug: 'paiements',
    href: `${ADMIN_ROOT}paiements/`,
    label: 'Paiements',
    summary: 'Paiements déclarés, vérification et remboursements.',
    permission: 'payments.view',
    status: 'A_VENIR',
    group: 'ACTIVITE',
    phase: '4G',
  },
  {
    slug: 'catalogue',
    href: `${ADMIN_ROOT}catalogue/`,
    label: 'Catalogue',
    summary: 'Services et produits de la Boutique, prix, visuels, publication.',
    permission: 'services.view',
    status: 'A_VENIR',
    group: 'CONTENU',
    phase: '4E',
  },
  {
    slug: 'contenus',
    href: `${ADMIN_ROOT}contenus/`,
    label: 'Contenus',
    summary: 'Pages, blog, médias et coordonnées publiées sur le site.',
    permission: 'content.view',
    status: 'A_VENIR',
    group: 'CONTENU',
    phase: '4E',
  },
  {
    slug: 'notifications',
    href: `${ADMIN_ROOT}notifications/`,
    label: 'Notifications',
    summary: 'Messages internes, e-mails et préférences de diffusion.',
    permission: 'notifications.view',
    status: 'A_VENIR',
    group: 'CONTENU',
    phase: '4J',
  },
  {
    slug: 'marketing',
    href: `${ADMIN_ROOT}marketing/`,
    label: 'Marketing',
    summary: 'Codes promotionnels, campagnes et audiences.',
    permission: 'content.view',
    status: 'A_VENIR',
    group: 'CONTENU',
    phase: '4L',
  },
  {
    slug: 'popups',
    href: `${ADMIN_ROOT}popups/`,
    label: 'Popups',
    summary: 'Fenêtres promotionnelles du site public, ciblage et programmation.',
    permission: 'content.view',
    status: 'A_VENIR',
    group: 'CONTENU',
    phase: '4L',
  },
  {
    slug: 'statistiques',
    href: `${ADMIN_ROOT}statistiques/`,
    label: 'Statistiques',
    summary: 'Indicateurs commerciaux, clients, rendez-vous et affiliation.',
    permission: 'analytics.view',
    status: 'A_VENIR',
    group: 'PILOTAGE',
    phase: '4L',
  },
  {
    slug: 'administrateurs',
    href: `${ADMIN_ROOT}administrateurs/`,
    label: 'Administrateurs',
    summary: 'Comptes administratifs, invitations et permissions individuelles.',
    permission: 'admins.view',
    status: 'DISPONIBLE',
    group: 'SYSTEME',
    phase: '4C',
  },
  {
    slug: 'journal',
    href: `${ADMIN_ROOT}journal/`,
    label: 'Journal d’activité',
    summary: 'Actions sensibles enregistrées, en lecture seule et inaltérables.',
    permission: 'audit.view',
    status: 'DISPONIBLE',
    group: 'SYSTEME',
    phase: '4C',
  },
  {
    slug: 'parametres',
    href: `${ADMIN_ROOT}parametres/`,
    label: 'Paramètres',
    summary: 'Réglages généraux, commerciaux, rendez-vous et affiliation.',
    permission: 'settings.view',
    status: 'A_VENIR',
    group: 'SYSTEME',
    phase: '4K',
  },
] as const satisfies readonly AdminModule[];

export const MODULE_GROUP_ORDER: readonly ModuleGroup[] = [
  'PILOTAGE',
  'ACTIVITE',
  'CONTENU',
  'SYSTEME',
];

/** Retrouve un module par son segment d'URL. */
export function findModule(slug: string | null): AdminModule | undefined {
  return ADMIN_MODULES.find((module) => module.slug === slug);
}

/**
 * Modules qu'un ensemble de permissions ouvre réellement.
 *
 * Utilisé pour la navigation seulement. La décision d'accès reste celle du
 * garde appelé par la page.
 */
export function visibleModules(
  effective: readonly string[],
  allows: (effective: readonly string[], permission: Permission) => boolean,
): AdminModule[] {
  return ADMIN_MODULES.filter(
    (module) => module.permission === null || allows(effective, module.permission),
  );
}
