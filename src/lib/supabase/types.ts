/**
 * Typage du schéma Supabase.
 *
 * Écrit à la main et tenu aligné sur `supabase/migrations/`. Le générateur de
 * types Supabase pourra le remplacer quand le schéma se stabilisera ; d'ici là,
 * une définition manuelle relue reste préférable à un fichier généré que
 * personne ne lit.
 *
 * Phases couvertes : 4A (identité, RBAC, système), 4C (permissions
 * individuelles, invitations d'administrateurs), 4D (Moteur de Documents),
 * 4E-1 (catalogue administrable), 4E-2 (gestion des contenus) et 4F (relation
 * client : demandes, devis et rendez-vous).
 * Chaque phase ultérieure ajoute les siennes en même temps que sa migration.
 */

import type { AffiliationFunctions, AffiliationTables } from './types-affiliation';
import type { ClientFunctions, ClientTables } from './types-client';
import type { CommercialFunctions, CommercialTables } from './types-commercial';
import type { NotificationFunctions, NotificationTables } from './types-notifications';

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type ProfileStatus = 'ACTIF' | 'SUSPENDU' | 'DESACTIVE';
export type SettingScope = 'PUBLIC' | 'PRIVE';
export type AuditResult = 'SUCCES' | 'REFUS' | 'ECHEC';

/** États d'un document officiel (migration 0005 § 3). */
export type DocumentStatusValue = 'EMIS' | 'ANNULE' | 'REMPLACE';

/** Sens d'un ajustement individuel de permission (migration 0004 § 1). */
export type PermissionEffectValue = 'OCTROI' | 'RETRAIT';

