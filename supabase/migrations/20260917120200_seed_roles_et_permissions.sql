-- =============================================================================
-- MORA SHAWIRI — Migration 0003
-- Données initiales : catalogue des permissions, rôles système, affectations.
--
-- Référence : 07_ARCHITECTURE_TECHNIQUE/02_ROLES_ET_PERMISSIONS.md § 30-45,
--             § 49 (administrateur standard), § 99-103 (séparation), § 106.
--
-- Cette migration ne crée AUCUN compte et ne contient AUCUN mot de passe. Le
-- provisionnement des comptes est une opération distincte, réalisée par
-- `scripts/provision-admins.mjs` à partir de variables d'environnement.
--
-- Entièrement rejouable : chaque insertion est idempotente.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. CATALOGUE DES PERMISSIONS
--
-- Nomenclature `domaine.action`. `is_critical` marque les permissions du § 142 :
-- gestion des administrateurs, modification des permissions, paramètres de
-- sécurité, opérations financières, suppression définitive.
-- -----------------------------------------------------------------------------

insert into public.permissions (code, domain, action, label, is_critical) values
  -- Utilisateurs (§ 30)
  ('users.view',            'users',         'view',        'Consulter les utilisateurs',                 false),
  ('users.create',          'users',         'create',      'Créer un utilisateur',                       false),
  ('users.update',          'users',         'update',      'Modifier un utilisateur',                    false),
  ('users.disable',         'users',         'disable',     'Désactiver un utilisateur',                  false),
  ('users.delete',          'users',         'delete',      'Supprimer définitivement un utilisateur',    true),

  -- Administrateurs (§ 31) — intégralement critiques (§ 115)
  ('admins.view',           'admins',        'view',        'Consulter les administrateurs',              false),
  ('admins.create',         'admins',        'create',      'Créer un administrateur',                    true),
  ('admins.update',         'admins',        'update',      'Modifier un administrateur',                 true),
  ('admins.disable',        'admins',        'disable',     'Désactiver un administrateur',               true),
  ('admins.delete',         'admins',        'delete',      'Supprimer un administrateur',                true),
  ('admins.permissions',    'admins',        'permissions', 'Attribuer rôles et permissions',             true),

  -- Services (§ 32)
  ('services.view',         'services',      'view',        'Consulter les services',                     false),
  ('services.create',       'services',      'create',      'Créer un service',                           false),
  ('services.update',       'services',      'update',      'Modifier un service',                        false),
  ('services.delete',       'services',      'delete',      'Supprimer un service',                       true),
  ('services.publish',      'services',      'publish',     'Publier ou dépublier un service',            false),

  -- Produits (§ 33)
  ('products.view',         'products',      'view',        'Consulter les produits',                     false),
  ('products.create',       'products',      'create',      'Créer un produit',                           false),
  ('products.update',       'products',      'update',      'Modifier un produit',                        false),
  ('products.delete',       'products',      'delete',      'Supprimer un produit',                       true),
  ('products.publish',      'products',      'publish',     'Publier ou dépublier un produit',            false),

  -- Commandes (§ 34)
  ('orders.view',           'orders',        'view',        'Consulter les commandes',                    false),
  ('orders.update',         'orders',        'update',      'Modifier une commande',                      false),
  ('orders.cancel',         'orders',        'cancel',      'Annuler une commande',                       false),
  ('orders.refund',         'orders',        'refund',      'Rembourser une commande',                    true),

  -- Paiements (§ 35) — permissions financières
  ('payments.view',         'payments',      'view',        'Consulter les paiements',                    false),
  ('payments.verify',       'payments',      'verify',      'Vérifier un paiement déclaré',               true),
  ('payments.refund',       'payments',      'refund',      'Enregistrer un remboursement',               true),

  -- Devis (§ 36)
  ('quotes.view',           'quotes',        'view',        'Consulter les devis',                        false),
  ('quotes.create',         'quotes',        'create',      'Créer un devis',                             false),
  ('quotes.update',         'quotes',        'update',      'Modifier un devis',                          false),
  ('quotes.delete',         'quotes',        'delete',      'Supprimer un devis',                         true),
  ('quotes.manage',         'quotes',        'manage',      'Gérer le cycle de vie des devis',            false),

  -- Rendez-vous (§ 37)
  ('appointments.view',     'appointments',  'view',        'Consulter les rendez-vous',                  false),
  ('appointments.create',   'appointments',  'create',      'Créer un rendez-vous',                       false),
  ('appointments.update',   'appointments',  'update',      'Modifier un rendez-vous',                    false),
  ('appointments.cancel',   'appointments',  'cancel',      'Annuler un rendez-vous',                     false),
  ('appointments.manage',   'appointments',  'manage',      'Gérer les disponibilités',                   false),

  -- Affiliation (§ 38)
  ('affiliates.view',       'affiliates',    'view',        'Consulter les affiliés',                     false),
  ('affiliates.create',     'affiliates',    'create',      'Créer un affilié',                           false),
  ('affiliates.update',     'affiliates',    'update',      'Modifier un affilié, dont son taux',         true),
  ('affiliates.disable',    'affiliates',    'disable',     'Suspendre ou désactiver un affilié',         true),
  ('commissions.view',      'commissions',   'view',        'Consulter les commissions',                  false),
  ('commissions.manage',    'commissions',   'manage',      'Ajuster ou annuler une commission',          true),
  ('commissions.validate',  'commissions',   'validate',    'Valider une commission',                     true),
  ('payouts.manage',        'payouts',       'manage',      'Enregistrer un versement de commission',     true),

  -- Contenus (§ 39)
  ('content.view',          'content',       'view',        'Consulter les contenus',                     false),
  ('content.create',        'content',       'create',      'Créer un contenu',                           false),
  ('content.update',        'content',       'update',      'Modifier un contenu',                        false),
  ('content.delete',        'content',       'delete',      'Supprimer un contenu',                       true),
  ('content.publish',       'content',       'publish',     'Publier ou dépublier un contenu',            false),

  -- Médias (§ 40)
  ('media.view',            'media',         'view',        'Consulter la médiathèque',                   false),
  ('media.upload',          'media',         'upload',      'Téléverser un média',                        false),
  ('media.update',          'media',         'update',      'Modifier un média',                          false),
  ('media.delete',          'media',         'delete',      'Supprimer un média',                         true),

  -- Notifications (§ 41)
  ('notifications.view',    'notifications', 'view',        'Consulter les notifications',                false),
  ('notifications.create',  'notifications', 'create',      'Émettre une notification',                   false),
  ('notifications.manage',  'notifications', 'manage',      'Gérer les notifications et leurs modèles',   false),

  -- Paramètres (§ 42)
  ('settings.view',         'settings',      'view',        'Consulter les paramètres',                   false),
  ('settings.update',       'settings',      'update',      'Modifier les paramètres',                    true),

  -- Statistiques (§ 43)
  ('analytics.view',        'analytics',     'view',        'Consulter les statistiques',                 false),
  ('analytics.manage',      'analytics',     'manage',      'Configurer la mesure d''audience',           false),

  -- Audit (§ 44)
  ('audit.view',            'audit',         'view',        'Consulter le journal d''audit',              true),

  -- Permission globale (§ 45)
  ('admin.full_access',     'admin',         'full_access', 'Accès complet à l''administration',          true)
