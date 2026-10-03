import 'server-only';

/**
 * Indicateurs du tableau de bord — remarques 01 (A1).
 *
 * ## Ce qui est compté
 *
 * Uniquement ce que les modules livrés enregistrent réellement : demandes,
 * devis, commandes, paiements, rendez-vous, clients, affiliation. Aucun
 * chiffre n'est estimé, aucun n'est inventé (§ 12 et § 138 du tableau de
 * bord) ; un indicateur qu'on ne peut pas lire s'affiche « — », jamais 0.
 *
 * ## Qui voit quoi
 *
 * Deux barrières, comme partout :
 *
 *   1. un indicateur n'est **calculé** que si le compte détient la
 *      permission de consultation du module — un ADMIN sans `orders.view` ne
 *      reçoit ni la carte ni le chiffre, pas même un zéro ;
 *   2. le comptage passe par la **session**, donc par RLS : même un oubli au
 *      point 1 ne compterait que ce que le compte a le droit de lire.
 *
 * Les comptages sont des `count` en tête de requête (`head: true`) : aucune
 * ligne ne quitte la base.
 */

import type { AdminContext } from '@/lib/rbac/guards';
import { getServerSupabaseClient } from '@/lib/supabase/server';

export type Indicator = {
  key: string;
  label: string;
  /** `null` : lecture impossible — affiché « — », jamais zéro. */
  value: number | null;
  note: string;
  href: string;
  /** Mis en avant quand il y a quelque chose à faire. */
  attention?: boolean;
};

export type IndicatorGroup = { title: string; indicators: Indicator[] };

type Client = NonNullable<Awaited<ReturnType<typeof getServerSupabaseClient>>>;
type CountResult = { count: number | null; error: unknown };

async function count(query: PromiseLike<CountResult>): Promise<number | null> {
  try {
    const { count: value, error } = await query;
    return error ? null : (value ?? 0);
  } catch {
    return null;
  }
}

const plural = (value: number | null, one: string, many: string) =>
  value === null ? '' : `${value} ${value > 1 ? many : one}`;

