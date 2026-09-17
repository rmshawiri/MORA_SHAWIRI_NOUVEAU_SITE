/**
 * Typage du schéma Supabase.
 *
 * Écrit à la main et tenu aligné sur `supabase/migrations/`. Le générateur de
 * types Supabase pourra le remplacer quand le schéma se stabilisera ; d'ici là,
 * une définition manuelle relue reste préférable à un fichier généré que
 * personne ne lit.
 *
 * Seules les tables de la phase 4A y figurent. Chaque phase ultérieure ajoute
 * les siennes en même temps que sa migration.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type ProfileStatus = 'ACTIF' | 'SUSPENDU' | 'DESACTIVE';
export type SettingScope = 'PUBLIC' | 'PRIVE';
export type AuditResult = 'SUCCES' | 'REFUS' | 'ECHEC';

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
      settings: Table<
        SettingRow,
        Pick<SettingRow, 'key' | 'value' | 'label'> & Partial<SettingRow>
      >;
      audit_logs: Table<AuditLogRow, Omit<Partial<AuditLogRow>, 'id'> & Pick<AuditLogRow, 'action'>>;
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