export type ProfileRow = {
  id: string;
  username: string | null;
  full_name: string | null;
  phone: string | null;
  status: ProfileStatus;
  must_change_password: boolean;
  password_changed_at: string | null;
  last_login_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RoleRow = {
  id: string;
  code: string;
  label: string;
  description: string | null;
  is_admin_role: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

export type PermissionRow = {
  id: string;
  code: string;
  domain: string;
  action: string;
  label: string;
  is_critical: boolean;
  created_at: string;
};

export type RolePermissionRow = {
  role_id: string;
  permission_id: string;
  created_at: string;
};

export type UserRoleRow = {
  user_id: string;
  role_id: string;
  granted_by: string | null;
  granted_at: string;
};

/**
 * Octroi ou retrait d'une permission sur un compte précis (décision D-18).
 * Se superpose aux permissions accordées par les rôles.
 */
export type UserPermissionRow = {
  user_id: string;
  permission_id: string;
  effect: PermissionEffectValue;
  granted_by: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Invitation d'un futur administrateur (décision D-19).
 * `token_hash` est une empreinte : le jeton en clair n'existe que dans l'e-mail.
 */
export type AdminInvitationRow = {
  id: string;
  username: string;
  email: string;
  full_name: string | null;
  role_id: string;
  permissions: string[];
  token_hash: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Code documentaire officiel (prompt maître § 75).
 *
 * `view_permission` et `issue_permission` sont des codes du catalogue des 64
 * figé en phase 4A : un document se lit et s'émet avec le droit du domaine
 * métier auquel il appartient, sans permission `documents.*` inventée.
 */
export type DocumentTypeRow = {
  code: string;
  label: string;
  entity_type: string;
  view_permission: string;
  issue_permission: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

/**
 * Document officiel émis (décision D-2, migration 0005).
 *
 * `reference` est immuable après émission — un déclencheur le garantit.
 * `subject_name` est l'instantané du nom à l'émission : il sert au nom de
 * fichier, jamais de clé (§ 77).
 */
export type DocumentRow = {
  id: string;
  reference: string;
  doc_type: string;
  series: string;
  number: number;
  entity_type: string;
  entity_id: string | null;
  owner_id: string | null;
  subject_name: string | null;
  status: DocumentStatusValue;
  version: number;
  replaces_id: string | null;
  storage_path: string | null;
  metadata: Json;
  issued_at: string;
  issued_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Instantané figé d'une pièce officielle (finalisation 4G, migration
 * 20261001120000). `content` est ce que la pièce affiche ; `pdf_*` décrit
 * l'archive du fichier rendu, posée une fois par le serveur.
 */
export type DocumentSnapshotRow = {
  document_id: string;
  doc_type: string;
  schema_version: number;
  content: Json;
  content_sha256: string;
  pdf_path: string | null;
  pdf_sha256: string | null;
  pdf_size: number | null;
  renderer_version: string | null;
  archived_at: string | null;
  created_at: string;
};

/**
 * Compteur transactionnel par type. Aucun rôle applicatif ne le lit : la table
 * porte RLS sans politique. Le type existe pour l'outillage serveur.
 */
export type DocumentSequenceRow = {
  doc_type: string;
  series: string;
  last_number: number;
  allocated_count: number;
  updated_at: string;
};

export type SettingRow = {
  key: string;
  value: Json;
  scope: SettingScope;
  label: string;
  description: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Compteurs de limitation de fréquence (migration 0002 § 3).
 *
 * Aucune politique RLS ne les couvre : seule la clé `service_role` y accède,
 * depuis `src/lib/auth/rate-limit.ts`. `subject_hash` est une empreinte HMAC,
 * jamais l'adresse IP ni l'identifiant en clair.
 */
export type RateLimitCounterRow = {
  bucket: string;
  subject_hash: string;
  window_start: string;
  attempts: number;
  blocked_until: string | null;
  updated_at: string;
};

export type AuditLogRow = {
  id: number;
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  result: AuditResult;
  metadata: Json;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

/* ========================================================================== */
/*  CATALOGUE — migration 0006 (phase 4E)                                     */
/* ========================================================================== */

/** Cycle de vie d'une offre (09_ADMINISTRATION/00 § 28-32). */
export type CatalogueStatus = 'BROUILLON' | 'PUBLIE' | 'NON_PUBLIE' | 'ARCHIVE';

/** Univers auquel une catégorie appartient (09_ADMINISTRATION/00 § 2). */
export type CategoryKind = 'SERVICE' | 'PRODUIT';

/** Parcours commercial de l'offre (plan § 8 ; commerce en ligne § 112). */
export type CommercialMode = 'purchase' | 'quote' | 'appointment' | 'whatsapp';

export type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  kind: CategoryKind;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ServiceRow = {
  id: string;
  slug: string;
  category_id: string;
  title: string;
  tag: string;
  featured_tag: string | null;
  short_description: string;
  description: string;
  benefits: string[];
  price_label: string;
  price_note: string;
  /*
   * `numeric`. Le commentaire d'origine annonçait une chaîne ; vérification
   * faite contre la base, PostgREST sérialise `numeric` sans guillemets et
   * supabase-js rend donc un nombre. Le type reste `string | null` ici pour ne
   * pas toucher au code de 4E qui s'y appuie, mais rien ne doit compter
   * là-dessus : `formatAmount()` accepte les deux formes, et aucun calcul
   * monétaire n'a lieu côté application.
   */
  price_amount: string | null;
  currency: string;
  image_path: string;
  image_alt: string | null;
  cta_label: string;
  request_subject: string;
  internal_href: string | null;
  commercial_mode: CommercialMode;
  status: CatalogueStatus;
  show_in_services: boolean;
  show_in_shop: boolean;
  is_featured: boolean;
  featured_order: number | null;
  sort_order: number;
  affiliate_eligible: boolean;
  affiliate_max_rate: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ProductRow = {
  id: string;
  slug: string;
  category_id: string;
  title: string;
  tag: string;
  short_description: string;
  description: string;
  benefits: string[];
  price_label: string;
  price_note: string;
  price_amount: string | null;
  currency: string;
  image_path: string;
  image_alt: string | null;
  cta_label: string;
  commercial_mode: CommercialMode;
  stock_quantity: number | null;
  status: CatalogueStatus;
  show_in_shop: boolean;
  is_featured: boolean;
  featured_order: number | null;
  sort_order: number;
  affiliate_eligible: boolean;
  affiliate_max_rate: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ProductFileRow = {
  id: string;
  product_id: string;
  label: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type Relationship = {
  foreignKeyName: string;
  columns: readonly string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: readonly string[];
};

type Table<
  Row,
  Insert = Partial<Row>,
  Update = Partial<Row>,
  Relationships extends readonly Relationship[] = [],
> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Relationships;
};

/**
 * Relations déclarées pour que les jointures imbriquées de PostgREST
 * (`select('roles(code)')`) soient typées plutôt que devinées.
 */
type FaqItemRelationships = [
  {
    foreignKeyName: 'faq_items_category_id_fkey';
    columns: ['category_id'];
    isOneToOne: false;
    referencedRelation: 'faq_categories';
    referencedColumns: ['id'];
  },
];

type UserRoleRelationships = [
  {
    foreignKeyName: 'user_roles_role_id_fkey';
    columns: ['role_id'];
    isOneToOne: false;
    referencedRelation: 'roles';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'user_roles_user_id_fkey';
    columns: ['user_id'];
    isOneToOne: false;
    referencedRelation: 'profiles';
    referencedColumns: ['id'];
  },
];

type RolePermissionRelationships = [
  {
    foreignKeyName: 'role_permissions_role_id_fkey';
    columns: ['role_id'];
    isOneToOne: false;
    referencedRelation: 'roles';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'role_permissions_permission_id_fkey';
    columns: ['permission_id'];
    isOneToOne: false;
    referencedRelation: 'permissions';
    referencedColumns: ['id'];
  },
];

type UserPermissionRelationships = [
  {
    foreignKeyName: 'user_permissions_permission_id_fkey';
    columns: ['permission_id'];
    isOneToOne: false;
    referencedRelation: 'permissions';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'user_permissions_user_id_fkey';
    columns: ['user_id'];
    isOneToOne: false;
    referencedRelation: 'profiles';
    referencedColumns: ['id'];
  },
];

type AdminInvitationRelationships = [
  {
    foreignKeyName: 'admin_invitations_role_id_fkey';
    columns: ['role_id'];
    isOneToOne: false;
    referencedRelation: 'roles';
    referencedColumns: ['id'];
  },
];

type DocumentTypeRelationships = [
  {
    foreignKeyName: 'document_types_view_permission_fkey';
    columns: ['view_permission'];
    isOneToOne: false;
    referencedRelation: 'permissions';
    referencedColumns: ['code'];
  },
  {
    foreignKeyName: 'document_types_issue_permission_fkey';
    columns: ['issue_permission'];
    isOneToOne: false;
    referencedRelation: 'permissions';
    referencedColumns: ['code'];
  },
];

type DocumentRelationships = [
  {
    foreignKeyName: 'documents_doc_type_fkey';
    columns: ['doc_type'];
    isOneToOne: false;
    referencedRelation: 'document_types';
    referencedColumns: ['code'];
  },
];

/**
 * Écritures du catalogue.
 *
 * PostgREST **lit** un `numeric` en chaîne, pour ne perdre aucune décimale en
 * route, mais il en **accepte** l'écriture sous forme de nombre. Les deux sens
 * n'ont donc pas le même type, et confondre les deux obligerait chaque
 * appelant à convertir un montant en texte avant de l'envoyer — une
 * conversion de plus, donc une occasion de plus de se tromper de virgule.
 */
type NumericWrite = number | string | null;

/* ----------------------------------------- 4E-2 — gestion des contenus --- */

/** Statuts éditoriaux, communs à tout le site (07_GESTION_CONTENUS § 60). */
export type ContentStatusValue = 'BROUILLON' | 'PUBLIE' | 'NON_PUBLIE' | 'ARCHIVE';

/** Nature d'un bloc éditorial, telle que déclarée au registre du code. */
export type ContentBlockKind = 'HERO' | 'PAGE_HERO' | 'SECTION' | 'CTA' | 'LIST';

/** Surface d'affichage d'une catégorie de FAQ (§ 47, « FAQ par page »). */
export type FaqSurface = 'FAQ' | 'ACCUEIL' | 'SERVICES';

/** Origine d'un média : fichier servi par Next.js, ou objet Storage (D-22 = A). */
export type MediaKind = 'LOCAL' | 'STORAGE';

/**
 * Surcharge d'un bloc éditorial.
 *
 * `published_fields` à `null` signifie « la valeur du registre fait foi » —
 * c'est l'état normal, pas une absence de donnée.
 */
export type ContentBlockRow = {
  id: string;
  key: string;
  kind: ContentBlockKind;
  page_slug: string;
  published_fields: Json | null;
  draft_fields: Json | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FaqCategoryRow = {
  id: string;
  slug: string;
  title: string;
  surface: FaqSurface;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type FaqItemRow = {
  id: string;
  category_id: string;
  question: string;
  answer: string;
  sort_order: number;
  status: ContentStatusValue;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentPostRow = {
  id: string;
  slug: string;
  category: string;
  title: string;
  lead: string;
  excerpt: string;
  author: string | null;
  published_on: string | null;
  date_label: string | null;
  reading_time: string | null;
  cover_path: string | null;
  cover_width: number | null;
  cover_height: number | null;
  cta_title: string | null;
  cta_text: string | null;
  cta_label: string | null;
  cta_href: string | null;
  related: string[];
  body: Json;
  seo_title: string | null;
  seo_description: string | null;
  sort_order: number;
  status: ContentStatusValue;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MediaAssetRow = {
  id: string;
  kind: MediaKind;
  bucket: string | null;
  path: string;
  title: string;
  alt_text: string | null;
  description: string | null;
  category: string | null;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  is_decorative: boolean;
  created_at: string;
  updated_at: string;
};

/* ------------------------------------------------- 4F — relation client --- */

/**
 * Statuts d'une demande — `03_ESPACE_CLIENT.md` § 26, décision C1.
 * Les documents donnent deux listes incompatibles, toutes deux qualifiées
 * d'« exemples » ; chacune est affectée à l'entité qui lui correspond.
 */
export type QuoteRequestStatus =
  | 'NOUVELLE'
  | 'EN_ETUDE'
  | 'DEVIS_ENVOYE'
  | 'ACCEPTEE'
  | 'REFUSEE'
  | 'TERMINEE'
  | 'ANNULEE';

/** Statuts d'un devis émis — `05_TABLEAU_DE_BORD_ADMINISTRATEUR.md` § 39. */
export type QuoteStatus = 'BROUILLON' | 'ENVOYE' | 'ACCEPTE' | 'REFUSE' | 'EXPIRE' | 'ANNULE';

/** Statuts d'un rendez-vous — `02_PRISE_DE_RENDEZ_VOUS.md` § 59. */
export type AppointmentStatus = 'EN_ATTENTE' | 'CONFIRME' | 'ANNULE' | 'TERMINE';

/** Canal du rendez-vous — § 35-39. */
export type AppointmentChannel =
  | 'SUR_PLACE'
  | 'TELEPHONE'
  | 'VISIOCONFERENCE'
  | 'WHATSAPP'
  | 'AUTRE';

/** Nature d'une disponibilité administrée — § 85-88. */
export type AvailabilityKind = 'OUVERTURE' | 'EXCEPTION' | 'BLOCAGE';

export type QuoteRequestEventKind =
  | 'CREATION'
  | 'STATUT'
  | 'DEVIS_CREE'
  | 'DEVIS_STATUT'
  | 'AFFECTATION'
  | 'NOTE';

export type AppointmentEventKind =
  | 'CREATION'
  | 'STATUT'
  | 'REPROGRAMMATION'
  | 'AFFECTATION'
  | 'NOTE';

export type LeadRow = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  user_id: string | null;
  request_count: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export type QuoteRequestRow = {
  id: string;
  reference: string;
  lead_id: string;
  user_id: string | null;
  service_id: string | null;
  offer_title: string | null;
  subject: string;
  budget_label: string | null;
  message: string;
  organisation: string | null;
  details: Json;
  status: QuoteRequestStatus;
  source: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type QuoteRow = {
  id: string;
  quote_request_id: string;
  reference: string | null;
  document_id: string | null;
  service_id: string | null;
  /** `numeric` en base : lu comme chaîne, jamais comme flottant. */
  amount: string;
  currency: string;
  summary: string;
  status: QuoteStatus;
  valid_until: string | null;
  sent_at: string | null;
  responded_at: string | null;
  /** 4I-3 : compte qui a répondu depuis l'espace client (nul si l'administration a saisi). */
  responded_by?: string | null;
  /** 4I-3 : motif facultatif d'un refus par le client. */
  client_response_reason?: string | null;
  /** Remarques 01 : observations imprimées sur le devis. */
  notes?: string | null;
  /** Remarques 01 : version précédente que ce devis remplace. */
  replaces_quote_id?: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type QuoteRequestEventRow = {
  id: number;
  quote_request_id: string;
  kind: QuoteRequestEventKind;
  from_status: string | null;
  to_status: string | null;
  quote_reference: string | null;
  note: string | null;
  actor_id: string | null;
  actor_label: string | null;
  created_at: string;
};

export type AppointmentRow = {
  id: string;
  reference: string | null;
  lead_id: string;
  user_id: string | null;
  quote_request_id: string | null;
  service_id: string | null;
  subject: string;
  channel: AppointmentChannel;
  channel_label: string | null;
  requested_date: string | null;
  requested_slot: string | null;
  scheduled_at: string | null;
  scheduled_end: string | null;
  timezone: string;
  budget_label: string | null;
  message: string | null;
  details: Json;
  status: AppointmentStatus;
  cancel_reason: string | null;
  source: string | null;
  assigned_to: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  /** 4I-3 : compte qui a annulé depuis l'espace client (nul pour une annulation administrative). */
  cancelled_by?: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AppointmentEventRow = {
  id: number;
  appointment_id: string;
  kind: AppointmentEventKind;
  from_status: string | null;
  to_status: string | null;
  scheduled_at_before: string | null;
  scheduled_at_after: string | null;
  note: string | null;
  actor_id: string | null;
  actor_label: string | null;
  created_at: string;
};

export type AppointmentAvailabilityRow = {
  id: string;
  kind: AvailabilityKind;
  weekday: number | null;
  on_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  label: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type RelationNoteRow = {
  id: string;
  quote_request_id: string | null;
  appointment_id: string | null;
  body: string;
  author_id: string | null;
  author_label: string | null;
  created_at: string;
  updated_at: string;
};

/* ------------------------------------ 4G — commandes et paiements --- */

/**
 * Statuts de commande — `09_ADMINISTRATION/02` § 22, arbitrage du
 * propriétaire.
 *
 * Aucun état de paiement n'y figure : le § 151 de `06_PAIEMENTS.md` exige que
 * les deux cycles restent séparés. Ce que le règlement raconte se lit dans
 * `OrderSettlementStatus`, qui est dérivé et non saisi.
 */
export type OrderStatus =
  | 'NOUVELLE'
  | 'CONFIRMEE'
  | 'EN_TRAITEMENT'
  | 'EN_ATTENTE_INFO'
  | 'PRETE'
  | 'TERMINEE'
  | 'ANNULEE';

/** Calculé par la base à partir des seuls paiements confirmés. */
export type OrderSettlementStatus =
  | 'NON_PAYEE'
  | 'PARTIELLE'
  | 'SOLDEE'
  | 'PARTIELLEMENT_REMBOURSEE'
  | 'REMBOURSEE';

/** Statuts de paiement — `06_PAIEMENTS.md` § 22, sans retouche. */
export type PaymentStatus =
  | 'EN_ATTENTE'
  | 'INITIE'
  | 'EN_VERIFICATION'
  | 'PAYE'
  | 'ECHEC'
  | 'ANNULE'
  | 'REMBOURSE'
  | 'PARTIELLEMENT_REMBOURSE';

export type RefundStatus = 'EN_COURS' | 'EFFECTUE' | 'ECHEC' | 'ANNULE';

export type PaymentMethodKind =
  | 'MOBILE_MONEY'
  | 'BANK_TRANSFER'
  | 'CHEQUE'
  | 'CASH'
  | 'ONLINE';

/** MANUEL partout aujourd'hui. API prépare une passerelle, sans en simuler. */
export type PaymentProcessingMode = 'MANUEL' | 'API';

export type OrderEventType =
  | 'COMMANDE_CREEE'
  | 'STATUT_CHANGE'
  | 'MONTANTS_RECALCULES'
  | 'PAIEMENT_DECLARE'
  | 'PAIEMENT_CONFIRME'
  | 'PAIEMENT_REJETE'
  | 'PAIEMENT_ANNULE'
  | 'JUSTIFICATIF_AJOUTE'
  | 'REMBOURSEMENT_ENREGISTRE'
  | 'REMBOURSEMENT_EFFECTUE'
  | 'DOCUMENT_EMIS';

export type PaymentMethodRow = {
  code: string;
  label: string;
  kind: PaymentMethodKind;
  processing_mode: PaymentProcessingMode;
  is_active: boolean;
  instructions: string;
  account_number: string | null;
  account_holder: string | null;
  requires_proof: boolean;
  sort_order: number;
  /** Phase 4H : ce moyen peut servir à verser des commissions. */
  payout_enabled: boolean;
  metadata: Json;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

/**
 * Les montants arrivent en **nombre**, pas en chaîne.
 *
 * PostgREST sérialise `numeric` sans guillemets, et supabase-js le rend donc
 * en `number`. Vérifié contre la base plutôt que supposé. La précision de
 * `numeric(12, 2)` tient largement dans un entier sûr de JavaScript, et
 * surtout : **aucun calcul n'est fait ici**. Le total d'une commande, son
 * montant encaissé et le montant d'une ligne sont écrits par la base, qui
 * travaille en `numeric` ; le code ne fait que les afficher. C'est ce qui rend
 * l'interdiction du flottant (§ 10) tenable sans arithmétique décimale côté
 * navigateur.
 */
export type OrderRow = {
  id: string;
  reference: string;
  document_id: string | null;
  user_id: string;
  lead_id: string | null;
  quote_id: string | null;
  quote_request_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  status: OrderStatus;
  settlement_status: OrderSettlementStatus;
  subtotal_amount: string;
  discount_amount: string;
  fees_amount: string;
  total_amount: string;
  paid_amount: string;
  refunded_amount: string;
  currency: string;
  is_manual: boolean;
  customer_note: string | null;
  admin_note: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  closed_at: string | null;
  created_by: string | null;
  updated_by: string | null;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  service_id: string | null;
  product_id: string | null;
  quote_id: string | null;
  designation: string;
  item_reference: string | null;
  unit_label: string | null;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  line_total: string;
  position: number;
  created_at: string;
  updated_at: string;
};

export type PaymentRow = {
  id: string;
  order_id: string;
  method_code: string;
  amount: string;
  currency: string;
  status: PaymentStatus;
  processing_mode: PaymentProcessingMode;
  declared_by: string | null;
  transaction_reference: string | null;
  transaction_key: string | null;
  external_reference: string | null;
  external_status: string | null;
  declared_at: string | null;
  verified_at: string | null;
  confirmed_at: string | null;
  verified_by: string | null;
  rejection_reason: string | null;
  client_note: string | null;
  admin_note: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type PaymentProofRow = {
  id: string;
  payment_id: string;
  storage_bucket: string;
  storage_path: string;
  original_name: string | null;
  mime_type: string;
  file_size: number;
  checksum: string;
  uploaded_by: string | null;
  uploaded_at: string;
};

export type RefundRow = {
  id: string;
  order_id: string;
  payment_id: string | null;
  document_id: string | null;
  amount: string;
  currency: string;
  status: RefundStatus;
  method_code: string | null;
  external_reference: string | null;
  reason: string;
  requested_at: string;
  completed_at: string | null;
  failed_reason: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type OrderStatusHistoryRow = {
  id: number;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_at: string;
  actor_id: string | null;
  actor_label: string | null;
  note: string | null;
};

export type OrderEventRow = {
  id: number;
  order_id: string;
  payment_id: string | null;
  refund_id: string | null;
  event_type: OrderEventType;
  summary: string;
  amount: string | null;
  occurred_at: string;
  actor_id: string | null;
  actor_label: string | null;
};

/**
 * Colonnes d'une commande qu'une session peut réellement écrire.
 *
 * Ni `reference`, ni `document_id`, ni `user_id`, ni les trois colonnes de
 * règlement : la migration les gèle par déclencheur. Les proposer ici
 * laisserait croire le contraire.
 */
export type OrderWrite = {
  status?: OrderStatus;
  admin_note?: string | null;
  customer_note?: string | null;
  cancel_reason?: string | null;
  fees_amount?: NumericWrite;
};

export type PaymentMethodWrite = {
  label?: string;
  is_active?: boolean;
  instructions?: string;
  account_number?: string | null;
  account_holder?: string | null;
  requires_proof?: boolean;
  sort_order?: number;
};

/**
 * Colonnes réellement modifiables par une session.
 *
 * La migration retire `reference`, `document_id` et `sent_at` du privilège de
 * colonne : les proposer ici laisserait croire qu'une mise à jour directe est
 * envisageable, alors que seule `send_quote` peut les écrire.
 */
export type QuoteWrite = {
  service_id?: string | null;
  amount?: NumericWrite;
  currency?: string;
  summary?: string;
  valid_until?: string | null;
  status?: QuoteStatus;
  responded_at?: string | null;
};

export type ServiceWrite = Omit<Partial<ServiceRow>, 'price_amount' | 'affiliate_max_rate'> & {
  price_amount?: NumericWrite;
  affiliate_max_rate?: NumericWrite;
};

export type ProductWrite = Omit<Partial<ProductRow>, 'price_amount' | 'affiliate_max_rate'> & {
  price_amount?: NumericWrite;
  affiliate_max_rate?: NumericWrite;
};

type ServiceRelationships = [
  {
    foreignKeyName: 'services_category_id_fkey';
    columns: ['category_id'];
    isOneToOne: false;
    referencedRelation: 'categories';
    referencedColumns: ['id'];
  },
];

type ProductRelationships = [
  {
    foreignKeyName: 'products_category_id_fkey';
    columns: ['category_id'];
    isOneToOne: false;
    referencedRelation: 'categories';
    referencedColumns: ['id'];
  },
];

type ProductFileRelationships = [
  {
    foreignKeyName: 'product_files_product_id_fkey';
    columns: ['product_id'];
    isOneToOne: false;
    referencedRelation: 'products';
    referencedColumns: ['id'];
  },
];

/* ------------------------------------------------- 4F — relation client --- */

type QuoteRequestRelationships = [
  {
    foreignKeyName: 'quote_requests_lead_id_fkey';
    columns: ['lead_id'];
    isOneToOne: false;
    referencedRelation: 'leads';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'quote_requests_service_id_fkey';
    columns: ['service_id'];
    isOneToOne: false;
    referencedRelation: 'services';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'quote_requests_assigned_to_fkey';
    columns: ['assigned_to'];
    isOneToOne: false;
    referencedRelation: 'profiles';
    referencedColumns: ['id'];
  },
];

type QuoteRelationships = [
  {
    foreignKeyName: 'quotes_quote_request_id_fkey';
    columns: ['quote_request_id'];
    isOneToOne: false;
    referencedRelation: 'quote_requests';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'quotes_document_id_fkey';
    columns: ['document_id'];
    isOneToOne: false;
    referencedRelation: 'documents';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'quotes_service_id_fkey';
    columns: ['service_id'];
    isOneToOne: false;
    referencedRelation: 'services';
    referencedColumns: ['id'];
  },
];

type QuoteRequestEventRelationships = [
  {
    foreignKeyName: 'quote_request_events_quote_request_id_fkey';
    columns: ['quote_request_id'];
    isOneToOne: false;
    referencedRelation: 'quote_requests';
    referencedColumns: ['id'];
  },
];

type AppointmentRelationships = [
  {
    foreignKeyName: 'appointments_lead_id_fkey';
    columns: ['lead_id'];
    isOneToOne: false;
    referencedRelation: 'leads';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'appointments_quote_request_id_fkey';
    columns: ['quote_request_id'];
    isOneToOne: false;
    referencedRelation: 'quote_requests';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'appointments_service_id_fkey';
    columns: ['service_id'];
    isOneToOne: false;
    referencedRelation: 'services';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'appointments_assigned_to_fkey';
    columns: ['assigned_to'];
    isOneToOne: false;
    referencedRelation: 'profiles';
    referencedColumns: ['id'];
  },
];

type AppointmentEventRelationships = [
  {
    foreignKeyName: 'appointment_events_appointment_id_fkey';
    columns: ['appointment_id'];
    isOneToOne: false;
    referencedRelation: 'appointments';
    referencedColumns: ['id'];
  },
];

type RelationNoteRelationships = [
  {
    foreignKeyName: 'relation_notes_quote_request_id_fkey';
    columns: ['quote_request_id'];
    isOneToOne: false;
    referencedRelation: 'quote_requests';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'relation_notes_appointment_id_fkey';
    columns: ['appointment_id'];
    isOneToOne: false;
    referencedRelation: 'appointments';
    referencedColumns: ['id'];
  },
];

/* ------------------------------------ 4G — commandes et paiements --- */

type OrderRelationships = [
  {
    foreignKeyName: 'orders_quote_id_fkey';
    columns: ['quote_id'];
    isOneToOne: true;
    referencedRelation: 'quotes';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'orders_lead_id_fkey';
    columns: ['lead_id'];
    isOneToOne: false;
    referencedRelation: 'leads';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'orders_quote_request_id_fkey';
    columns: ['quote_request_id'];
    isOneToOne: false;
    referencedRelation: 'quote_requests';
    referencedColumns: ['id'];
  },
];

type OrderItemRelationships = [
  {
    foreignKeyName: 'order_items_order_id_fkey';
    columns: ['order_id'];
    isOneToOne: false;
    referencedRelation: 'orders';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'order_items_service_id_fkey';
    columns: ['service_id'];
    isOneToOne: false;
    referencedRelation: 'services';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'order_items_product_id_fkey';
    columns: ['product_id'];
    isOneToOne: false;
    referencedRelation: 'products';
    referencedColumns: ['id'];
  },
];

type PaymentRelationships = [
  {
    foreignKeyName: 'payments_order_id_fkey';
    columns: ['order_id'];
    isOneToOne: false;
    referencedRelation: 'orders';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'payments_method_code_fkey';
    columns: ['method_code'];
    isOneToOne: false;
    referencedRelation: 'payment_methods';
    referencedColumns: ['code'];
  },
];

type PaymentProofRelationships = [
  {
    foreignKeyName: 'payment_proofs_payment_id_fkey';
    columns: ['payment_id'];
    isOneToOne: false;
    referencedRelation: 'payments';
    referencedColumns: ['id'];
  },
];

type RefundRelationships = [
  {
    foreignKeyName: 'refunds_order_id_fkey';
    columns: ['order_id'];
    isOneToOne: false;
    referencedRelation: 'orders';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'refunds_payment_id_fkey';
    columns: ['payment_id'];
    isOneToOne: false;
    referencedRelation: 'payments';
    referencedColumns: ['id'];
  },
];

type OrderStatusHistoryRelationships = [
  {
    foreignKeyName: 'order_status_history_order_id_fkey';
    columns: ['order_id'];
    isOneToOne: false;
    referencedRelation: 'orders';
    referencedColumns: ['id'];
  },
];

type OrderEventRelationships = [
  {
    foreignKeyName: 'order_events_order_id_fkey';
    columns: ['order_id'];
    isOneToOne: false;
    referencedRelation: 'orders';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'order_events_payment_id_fkey';
    columns: ['payment_id'];
    isOneToOne: false;
    referencedRelation: 'payments';
    referencedColumns: ['id'];
  },
];

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        ProfileRow,
        Pick<ProfileRow, 'id'> & Partial<Omit<ProfileRow, 'id'>>,
        Partial<ProfileRow>
      >;
      roles: Table<RoleRow, Pick<RoleRow, 'code' | 'label'> & Partial<RoleRow>>;
      permissions: Table<
        PermissionRow,
        Pick<PermissionRow, 'code' | 'domain' | 'action' | 'label'> & Partial<PermissionRow>
      >;
      role_permissions: Table<
        RolePermissionRow,
        Pick<RolePermissionRow, 'role_id' | 'permission_id'>,
        Partial<RolePermissionRow>,
        RolePermissionRelationships
      >;
      user_roles: Table<
        UserRoleRow,
        Pick<UserRoleRow, 'user_id' | 'role_id'> & Partial<UserRoleRow>,
        Partial<UserRoleRow>,
        UserRoleRelationships
      >;
      user_permissions: Table<
        UserPermissionRow,
        Pick<UserPermissionRow, 'user_id' | 'permission_id'> & Partial<UserPermissionRow>,
        Partial<UserPermissionRow>,
        UserPermissionRelationships
      >;
      admin_invitations: Table<
        AdminInvitationRow,
        Pick<
          AdminInvitationRow,
          'username' | 'email' | 'role_id' | 'token_hash' | 'expires_at'
        > &
          Partial<AdminInvitationRow>,
        Partial<AdminInvitationRow>,
        AdminInvitationRelationships
      >;
      document_types: Table<
        DocumentTypeRow,
        Pick<
          DocumentTypeRow,
          'code' | 'label' | 'entity_type' | 'view_permission' | 'issue_permission'
        > &
          Partial<DocumentTypeRow>,
        Partial<DocumentTypeRow>,
        DocumentTypeRelationships
      >;
      /**
       * Lecture seule côté application : aucun privilège d'écriture n'est
       * accordé au rôle `authenticated`, et l'émission passe exclusivement par
       * `issue_document()` (prompt maître § 36).
       */
      documents: Table<DocumentRow, never, Partial<DocumentRow>, DocumentRelationships>;
      document_sequences: Table<DocumentSequenceRow, never, never>;
      /** Lecture seule : l'instantané naît dans `issue_order_invoice()`. */
      document_snapshots: Table<DocumentSnapshotRow, never, never>;
      categories: Table<
        CategoryRow,
        Pick<CategoryRow, 'slug' | 'name' | 'kind'> & Partial<CategoryRow>,
        Partial<CategoryRow>
      >;
      /**
       * `published_at` n'est pas laissé à l'application : le déclencheur
       * `catalogue_publication_guard` l'écrit, et exige `services.publish`
       * pour toute entrée ou sortie du statut PUBLIE.
       */
      services: Table<
        ServiceRow,
        Pick<
          ServiceRow,
          | 'slug'
          | 'category_id'
          | 'title'
          | 'tag'
          | 'short_description'
          | 'description'
          | 'price_label'
          | 'image_path'
          | 'cta_label'
          | 'request_subject'
        > &
          ServiceWrite,
        ServiceWrite,
        ServiceRelationships
      >;
      products: Table<
        ProductRow,
        Pick<
          ProductRow,
          | 'slug'
          | 'category_id'
          | 'title'
          | 'tag'
          | 'short_description'
          | 'description'
          | 'price_label'
          | 'image_path'
          | 'cta_label'
        > &
          ProductWrite,
        ProductWrite,
        ProductRelationships
      >;
      product_files: Table<
        ProductFileRow,
        Pick<ProductFileRow, 'product_id' | 'label' | 'storage_path'> & Partial<ProductFileRow>,
        Partial<ProductFileRow>,
        ProductFileRelationships
      >;
      /**
       * `published_at` n'est écrit ni lu par l'application : le déclencheur
       * `contenus_publication_guard` s'en charge, et exige `content.publish`
       * pour toute mise en ligne ou tout retrait.
       */
      content_blocks: Table<
        ContentBlockRow,
        Pick<ContentBlockRow, 'key' | 'kind' | 'page_slug'> & Partial<ContentBlockRow>,
        Partial<ContentBlockRow>
      >;
      faq_categories: Table<
        FaqCategoryRow,
        Pick<FaqCategoryRow, 'slug' | 'title'> & Partial<FaqCategoryRow>,
        Partial<FaqCategoryRow>
      >;
      faq_items: Table<
        FaqItemRow,
        Pick<FaqItemRow, 'category_id' | 'question' | 'answer'> & Partial<FaqItemRow>,
        Partial<FaqItemRow>,
        FaqItemRelationships
      >;
      content_posts: Table<
        ContentPostRow,
        Pick<ContentPostRow, 'slug' | 'category' | 'title' | 'lead' | 'excerpt'> &
          Partial<ContentPostRow>,
        Partial<ContentPostRow>
      >;
      media_assets: Table<
        MediaAssetRow,
        Pick<MediaAssetRow, 'kind' | 'path' | 'title'> & Partial<MediaAssetRow>,
        Partial<MediaAssetRow>
      >;
      settings: Table<
        SettingRow,
        Pick<SettingRow, 'key' | 'value' | 'label'> & Partial<SettingRow>
      >;
      audit_logs: Table<AuditLogRow, Omit<Partial<AuditLogRow>, 'id'> & Pick<AuditLogRow, 'action'>>;
      rate_limit_counters: Table<
        RateLimitCounterRow,
        Pick<RateLimitCounterRow, 'bucket' | 'subject_hash' | 'window_start'> &
          Partial<RateLimitCounterRow>
      >;

      /* ----------------------------------------- 4F — relation client --- */

      /**
       * `Insert` vaut `never` pour les quatre tables dont la création ne passe
       * pas par une session : prospects, demandes et rendez-vous naissent des
       * fonctions `submit_*`, les historiques des déclencheurs. Le type dit
       * donc la même chose que le privilège de table — un `insert()` sur ces
       * tables ne compile pas, au lieu d'échouer à l'exécution.
       */
      leads: Table<LeadRow, never, never>;
      quote_requests: Table<
        QuoteRequestRow,
        never,
        Partial<
          Pick<
            QuoteRequestRow,
            | 'service_id'
            | 'offer_title'
            | 'subject'
            | 'budget_label'
            | 'organisation'
            | 'details'
            | 'status'
            | 'source'
            | 'assigned_to'
            | 'closed_at'
          >
        >,
        QuoteRequestRelationships
      >;
      quotes: Table<
        QuoteRow,
        Pick<QuoteRow, 'quote_request_id'> & { amount: NumericWrite } & QuoteWrite,
        QuoteWrite,
        QuoteRelationships
      >;
      quote_request_events: Table<QuoteRequestEventRow, never, never, QuoteRequestEventRelationships>;
      appointments: Table<
        AppointmentRow,
        never,
        Partial<
          Pick<
            AppointmentRow,
            | 'quote_request_id'
            | 'service_id'
            | 'subject'
            | 'channel'
            | 'channel_label'
            | 'requested_date'
            | 'requested_slot'
            | 'scheduled_at'
            | 'scheduled_end'
            | 'timezone'
            | 'budget_label'
            | 'message'
            | 'details'
            | 'status'
            | 'cancel_reason'
            | 'source'
            | 'assigned_to'
            | 'cancelled_at'
            | 'completed_at'
          >
        >,
        AppointmentRelationships
      >;
      appointment_events: Table<AppointmentEventRow, never, never, AppointmentEventRelationships>;
      appointment_availabilities: Table<
        AppointmentAvailabilityRow,
        Pick<AppointmentAvailabilityRow, 'kind'> & Partial<AppointmentAvailabilityRow>,
        Partial<AppointmentAvailabilityRow>
      >;
      relation_notes: Table<
        RelationNoteRow,
        Pick<RelationNoteRow, 'body'> & Partial<RelationNoteRow>,
        Partial<Pick<RelationNoteRow, 'body'>>,
        RelationNoteRelationships
      >;

      /* --------------------------- 4G — commerce --- */

      /*
       * `never` en Insert marque les tables qu'aucune session n'alimente
       * directement : une commande naît d'une fonction qui lui alloue sa
       * référence officielle, un paiement de `declare_payment`, un
       * remboursement de `record_refund`. Le type dit ce que la base impose.
       */
      payment_methods: Table<PaymentMethodRow, never, PaymentMethodWrite>;
      orders: Table<OrderRow, never, OrderWrite, OrderRelationships>;
      order_items: Table<
        OrderItemRow,
        Pick<OrderItemRow, 'order_id' | 'designation' | 'unit_price'> & Partial<OrderItemRow>,
        Partial<OrderItemRow>,
        OrderItemRelationships
      >;
      payments: Table<PaymentRow, never, Partial<PaymentRow>, PaymentRelationships>;
      payment_proofs: Table<PaymentProofRow, never, never, PaymentProofRelationships>;
      refunds: Table<RefundRow, never, never, RefundRelationships>;
      order_status_history: Table<
        OrderStatusHistoryRow,
        never,
        never,
        OrderStatusHistoryRelationships
      >;
      order_events: Table<OrderEventRow, never, never, OrderEventRelationships>;
    } & AffiliationTables &
      ClientTables &
      CommercialTables &
      NotificationTables;
    Views: Record<never, never>;
    Functions: AffiliationFunctions &
      ClientFunctions &
      CommercialFunctions &
      NotificationFunctions & {
      current_permissions: {
        Args: Record<string, never>;
        Returns: string[];
      };
      has_permission: {
        Args: { p_permission: string };
        Returns: boolean;
      };
      effective_permissions: {
        Args: { p_user_id: string };
        Returns: string[];
      };
      account_permissions: {
        Args: { p_user_id: string };
        Returns: { code: string; from_role: boolean; effect: string | null; effective: boolean }[];
      };
      role_permissions_of: {
        Args: { p_user_id: string };
        Returns: string[];
      };
      user_holds_permission: {
        Args: { p_user_id: string; p_permission: string };
        Returns: boolean;
      };
      count_active_holders: {
        Args: { p_permission: string };
        Returns: number;
      };
      session_is_aal2: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      /**
       * Moteur de Documents (phase 4D). `allocate_document_number` n'apparaît
       * pas ici : elle n'est exécutable que par `service_role`, et la déclarer
       * laisserait croire qu'un appel applicatif est envisageable.
       */
      issue_document: {
        Args: {
          p_type: string;
          p_entity_type?: string | null;
          p_entity_id?: string | null;
          p_owner_id?: string | null;
          p_subject_name?: string | null;
          p_metadata?: Json;
          p_replaces?: string | null;
        };
        Returns: DocumentRow;
      };
      document_next_series: {
        Args: { p_series: string };
        Returns: string;
      };
      can_read_document_type: {
        Args: { p_type: string };
        Returns: boolean;
      };
      /** Catalogue complet, brouillons compris (migration 0006 § 1). */
      can_view_catalogue: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      bump_rate_limit: {
        Args: {
          p_bucket: string;
          p_subject_hash: string;
          p_window_start: string;
          p_blocked_until?: string | null;
        };
        Returns: number;
      };
      has_role: {
        Args: { p_role_code: string };
        Returns: boolean;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      mark_password_changed: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      record_audit_event: {
        Args: {
          p_action: string;
          p_resource_type?: string | null;
          p_resource_id?: string | null;
          p_result?: AuditResult;
          p_metadata?: Json;
        };
        Returns: number;
      };

      /* ----------------------------------------- 4F — relation client --- */

      /**
       * Les deux portes publiques. `relation_upsert_lead` et
       * `relation_rate_limit_ok` n'apparaissent pas : réservées à
       * `service_role`, les déclarer laisserait croire qu'un appel applicatif
       * est envisageable — la même règle que pour `allocate_document_number`.
       *
       * Aucun paramètre ne porte d'identifiant d'utilisateur : le rattachement
       * est lu dans `auth.uid()` à l'intérieur de la fonction.
       */
      submit_quote_request: {
        Args: {
          p_full_name: string;
          p_email: string;
          p_phone?: string | null;
          p_organisation?: string | null;
          p_subject?: string | null;
          p_budget?: string | null;
          p_message?: string | null;
          p_service_slug?: string | null;
          p_offer_title?: string | null;
          p_details?: Json;
          p_source?: string | null;
          p_client_hash?: string | null;
        };
        Returns: { reference: string; duplicate: boolean }[];
      };
      submit_appointment_request: {
        Args: {
          p_full_name: string;
          p_email: string;
          p_phone?: string | null;
          p_organisation?: string | null;
          p_subject?: string | null;
          p_channel_label?: string | null;
          p_requested_date?: string | null;
          p_requested_slot?: string | null;
          p_budget?: string | null;
          p_message?: string | null;
          p_service_slug?: string | null;
          p_details?: Json;
          p_source?: string | null;
          p_client_hash?: string | null;
        };
        Returns: { created: boolean; duplicate: boolean }[];
      };
      confirm_appointment: {
        Args: {
          p_appointment_id: string;
          p_scheduled_at: string;
          p_scheduled_end: string;
        };
        Returns: AppointmentRow;
      };
      send_quote: {
        Args: { p_quote_id: string };
        Returns: QuoteRow;
      };
      appointment_slot_is_open: {
        Args: { p_start: string; p_end: string };
        Returns: boolean;
      };
      can_view_demandes: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      can_view_rendez_vous: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      can_view_prospects: {
        Args: Record<string, never>;
        Returns: boolean;
      };

      /* ------------------------------ 4G — commerce --- */

      /*
       * `recompute_order_settlement` n'est pas déclarée : réservée à
       * `service_role`, comme `allocate_document_number`. La déclarer
       * laisserait croire qu'un appel applicatif est envisageable, alors
       * qu'elle est précisément ce qui empêche d'écrire un règlement.
       *
       * Aucune de ces signatures ne prend d'identifiant d'utilisateur, de
       * statut ni de total : le point 17 du cadrage les énumère comme des
       * valeurs que le navigateur ne doit jamais choisir, et la façon la plus
       * sûre de le garantir est qu'elles ne soient pas des paramètres.
       */
      place_order_from_quote: {
        Args: { p_quote_id: string };
        Returns: OrderRow;
      };
      create_manual_order: {
        Args: {
          p_user_id: string;
          p_items: Json;
          p_fees?: NumericWrite;
          p_note?: string | null;
        };
        Returns: OrderRow;
      };
      declare_payment: {
        Args: {
          p_order_id: string;
          p_method_code: string;
          p_amount: NumericWrite;
          p_transaction_reference?: string | null;
          p_client_note?: string | null;
        };
        Returns: PaymentRow;
      };
      verify_payment: {
        Args: { p_payment_id: string; p_admin_note?: string | null };
        Returns: PaymentRow;
      };
      reject_payment: {
        Args: { p_payment_id: string; p_reason: string };
        Returns: PaymentRow;
      };
      cancel_order: {
        Args: { p_order_id: string; p_reason: string };
        Returns: OrderRow;
      };
      record_refund: {
        Args: {
          p_order_id: string;
          p_amount: NumericWrite;
          p_reason: string;
          p_payment_id?: string | null;
          p_method_code?: string | null;
        };
        Returns: RefundRow;
      };
      complete_refund: {
        Args: { p_refund_id: string; p_external_reference?: string | null };
        Returns: RefundRow;
      };
      issue_order_invoice: {
        Args: { p_order_id: string };
        Returns: DocumentRow;
      };
      record_document_archive: {
        Args: {
          p_document_id: string;
          p_path: string;
          p_sha256: string;
          p_size: number;
          p_renderer: string;
        };
        Returns: DocumentSnapshotRow;
      };
      attach_payment_proof: {
        Args: {
          p_payment_id: string;
          p_storage_path: string;
          p_mime_type: string;
          p_file_size: number;
          p_checksum: string;
          p_original_name?: string | null;
        };
        Returns: PaymentProofRow;
      };
      active_payment_methods: {
        Args: Record<string, never>;
        Returns: Pick<
          PaymentMethodRow,
          | 'code'
          | 'label'
          | 'kind'
          | 'instructions'
          | 'account_number'
          | 'account_holder'
          | 'requires_proof'
          | 'sort_order'
        >[];
      };
      can_view_commandes: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      can_view_paiements: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