on conflict (code) do update
  set domain      = excluded.domain,
      action      = excluded.action,
      label       = excluded.label,
      is_critical = excluded.is_critical;


-- -----------------------------------------------------------------------------
-- 2. RÔLES SYSTÈME
--
-- Quatre rôles seulement. Les rôles évoqués comme évolution possible par le
-- § 99-103 (finance, contenu, support) ne sont PAS créés : l'architecture
-- permet de les ajouter depuis l'administration, ce qui est exactement la
-- préparation demandée. Créer des rôles vides que personne n'utilise
-- reviendrait à inventer.
-- -----------------------------------------------------------------------------

insert into public.roles (code, label, description, is_admin_role, is_system) values
  ('SUPER_ADMIN', 'Super administrateur',
   'Contrôle complet de la plateforme, dont la gestion des administrateurs et des permissions.',
   true, true),

  ('ADMIN', 'Administrateur',
   'Administration opérationnelle : catalogue, commandes, clients, rendez-vous, contenus, notifications. Ne gère ni les administrateurs, ni les permissions, ni les opérations financières.',
   true, true),

  ('CLIENT', 'Client',
   'Accès à l''espace client et à ses propres données uniquement.',
   false, true),

  ('AFFILIE', 'Affilié',
   'Accès à l''espace affilié et à ses propres données d''affiliation uniquement.',
   false, true)