export async function loadDashboardIndicators(context: AdminContext): Promise<IndicatorGroup[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];
  const db: Client = supabase;
  const head = { count: 'exact' as const, head: true };
  const now = new Date().toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const groups: IndicatorGroup[] = [];

  /* ------------------------------------------------- activité commerciale */
  const commerce: Promise<Indicator | null>[] = [];

  if (context.can('quotes.view')) {
    commerce.push(
      (async () => {
        const [toProcess, fresh] = await Promise.all([
          count(db.from('quote_requests').select('id', head).in('status', ['NOUVELLE', 'EN_ETUDE'])),
          count(db.from('quote_requests').select('id', head).eq('status', 'NOUVELLE')),
        ]);
        return {
          key: 'demandes',
          label: 'Demandes à traiter',
          value: toProcess,
          note: fresh ? `dont ${plural(fresh, 'nouvelle', 'nouvelles')}` : 'nouvelles ou en cours d’étude',
          href: '/administration/demandes/',
          attention: Boolean(fresh),
        };
      })(),
      (async () => {
        const [waiting, drafts] = await Promise.all([
          count(db.from('quotes').select('id', head).eq('status', 'ENVOYE')),
          count(db.from('quotes').select('id', head).eq('status', 'BROUILLON')),
        ]);
        return {
          key: 'devis',
          label: 'Devis en attente',
          value: waiting,
          note: drafts ? `réponse du client attendue · ${plural(drafts, 'brouillon', 'brouillons')}` : 'réponse du client attendue',
          href: '/administration/demandes/',
        };
      })(),
    );
  }

  if (context.can('quotes.view') && context.can('orders.view')) {
    commerce.push(
      (async () => {
        try {
          const [{ data: accepted, error: e1 }, { data: placed, error: e2 }] = await Promise.all([
            db.from('quotes').select('id').eq('status', 'ACCEPTE').limit(1000),
            db.from('orders').select('quote_id').not('quote_id', 'is', null).limit(5000),
          ]);
          if (e1 || e2) throw new Error('lecture');
          const taken = new Set((placed ?? []).map((row) => row.quote_id));
          const value = (accepted ?? []).filter((row) => !taken.has(row.id)).length;
          return {
            key: 'devis-acceptes',
            label: 'Devis acceptés à commander',
            value,
            note: 'acceptés, commande pas encore établie',
            href: '/administration/commandes/',
            attention: value > 0,
          };
        } catch {
          return { key: 'devis-acceptes', label: 'Devis acceptés à commander', value: null, note: '', href: '/administration/commandes/' };
        }
      })(),
    );
  }

  if (context.can('orders.view')) {
    commerce.push(
      (async () => {
        const [open, total] = await Promise.all([
          count(
            db
              .from('orders')
              .select('id', head)
              .in('status', ['NOUVELLE', 'CONFIRMEE', 'EN_TRAITEMENT', 'EN_ATTENTE_INFO', 'PRETE']),
          ),
          count(db.from('orders').select('id', head)),
        ]);
        return {
          key: 'commandes',
          label: 'Commandes en cours',
          value: open,
          note: total === null ? '' : `sur ${plural(total, 'commande', 'commandes')} au total`,
          href: '/administration/commandes/',
        };
      })(),
      (async () => {
        const unpaid = await count(
          db
            .from('orders')
            .select('id', head)
            .neq('status', 'ANNULEE')
            .gt('total_amount', 0)
            .in('settlement_status', ['NON_PAYEE', 'PARTIELLE']),
        );
        return {
          key: 'encaissements',
          label: 'Commandes à encaisser',
          value: unpaid,
          note: 'non soldées, selon les paiements vérifiés',
          href: '/administration/commandes/',
        };
      })(),
    );
  }

  if (context.can('payments.view')) {
    commerce.push(
      (async () => {
        const value = await count(db.from('payments').select('id', head).in('status', ['EN_ATTENTE', 'INITIE', 'EN_VERIFICATION']));
        return {
          key: 'paiements',
          label: 'Paiements à vérifier',
          value,
          note: 'déclarés, en attente de vérification',
          href: '/administration/paiements/',
          attention: Boolean(value),
        };
      })(),
    );
  }

  if (context.can('orders.view')) {
    commerce.push(
      (async () => {
        const value = await count(db.from('documents').select('id', head).eq('doc_type', 'FACL').eq('status', 'EMIS'));
        return {
          key: 'factures',
          label: 'Factures émises',
          value,
          note: 'factures officielles en vigueur',
          href: '/administration/commandes/factures/',
        };
      })(),
    );
  }

  const commerceIndicators = (await Promise.all(commerce)).filter((entry): entry is Indicator => entry !== null);
  if (commerceIndicators.length > 0) groups.push({ title: 'Activité commerciale', indicators: commerceIndicators });

  /* ----------------------------------------------------- relation client */
  const relation: Promise<Indicator>[] = [];

  if (context.can('appointments.view')) {
    relation.push(
      (async () => {
        const [upcoming, pending] = await Promise.all([
          count(db.from('appointments').select('id', head).eq('status', 'CONFIRME').gte('scheduled_at', now)),
          count(db.from('appointments').select('id', head).eq('status', 'EN_ATTENTE')),
        ]);
        return {
          key: 'rendez-vous',
          label: 'Rendez-vous à venir',
          value: upcoming,
          note: pending ? `${plural(pending, 'demande', 'demandes')} à confirmer` : 'confirmés',
          href: '/administration/rendez-vous/',
          attention: Boolean(pending),
        };
      })(),
    );
  }

  if (context.can('users.view')) {
    relation.push(
      (async () => {
        const [clients, recent] = await Promise.all([
          count(db.from('clients').select('user_id', head)),
          count(db.from('clients').select('user_id', head).gte('created_at', monthAgo)),
        ]);
        return {
          key: 'clients',
          label: 'Clients',
          value: clients,
          note: recent === null ? 'comptes clients' : `dont ${recent} sur les 30 derniers jours`,
          href: '/administration/clients/',
        };
      })(),
    );
  }

  const relationIndicators = await Promise.all(relation);
  if (relationIndicators.length > 0) groups.push({ title: 'Relation client', indicators: relationIndicators });

  /* ----------------------------------------------------------- affiliation */
  const affiliation: Promise<Indicator>[] = [];

  if (context.can('affiliates.view')) {
    affiliation.push(
      (async () => {
        const [active, preparing] = await Promise.all([
          count(db.from('affiliates').select('id', head).eq('status', 'ACTIF')),
          count(db.from('affiliates').select('id', head).eq('status', 'PREPARATION')),
        ]);
        return {
          key: 'affilies',
          label: 'Affiliés actifs',
          value: active,
          note: preparing ? `${plural(preparing, 'fiche', 'fiches')} en préparation` : 'programme d’affiliation',
          href: '/administration/affiliation/affilies/',
        };
      })(),
    );
  }

  if (context.can('affiliate_applications.view')) {
    affiliation.push(
      (async () => {
        const value = await count(
          db.from('affiliate_applications').select('id', head).in('status', ['NOUVELLE', 'EN_ETUDE', 'INFOS_REQUISES']),
        );
        return {
          key: 'candidatures',
          label: 'Candidatures à examiner',
          value,
          note: 'nouvelles, en étude ou en attente d’informations',
          href: '/administration/affiliation/candidatures/',
          attention: Boolean(value),
        };
      })(),
    );
  }

  if (context.can('commissions.view')) {
    affiliation.push(
      (async () => {
        const value = await count(db.from('affiliate_commissions').select('id', head).in('status', ['ACQUISE', 'A_VERSER']));
        return {
          key: 'commissions',
          label: 'Commissions à verser',
          value,
          note: 'acquises, pas encore versées',
          href: '/administration/affiliation/commissions/',
        };
      })(),
    );
  }

  if (context.can('payouts.view')) {
    affiliation.push(
      (async () => {
        const value = await count(db.from('affiliate_payouts').select('id', head).eq('status', 'BROUILLON'));
        return {
          key: 'versements',
          label: 'Versements en préparation',
          value,
          note: 'brouillons à confirmer',
          href: '/administration/affiliation/versements/',
          attention: Boolean(value),
        };
      })(),
    );
  }

  const affiliationIndicators = await Promise.all(affiliation);
  if (affiliationIndicators.length > 0) groups.push({ title: 'Affiliation', indicators: affiliationIndicators });

  return groups;
}
