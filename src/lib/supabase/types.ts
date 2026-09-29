/**
 * Typage du schéma Supabase.
 *
 * Écrit à la main et tenu aligné sur `supabase/migrations/`. Le générateur de
 * types Supabase pourra le remplacer quand le schéma se stabilisera ; d'ici là,
 * une définition manuelle relue reste préférable à un fichier généré que
 * personne ne lit.
 *
 * Phases couvertes : 4A (identité, RBAC, système), 4C (permissions
 * individuelles, invitations d'administrateurs) et 4D (Moteur de Documents).
 * Chaque phase ultérieure ajoute les siennes en même temps que sa migration.
 */

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
    };
    Views: Record<never, never>;
    Functions: {
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
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