on conflict (code) do update
  set label         = excluded.label,
      description   = excluded.description,
      is_admin_role = excluded.is_admin_role,
      is_system     = true;


-- -----------------------------------------------------------------------------
-- 3. PERMISSIONS DU SUPER ADMINISTRATEUR
--
-- Une seule permission : `admin.full_access` (§ 45). La fonction
-- `public.has_permission()` la reconnaît comme couvrant l'ensemble. Multiplier
-- les lignes n'ajouterait rien et ferait diverger deux sources de vérité.
-- -----------------------------------------------------------------------------

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.code = 'SUPER_ADMIN'
  and p.code = 'admin.full_access'
on conflict do nothing;


-- -----------------------------------------------------------------------------
-- 4. PERMISSIONS DE L'ADMINISTRATEUR STANDARD
--
-- Conforme au § 49 : périmètre opérationnel, sans capacité de créer un
-- administrateur, de modifier des permissions critiques ni de toucher aux
-- paramètres de sécurité. Les opérations financières (vérification de
-- paiement, remboursement, commissions, versements) en sont volontairement
-- exclues : elles relèvent du § 35 et du § 69.
-- -----------------------------------------------------------------------------

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in (
  'users.view', 'users.create', 'users.update', 'users.disable',
  'admins.view',
  'services.view', 'services.create', 'services.update', 'services.publish',
  'products.view', 'products.create', 'products.update', 'products.publish',
  'orders.view', 'orders.update', 'orders.cancel',
  'payments.view',
  'quotes.view', 'quotes.create', 'quotes.update', 'quotes.manage',
  'appointments.view', 'appointments.create', 'appointments.update',
  'appointments.cancel', 'appointments.manage',
  'affiliates.view',
  'commissions.view',
  'content.view', 'content.create', 'content.update', 'content.publish',
  'media.view', 'media.upload', 'media.update',
  'notifications.view', 'notifications.create', 'notifications.manage',
  'settings.view',
  'analytics.view'
)
where r.code = 'ADMIN'
on conflict do nothing;

-- Retrait de toute permission qui aurait été accordée au rôle ADMIN en dehors
-- de la liste ci-dessus : rejouer la migration réaligne le rôle sur sa
-- définition documentée.
delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.code = 'ADMIN'
  and p.code not in (
    'users.view', 'users.create', 'users.update', 'users.disable',
    'admins.view',
    'services.view', 'services.create', 'services.update', 'services.publish',
    'products.view', 'products.create', 'products.update', 'products.publish',
    'orders.view', 'orders.update', 'orders.cancel',
    'payments.view',
    'quotes.view', 'quotes.create', 'quotes.update', 'quotes.manage',
    'appointments.view', 'appointments.create', 'appointments.update',
    'appointments.cancel', 'appointments.manage',
    'affiliates.view',
    'commissions.view',
    'content.view', 'content.create', 'content.update', 'content.publish',
    'media.view', 'media.upload', 'media.update',
    'notifications.view', 'notifications.create', 'notifications.manage',
    'settings.view',
    'analytics.view'
  );


-- -----------------------------------------------------------------------------
-- 5. CLIENT ET AFFILIÉ — aucune permission administrative
--
-- Leur accès ne passe pas par une permission mais par la propriété de la
-- ressource, vérifiée par RLS. C'est une application directe du refus par
-- défaut (§ 106) : ce qui n'est pas accordé est refusé.
-- -----------------------------------------------------------------------------

delete from public.role_permissions rp
using public.roles r
where rp.role_id = r.id and r.code in ('CLIENT', 'AFFILIE');
