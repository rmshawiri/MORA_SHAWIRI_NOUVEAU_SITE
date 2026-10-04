/**
 * Vérification de l'affiliation contre la base réelle — phase 4H.
 *
 *   npm run affiliation:verify -- --env shared
 *
 * ## Pourquoi ce script existe
 *
 * `tests/unit/affiliation-*.test.ts` éprouvent le moteur TypeScript et lisent
 * le SQL ; ils ne l'exécutent pas. Or la règle qui fait foi est en base : c'est
 * elle qui figera les commissions. Ce script vérifie donc, avec de vraies
 * sessions :
 *
 *   * que le calcul en base rend exactement les montants du moteur
 *     TypeScript, sur les cas de la convention NextComTech et sur les
 *     plafonds d'offre (N1) ;
 *   * qu'une règle ne se modifie pas, ne se chevauche pas, et ne se clôt pas
 *     dans le passé — quel que soit le rôle qui essaie ;
 *   * que la dérogation contractuelle exige sa permission et son motif ;
 *   * qu'un affilié ne lit que ce qui le concerne, et qu'un client, un
 *     anonyme ou un administrateur sans permission ne lisent rien.
 *
 * ## Données de test et numérotation
 *
 * Comptes en `@mora-shawiri.test`, catégorie `ZZ_VERIF_*`, affiliés
 * `verif-affiliation-*`. Les références AFIL des affiliés de contrôle sont
 * écrites en série `ZZ` par la clé de service : **aucun numéro réel n'est
 * alloué**. La suite AFIL est néanmoins relevée et comparée en fin
 * d'exécution — une absence ne se suppose pas, elle se constate.
 *
 * Le démontage désactive, le temps d'une transaction, les gardes qui
 * interdisent de supprimer une règle entrée en vigueur ou un événement
 * d'historique : c'est le seul moyen d'effacer des données de contrôle que la
 * base protège, à juste titre, contre toute suppression applicative.
 */

import { createHash, randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { describeTarget, log, resolveAccessToken, resolveTarget, runSql } from './lib/config.mjs';
import { computeCommission, toCents } from '../src/lib/domain/affiliation.ts';

const results = { passed: 0, failed: 0 };

function check(label, condition, detail = '') {
  if (condition) {
    results.passed += 1;
    log.ok(label);
  } else {
    results.failed += 1;
    log.fail(`${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * 4J-2 : notifications d'un type sur une ressource, pour un destinataire.
 * Les commissions réelles ne naissent que de cette chaîne complète ; c'est
 * donc ici que leurs notifications sont contrôlées.
 */
async function notificationsOf(admin, type, entityId, recipientId) {
  const { data } = await admin.from('notifications').select('params, level, read_at, resolved_at')
    .eq('type_code', type).eq('entity_id', entityId).eq('recipient_id', recipientId);
  return data ?? [];
}

const refused = (result) =>
  Boolean(result.error) || (Array.isArray(result.data) && result.data.length === 0);
const empty = (result) => Boolean(result.error) || (result.data ?? []).length === 0;

const TEST_DOMAIN = 'mora-shawiri.test';
const PREFIX = 'verif-affiliation';
const PASSWORD = `Verif-4H-${randomUUID()}`;
const RUN = randomUUID().slice(0, 6).toUpperCase().replace(/[^A-Z]/g, 'X');
const CATEGORY_CODE = `ZZ_VERIF_${RUN}`;
const SEQUENCES = ['AFIL', 'FIAF', 'RVAF', 'COMAF', 'DMCL', 'CMCL'];
const TABLES = [
  'affiliates', 'affiliate_rules', 'affiliate_categories', 'affiliate_notes', 'affiliate_events',
  'affiliate_applications', 'affiliate_application_events', 'email_outbox',
  'affiliate_payout_accounts', 'affiliate_campaigns', 'affiliate_codes',
  'affiliate_attributions', 'affiliate_prospects', 'affiliate_code_uses', 'orders', 'quote_requests', 'leads',
  'affiliate_commissions', 'affiliate_commission_adjustments', 'notification_events', 'notifications', 'notification_failures', 'payments', 'refunds', 'services',
  'affiliate_payouts', 'affiliate_payout_items', 'documents',
  // Correctif de clôture 4H.
  'products', 'categories', 'offer_affiliation_history',
];

const sessionClient = (target) =>
  createClient(target.url, target.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function signIn(target, email) {
  const client = sessionClient(target);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`connexion impossible pour ${email} : ${error.message}`);
  return client;
}

async function createAccount(admin, { roleCode, grants = [], label }) {
  const email = `${PREFIX}-${label}-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`création de ${label} : ${error?.message}`);
  const userId = data.user.id;

  const { data: role } = await admin.from('roles').select('id').eq('code', roleCode).maybeSingle();
  if (!role) throw new Error(`rôle ${roleCode} introuvable`);
  await admin.from('user_roles').upsert({ user_id: userId, role_id: role.id }, { onConflict: 'user_id,role_id' });

  if (grants.length > 0) {
    const { data: permissions } = await admin.from('permissions').select('id, code').in('code', grants);
    if ((permissions ?? []).length !== grants.length) throw new Error(`permissions manquantes pour ${label}`);
    const written = await admin.from('user_permissions').upsert(
      permissions.map((row) => ({ user_id: userId, permission_id: row.id, effect: 'OCTROI' })),
      { onConflict: 'user_id,permission_id' },
    );
    if (written.error) throw new Error(written.error.message);
  }
  return { userId, email };
}

/* ========================================================================== */
/* 4H-1 — catalogue, nomenclature, catégories                                 */
/* ========================================================================== */

async function checkCatalogue(admin) {
  log.step('Permissions, nomenclature et catégories');

  const expected = {
    'affiliate_applications.view': false,
    'affiliate_applications.manage': false,
    'affiliate_rules.manage': true,
    'affiliate_rules.derogate': true,
    'affiliate_codes.manage': true,
    'affiliate_attributions.manage': true,
    'affiliate_documents.issue': true,
    'payouts.view': false,
  };
  const { data: perms } = await admin
    .from('permissions')
    .select('code, is_critical')
    .in('code', Object.keys(expected));
  check('les 8 permissions de 4H existent', (perms ?? []).length === 8, String((perms ?? []).length));
  for (const row of perms ?? []) {
    check(`${row.code} : criticité attendue`, row.is_critical === expected[row.code]);
  }

  const { data: types } = await admin
    .from('document_types')
    .select('code, is_reference_only, issue_permission, view_permission')
    .in('code', ['AFIL', 'FIAF', 'RVAF', 'COMAF']);
  const byCode = Object.fromEntries((types ?? []).map((row) => [row.code, row]));
  check('AFIL numérote sans émettre de pièce', byCode.AFIL?.is_reference_only === true);
  check('COMAF numérote sans émettre de pièce', byCode.COMAF?.is_reference_only === true);
  check('FIAF est une pièce, émise sous affiliate_documents.issue',
    byCode.FIAF?.is_reference_only === false && byCode.FIAF?.issue_permission === 'affiliate_documents.issue');
  check('RVAF est une pièce, émise sous payouts.manage, lue sous payouts.view',
    byCode.RVAF?.is_reference_only === false && byCode.RVAF?.issue_permission === 'payouts.manage'
      && byCode.RVAF?.view_permission === 'payouts.view');

  const forged = await admin.rpc('issue_document', { p_type: 'COMAF' });
  check('issue_document refuse de fabriquer une pièce COMAF', Boolean(forged.error));

  const { data: categories } = await admin
    .from('affiliate_categories')
    .select('code, is_internal, attribution_window_days, prospect_protection_months, payout_frequency, acquisition_trigger, payout_min_amount')
    .in('code', ['STANDARD', 'INFLUENCEUR', 'COMMUNAUTE', 'APPORTEUR', 'RECRUTE', 'EQUIPE', 'PARTENAIRE']);
  check('les sept catégories initiales existent', (categories ?? []).length === 7);
  check('Équipe et Recruté sont internes, les autres non',
    (categories ?? []).every((c) => c.is_internal === ['EQUIPE', 'RECRUTE'].includes(c.code)));
  check('défauts décidés : 90 j, 6 mois, fin de mois, paiement intégral, aucun seuil',
    (categories ?? []).every((c) => c.attribution_window_days === 90 && c.prospect_protection_months === 6
      && c.payout_frequency === 'FIN_DE_MOIS' && c.acquisition_trigger === 'PAIEMENT_INTEGRAL'
      && c.payout_min_amount === null));

  const { data: seededRules } = await admin
    .from('affiliate_rules')
    .select('id, category_id, affiliate_categories!inner(code)')
    .in('affiliate_categories.code', ['STANDARD', 'INFLUENCEUR', 'COMMUNAUTE', 'APPORTEUR', 'RECRUTE', 'EQUIPE', 'PARTENAIRE']);
  check('aucun taux n’a été semé dans les catégories', (seededRules ?? []).length === 0);
}

/* ========================================================================== */
/* 4H-1 — le calcul en base est celui du moteur                               */
/* ========================================================================== */

const CONVENTION = {
  kind: 'TIERED',
  tiers: [
    { from: 0, to: 200000, rate: 20, minCommission: 10000 },
    { from: 200000, to: null, rate: 40 },
  ],
};

async function sqlCompute(admin, rule, base, capRate = null) {
  const { data, error } = await admin.rpc('affiliate_compute', {
    p_kind: rule.kind,
    p_rate: rule.rate ?? null,
    p_fixed: rule.fixedAmount ?? null,
    p_tiers: rule.tiers ?? null,
    p_min: rule.minCommission ?? null,
    p_max: rule.maxCommission ?? null,
    p_min_base: rule.minBase ?? null,
    p_base: base,
    p_cap_rate: capRate,
  });
  if (error) throw new Error(`affiliate_compute : ${error.message}`);
  return data[0];
}

async function checkParity(admin) {
  log.step('Calcul en base = moteur TypeScript');

  const tsRule = (extra) => ({
    id: 'x', version: 1, owner: { type: 'AFFILIATE', id: 'x' }, target: { type: 'ALL' },
    validFrom: '2026-01-01T00:00:00Z', ...extra,
  });

  const cases = [
    // [règle, assiette, plafond, attendu en KMF]
    [CONVENTION, 30000, null, 10000],
    [CONVENTION, 20000, null, 10000],
    [CONVENTION, 50000, null, 10000],
    [CONVENTION, 100000, null, 20000],
    [CONVENTION, 199999.99, null, 40000],
    [CONVENTION, 200000, null, 80000],
    [CONVENTION, 500000, null, 200000],
    [CONVENTION, 900000, null, 360000],
    [CONVENTION, 900000, 15, 135000],
    [CONVENTION, 30000, 15, 4500],
    [{ kind: 'PERCENT', rate: 15 }, 750, null, 112.5],
    [{ kind: 'PERCENT', rate: 7.77 }, 1234567.89, null, 95925.93],
    [{ kind: 'PERCENT', rate: 10, minCommission: 2000, maxCommission: 50000 }, 5000, null, 2000],
    [{ kind: 'PERCENT', rate: 10, minCommission: 2000, maxCommission: 50000 }, 1000000, null, 50000],
    [{ kind: 'PERCENT', rate: 10, minBase: 50000 }, 49999, null, 0],
    [{ kind: 'FIXED', fixedAmount: 5000 }, 1000000, null, 5000],
    [{ kind: 'EXCLUDED' }, 100000, null, 0],
    [{
      kind: 'TIERED',
      tiers: [
        { from: 0, to: 100000, fixedAmount: 3000 },
        { from: 100000, to: 1000000, rate: 10, maxCommission: 60000 },
        { from: 1000000, to: null, rate: 8 },
      ],
    }, 900000, null, 60000],
  ];

  for (const [rule, base, cap, expectedKmf] of cases) {
    const sql = await sqlCompute(admin, rule, base, cap);
    const ts = computeCommission(tsRule(rule), base, { capRate: cap });
    const sqlCents = toCents(String(sql.amount));
    const label = `${rule.kind} ${base}${cap ? ` plafond ${cap} %` : ''}`;
    check(`${label} → ${expectedKmf} KMF en base et en TypeScript`,
      sqlCents === ts.amountCents && sqlCents === toCents(expectedKmf),
      `base ${sql.amount}, TS ${ts.amountCents}`);
    check(`${label} : mêmes indicateurs (éligible, plancher, plafond)`,
      sql.eligible === ts.eligible && sql.min_applied === ts.minApplied
        && sql.max_applied === ts.maxApplied && sql.cap_applied === ts.capApplied);
  }

  const bad = await admin.rpc('affiliate_compute', {
    p_kind: 'PERCENT', p_rate: 10, p_fixed: null, p_tiers: null, p_min: null, p_max: null,
    p_min_base: null, p_base: -1, p_cap_rate: null,
  });
  check('une assiette négative est refusée par la base', Boolean(bad.error));
}

/* ========================================================================== */
/* 4H-1 — règles : publication, immuabilité, dérogation, isolement            */
/* ========================================================================== */

async function checkRules(admin, sessions, state) {
  log.step('Règles : publication, versions, dérogation');

  const publish = (client, overrides) =>
    client.rpc('publish_affiliate_rule', {
      p_owner_type: 'AFFILIATE',
      p_owner_id: state.affA.id,
      p_target_type: 'ALL',
      p_target_id: null,
      p_kind: 'PERCENT',
      p_rate: 20,
      p_fixed_amount: null,
      p_tiers: null,
      p_min_commission: null,
      p_max_commission: null,
      p_min_base: null,
      p_effective_at: null,
      p_label: `${PREFIX} règle`,
      p_reason: 'Contrôle automatisé 4H',
      p_derogation: false,
      p_derogation_reason: null,
      ...overrides,
    });

  check('un ADMIN sans permission ne publie aucune règle', Boolean((await publish(sessions.nu)).error));
  check('un affilié ne publie pas sa propre règle', Boolean((await publish(sessions.affA)).error));
  check('un client ne publie aucune règle', Boolean((await publish(sessions.client)).error));
  check('le motif est obligatoire', Boolean((await publish(sessions.regles, { p_reason: '  ' })).error));
  check('une date d’effet passée est refusée',
    Boolean((await publish(sessions.regles, { p_effective_at: '2026-01-01T00:00:00Z' })).error));
  check('un taux à trois décimales est refusé, pas arrondi',
    Boolean((await publish(sessions.regles, { p_rate: 10.555 })).error));
  check('une grille de paliers trouée est refusée',
    Boolean((await publish(sessions.regles, {
      p_kind: 'TIERED', p_rate: null,
      p_tiers: [{ from: 0, to: 100, rate: 10 }, { from: 150, to: null, rate: 20 }],
    })).error));

  const v1 = await publish(sessions.regles, {});
  check('affiliate_rules.manage publie une règle individuelle', !v1.error, v1.error?.message);
  state.ruleV1 = v1.data;

  // Catégorie de contrôle : règle générale, qui doit rester celle de B.
  const cat = await sessions.regles.rpc('publish_affiliate_rule', {
    p_owner_type: 'CATEGORY', p_owner_id: state.category.id, p_target_type: 'ALL', p_target_id: null,
    p_kind: 'PERCENT', p_rate: 10, p_fixed_amount: null, p_tiers: null, p_min_commission: null,
    p_max_commission: null, p_min_base: null, p_effective_at: null, p_label: null,
    p_reason: 'Contrôle automatisé 4H', p_derogation: false, p_derogation_reason: null,
  });
  check('une règle de catégorie se publie', !cat.error, cat.error?.message);

  // Immuabilité : même la clé de service ne modifie pas un taux.
  const tamper = await admin.from('affiliate_rules').update({ rate: 99 }).eq('id', state.ruleV1.id).select();
  check('un taux publié ne se modifie pas, même avec la clé de service', refused(tamper));
  const del = await admin.from('affiliate_rules').delete().eq('id', state.ruleV1.id).select();
  check('une règle entrée en vigueur ne se supprime pas', refused(del));
  const past = await admin.from('affiliate_rules')
    .update({ valid_to: '2026-01-02T00:00:00Z' }).eq('id', state.ruleV1.id).select();
  check('une règle ne se clôt pas dans le passé', refused(past));

  // Chevauchement : une seconde version ouverte en même temps est impossible.
  const overlap = await admin.from('affiliate_rules').insert({
    owner_type: 'AFFILIATE', affiliate_id: state.affA.id, target_type: 'ALL',
    kind: 'PERCENT', rate: 30, valid_from: new Date().toISOString(),
  }).select();
  check('deux versions en vigueur au même instant sont refusées par la base', refused(overlap));

  // Nouvelle version : la précédente se clôt à la date d'effet.
  const v2 = await publish(sessions.regles, { p_rate: 25 });
  check('une nouvelle version se publie', !v2.error, v2.error?.message);
  const { data: closed } = await admin.from('affiliate_rules').select('valid_to, version').eq('id', state.ruleV1.id).single();
  check('la version 1 est close à la date d’effet de la version 2',
    closed?.valid_to !== null && Date.parse(closed.valid_to) === Date.parse(v2.data?.valid_from),
    JSON.stringify(closed));
  check('la version 2 porte le numéro 2 et désigne la 1', v2.data?.version === 2 && v2.data?.supersedes_id === state.ruleV1.id);

  const { data: v1Row } = await admin.from('affiliate_rules').select('rate').eq('id', state.ruleV1.id).single();
  check('la version 1 garde son taux de 20 %', Number(v1Row?.rate) === 20);

  // Résolution : avant la v2, la v1 ; après, la v2. Pour B : la catégorie.
  const resolve = async (affiliateId, at) => {
    const { data } = await admin.rpc('affiliate_resolve_rule', {
      p_affiliate_id: affiliateId, p_service_id: null, p_product_id: null, p_at: at,
    });
    return data?.[0] ?? null;
  };
  const before = await resolve(state.affA.id, new Date(Date.parse(v2.data.valid_from) - 1).toISOString());
  const after = await resolve(state.affA.id, v2.data.valid_from);
  check('à une date antérieure, la version 1 s’applique', before?.rule_id === state.ruleV1.id && before?.origin === 'INDIVIDUELLE');
  check('à la date d’effet, la version 2 s’applique', after?.rule_id === v2.data.id);
  const forB = await resolve(state.affB.id, new Date().toISOString());
  check('la règle individuelle de A ne touche pas B (catégorie)', forB?.origin === 'CATEGORIE' && forB?.rule_id === cat.data?.id);

  // Version programmée puis retirée : la version en cours redevient ouverte.
  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  const v3 = await publish(sessions.regles, { p_rate: 30, p_effective_at: future });
  check('une version future se programme', !v3.error, v3.error?.message);
  const twice = await publish(sessions.regles, { p_rate: 31, p_effective_at: future });
  check('une seconde version future est refusée tant que la première existe', Boolean(twice.error));
  const withdraw = await sessions.regles.rpc('withdraw_affiliate_rule', { p_rule_id: v3.data?.id, p_reason: 'Contrôle' });
  check('une version programmée se retire', !withdraw.error, withdraw.error?.message);
  const { data: reopened } = await admin.from('affiliate_rules').select('valid_to').eq('id', v2.data.id).single();
  check('la version en cours redevient ouverte, sans trou', reopened?.valid_to === null, JSON.stringify(reopened));
  const withdrawLive = await sessions.regles.rpc('withdraw_affiliate_rule', { p_rule_id: v2.data.id, p_reason: 'Contrôle' });
  check('une version en vigueur ne se retire pas', Boolean(withdrawLive.error));

  // N1 — dérogation contractuelle.
  const { data: service } = await admin.from('services').select('id').limit(1).single();
  const derogation = (client, extra = {}) => publish(client, {
    p_target_type: 'SERVICE', p_target_id: service.id, p_kind: 'TIERED', p_rate: null,
    p_tiers: CONVENTION.tiers, p_derogation: true,
    p_derogation_reason: 'Convention de partenariat — contrôle', ...extra,
  });
  check('une dérogation sans affiliate_rules.derogate est refusée', Boolean((await derogation(sessions.regles)).error));
  check('une dérogation sans motif est refusée',
    Boolean((await derogation(sessions.derogateur, { p_derogation_reason: ' ' })).error));
  const granted = await derogation(sessions.derogateur);
  check('affiliate_rules.derogate accorde la dérogation', !granted.error, granted.error?.message);
  check('la dérogation garde son auteur, sa date et son motif',
    granted.data?.contractual_derogation === true && granted.data?.derogation_granted_by === state.derogateur.userId
      && Boolean(granted.data?.derogation_granted_at) && Boolean(granted.data?.derogation_reason));
  const onCategory = await sessions.derogateur.rpc('publish_affiliate_rule', {
    p_owner_type: 'CATEGORY', p_owner_id: state.category.id, p_target_type: 'SERVICE', p_target_id: service.id,
    p_kind: 'PERCENT', p_rate: 50, p_fixed_amount: null, p_tiers: null, p_min_commission: null,
    p_max_commission: null, p_min_base: null, p_effective_at: null, p_label: null,
    p_reason: 'Contrôle', p_derogation: true, p_derogation_reason: 'interdit',
  });
  check('une dérogation ne se pose jamais sur une catégorie', Boolean(onCategory.error));
  const endDerog = await sessions.regles.rpc('end_affiliate_rule', {
    p_rule_id: granted.data?.id, p_end_at: null, p_reason: 'Contrôle',
  });
  check('clore une dérogation exige aussi affiliate_rules.derogate', Boolean(endDerog.error));

  // Historique et audit.
  const { data: events } = await admin.from('affiliate_events')
    .select('event_type, reason, actor_id').eq('affiliate_id', state.affA.id);
  const types = new Set((events ?? []).map((e) => e.event_type));
  check('l’historique trace publication, clôture, retrait et dérogation',
    ['REGLE_PUBLIEE', 'REGLE_CLOSE', 'REGLE_RETIREE', 'DEROGATION_ACCORDEE', 'REGLE_ROUVERTE'].every((t) => types.has(t)),
    [...types].join(', '));
  check('chaque événement de règle porte le motif et l’auteur',
    (events ?? []).filter((e) => e.event_type.startsWith('REGLE') || e.event_type.startsWith('DEROG'))
      .every((e) => e.reason && e.actor_id));
  const { count: audits } = await admin.from('audit_logs').select('id', { count: 'exact', head: true })
    .eq('resource_id', state.affA.id).like('action', 'affiliation.%');
  check('le journal d’audit reçoit chaque acte', (audits ?? 0) >= 5, String(audits));
}

async function checkIsolation(target, admin, sessions, state) {
  log.step('Isolement et confidentialité');

  const anon = sessionClient(target);
  for (const table of ['affiliates', 'affiliate_rules', 'affiliate_categories', 'affiliate_notes', 'affiliate_events']) {
    check(`l’anonyme ne lit rien dans ${table}`, empty(await anon.from(table).select('id').limit(1)));
    check(`un client ne lit rien dans ${table}`, empty(await sessions.client.from(table).select('id').limit(1)));
    check(`un ADMIN sans permission ne lit rien dans ${table}`, empty(await sessions.nu.from(table).select('id').limit(1)));
  }

  const ownRow = await sessions.affA.from('affiliates').select('id, slug');
  check('l’affilié A lit sa seule fiche', (ownRow.data ?? []).length === 1 && ownRow.data[0].id === state.affA.id);
  check('l’affilié A ne lit pas la fiche de B',
    empty(await sessions.affA.from('affiliates').select('id').eq('id', state.affB.id)));
  const ownRules = await sessions.affA.from('affiliate_rules').select('id, affiliate_id, category_id');
  check('l’affilié A lit ses règles et celles de sa catégorie, rien d’autre',
    (ownRules.data ?? []).length > 0
      && ownRules.data.every((r) => r.affiliate_id === state.affA.id || r.category_id === state.category.id));
  check('l’affilié B ne lit aucune règle individuelle de A',
    empty(await sessions.affB.from('affiliate_rules').select('id').eq('affiliate_id', state.affA.id)));
  check('l’affilié ne lit pas les notes internes',
    empty(await sessions.affA.from('affiliate_notes').select('id').eq('affiliate_id', state.affA.id)));
  check('l’affilié ne lit pas l’historique interne',
    empty(await sessions.affA.from('affiliate_events').select('id').eq('affiliate_id', state.affA.id)));
  const ownCategory = await sessions.affA.from('affiliate_categories').select('id');
  check('l’affilié lit sa seule catégorie',
    (ownCategory.data ?? []).length === 1 && ownCategory.data[0].id === state.category.id);

  const termsOwn = await sessions.affA.rpc('affiliate_effective_terms', { p_affiliate_id: state.affA.id });
  check('l’affilié lit ses paramètres effectifs (90 jours hérités)',
    (termsOwn.data ?? [])[0]?.attribution_window_days === 90, termsOwn.error?.message);
  const termsOther = await sessions.affA.rpc('affiliate_effective_terms', { p_affiliate_id: state.affB.id });
  check('l’affilié ne lit pas les paramètres de B', (termsOther.data ?? []).length === 0);

  // Écritures interdites à l'affilié.
  const selfEdit = await sessions.affA.from('affiliates').update({ display_name: 'Pirate' }).eq('id', state.affA.id).select();
  check('l’affilié ne modifie pas sa fiche', refused(selfEdit));
  const selfStatus = await sessions.affA.from('affiliates').update({ status: 'ACTIF' }).eq('id', state.affA.id).select();
  check('l’affilié ne modifie pas son statut', refused(selfStatus));
  const selfReferral = await sessions.affA.from('affiliates').update({ self_referral_allowed: true, self_referral_reason: 'x' }).eq('id', state.affA.id).select();
  check('l’affilié ne lève pas son interdiction d’auto-affiliation', refused(selfReferral));

  // L'administration : lecture sous affiliates.view, identité sous affiliates.update.
  check('affiliates.view lit les deux fiches',
    ((await sessions.lecteur.from('affiliates').select('id').in('id', [state.affA.id, state.affB.id])).data ?? []).length === 2);
  check('affiliates.view ne modifie rien',
    refused(await sessions.lecteur.from('affiliates').update({ city: 'Mutsamudu' }).eq('id', state.affA.id).select()));
  const edit = await sessions.editeur.from('affiliates').update({ city: 'Mutsamudu' }).eq('id', state.affA.id).select();
  check('affiliates.update modifie l’identité', !refused(edit), edit.error?.message);
  const editStatus = await sessions.editeur.from('affiliates').update({ status: 'SUSPENDU' }).eq('id', state.affA.id).select();
  check('affiliates.update ne change pas un statut directement', refused(editStatus));
  const editSlug = await sessions.editeur.from('affiliates').update({ slug: 'autre-slug' }).eq('id', state.affA.id).select();
  check('le lien principal ne se modifie pas', refused(editSlug));
  const { data: identityEvent } = await admin.from('affiliate_events').select('old_value, new_value')
    .eq('affiliate_id', state.affA.id).eq('event_type', 'IDENTITE_MODIFIEE');
  check('la modification d’identité est historisée avec avant et après',
    (identityEvent ?? []).some((e) => e.new_value?.city === 'Mutsamudu' && 'city' in (e.old_value ?? {})));

  // Catégories : sous affiliate_rules.manage.
  const catEdit = await sessions.lecteur.from('affiliate_categories').update({ label: 'X' }).eq('id', state.category.id).select();
  check('affiliates.view ne modifie pas une catégorie', refused(catEdit));
  const catOk = await sessions.regles.from('affiliate_categories').update({ payout_frequency: 'HEBDOMADAIRE' }).eq('id', state.category.id).select();
  check('affiliate_rules.manage modifie les défauts d’une catégorie', !refused(catOk), catOk.error?.message);
  const catCode = await sessions.regles.from('affiliate_categories').update({ code: 'AUTRE' }).eq('id', state.category.id).select();
  check('le code d’une catégorie est stable', refused(catCode));
}


/* ========================================================================== */
/* 4H-2 — candidatures                                                        */
/* ========================================================================== */

const application = (overrides = {}) => ({
  p_first_name: 'Contrôle',
  p_last_name: `Verif ${RUN}`,
  p_email: `${PREFIX}-candidat-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`,
  p_phone: '+269 000 00 00',
  p_country: 'Union des Comores',
  p_city: 'Moroni',
  p_profile: 'APPORTEUR',
  p_answers: { secteurs: 'Commerce', clientele: 'PME de Moroni' },
  p_motivation: 'Contrôle automatisé de la phase 4H.',
  p_idea: null,
  p_payout_method: 'MVOLA',
  p_payout_details: { numero: '000 00 00', titulaire: 'Contrôle Verif' },
  p_consent: true,
  p_consent_version: 'affiliation-candidature-1',
  p_client_hash: `verif-${randomUUID()}`,
  ...overrides,
});

async function checkApplications(target, admin, sessions, state) {
  log.step('Candidatures : dépôt public, décisions, confidentialité');

  const anon = sessionClient(target);

  const methods = await anon.rpc('affiliate_payout_methods');
  const codes = (methods.data ?? []).map((row) => row.code);
  check('l’anonyme lit les moyens de versement proposés', !methods.error && codes.includes('MVOLA'), methods.error?.message);
  check('Wakati n’est pas proposé pour les versements', !codes.includes('WAKATI'));
  check('la liste publique ne transporte aucun numéro de compte',
    (methods.data ?? []).every((row) => !('account_number' in row) && !('instructions' in row)));

  const first = await anon.rpc('submit_affiliate_application', application({ p_email: state.candidateEmail }));
  check('un visiteur anonyme dépose une candidature', !first.error && first.data?.[0]?.duplicate === false, first.error?.message);
  state.applicationId = first.data?.[0]?.application_id;
  state.applicationIds = [state.applicationId];

  const again = await anon.rpc('submit_affiliate_application', application({ p_email: state.candidateEmail.toUpperCase() }));
  check('un second dépôt de la même adresse rejoint le premier, sans doublon',
    again.data?.[0]?.duplicate === true && again.data?.[0]?.application_id === state.applicationId, again.error?.message);

  check('le consentement est obligatoire',
    Boolean((await anon.rpc('submit_affiliate_application', application({ p_consent: false }))).error));
  check('un moyen non autorisé pour les versements est refusé',
    Boolean((await anon.rpc('submit_affiliate_application', application({ p_payout_method: 'WAKATI' }))).error));
  check('des coordonnées incomplètes sont refusées',
    Boolean((await anon.rpc('submit_affiliate_application', application({ p_payout_details: { numero: '000 00 00' } }))).error));
  check('un champ de versement étranger au moyen est refusé',
    Boolean((await anon.rpc('submit_affiliate_application', application({
      p_payout_details: { numero: '000 00 00', titulaire: 'X', compte: 'intrus' },
    }))).error));
  check('un profil interne ne peut pas être demandé',
    Boolean((await anon.rpc('submit_affiliate_application', application({ p_profile: 'EQUIPE' }))).error));
  check('des réponses imbriquées sont refusées',
    Boolean((await anon.rpc('submit_affiliate_application', application({ p_answers: { secteurs: { x: 1 } } }))).error));

  const hash = `verif-limite-${randomUUID()}`;
  let limited = false;
  for (let i = 0; i < 4; i += 1) {
    const result = await anon.rpc('submit_affiliate_application', application({ p_client_hash: hash }));
    if (result.data?.[0]?.application_id) state.applicationIds.push(result.data[0].application_id);
    if (result.error?.code === '54000') limited = true;
  }
  check('la base limite les dépôts répétés depuis une même empreinte', limited);

  // Aucune lecture, aucune écriture directe pour les sessions sans droit.
  const outsiders = [
    ['l’anonyme', anon],
    ['un client', sessions.client],
    ['un affilié', sessions.affA],
    ['un ADMIN sans permission', sessions.nu],
  ];
  for (const [who, client] of outsiders) {
    check(`${who} ne lit aucune candidature`, empty(await client.from('affiliate_applications').select('id').limit(1)));
    check(`${who} ne lit aucun e-mail journalisé`, empty(await client.from('email_outbox').select('id').limit(1)));
  }
  check('l’anonyme n’écrit pas directement une candidature',
    Boolean((await anon.from('affiliate_applications').insert({ first_name: 'x' })).error));

  // Lecture administrative : sans les coordonnées de versement.
  const read = await sessions.candidatures.from('affiliate_applications').select('id, email, payout_method_code').eq('id', state.applicationId);
  check('affiliate_applications.view lit la candidature', (read.data ?? []).length === 1, read.error?.message);
  const details = await sessions.candidatures.from('affiliate_applications').select('payout_details').eq('id', state.applicationId);
  check('la colonne des coordonnées n’est lisible par aucune session', Boolean(details.error));
  const viaFunction = await sessions.candidatures.rpc('application_payout_details', { p_application_id: state.applicationId });
  check('sans payouts.view, les coordonnées restent fermées', Boolean(viaFunction.error));
  const withPayouts = await sessions.tresorier.rpc('application_payout_details', { p_application_id: state.applicationId });
  check('payouts.view lit les coordonnées souhaitées', withPayouts.data?.numero === '000 00 00', withPayouts.error?.message);

  // Décisions.
  const review = (client, status, extra = {}) =>
    client.rpc('review_affiliate_application', {
      p_application_id: state.applicationId, p_status: status, p_message: null, p_reason: null, ...extra,
    });
  check('affiliate_applications.view seul ne décide rien', Boolean((await review(sessions.candidatures, 'EN_ETUDE')).error));
  const study = await review(sessions.decideur, 'EN_ETUDE');
  check('affiliate_applications.manage passe la candidature à l’étude', !study.error && study.data?.status === 'EN_ETUDE', study.error?.message);
  check('une demande d’informations exige un message', Boolean((await review(sessions.decideur, 'INFOS_REQUISES')).error));
  const info = await review(sessions.decideur, 'INFOS_REQUISES', { p_message: 'Pouvez-vous préciser vos secteurs ?' });
  check('la demande d’informations est enregistrée', !info.error && info.data?.info_request?.startsWith('Pouvez-vous'), info.error?.message);
  check('un refus exige un motif interne', Boolean((await review(sessions.decideur, 'REFUSEE')).error));

  const tamper = await admin.from('affiliate_applications').update({ email: 'autre@exemple.org' }).eq('id', state.applicationId).select();
  check('le contenu transmis par le candidat ne se réécrit pas, même avec la clé de service', refused(tamper));
  const jump = await admin.from('affiliate_applications').update({ status: 'NOUVELLE' }).eq('id', state.applicationId).select();
  check('le graphe des statuts tient pour tous les rôles', refused(jump));

  // Acceptation : exige aussi affiliates.create.
  const accept = (client) =>
    client.rpc('accept_affiliate_application', {
      p_application_id: state.applicationId, p_category_id: state.category.id, p_message: null,
    });
  check('accepter sans affiliates.create est refusé', Boolean((await accept(sessions.decideur)).error));
  const accepted = await accept(sessions.accepteur);
  check('l’acceptation crée une fiche affilié en préparation',
    !accepted.error && accepted.data?.status === 'PREPARATION' && accepted.data?.reference === null, accepted.error?.message);
  state.acceptedAffiliateId = accepted.data?.id;
  check('le lien principal est propre et sans donnée sensible',
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(accepted.data?.slug ?? '') && !String(accepted.data?.slug).includes('@'),
    accepted.data?.slug);
  const replay = await accept(sessions.accepteur);
  check('rejouer l’acceptation rend la même fiche, sans en créer une seconde', replay.data?.id === state.acceptedAffiliateId);
  const refuseAfter = await review(sessions.decideur, 'REFUSEE', { p_reason: 'test' });
  check('une candidature acceptée ne peut plus être refusée', Boolean(refuseAfter.error));

  const { data: events } = await admin.from('affiliate_application_events')
    .select('event_type, actor_id').eq('application_id', state.applicationId);
  const kinds = new Set((events ?? []).map((e) => e.event_type));
  check('l’historique trace réception, étude, demande et acceptation',
    ['CANDIDATURE_RECUE', 'STATUT_EN_ETUDE', 'STATUT_INFOS_REQUISES', 'STATUT_ACCEPTEE'].every((k) => kinds.has(k)),
    [...kinds].join(', '));
  const { count: audits } = await admin.from('audit_logs').select('id', { count: 'exact', head: true })
    .eq('resource_id', state.applicationId).like('action', 'affiliation.candidature.%');
  check('le journal d’audit reçoit les décisions', (audits ?? 0) >= 3, String(audits));

  const note = await sessions.decideur.rpc('note_affiliate_application', { p_application_id: state.applicationId, p_body: 'Note de contrôle' });
  check('une note interne s’ajoute à l’historique', !note.error, note.error?.message);
  const eventsTamper = await admin.from('affiliate_application_events').delete().eq('application_id', state.applicationId).select();
  check('l’historique d’une candidature ne se supprime pas', refused(eventsTamper));

  // Journal des e-mails : écrit par le serveur seul, lu sous permission.
  const { data: mail, error: mailError } = await admin.from('email_outbox').insert({
    template: 'affiliation.candidature.controle', recipient: state.candidateEmail, subject: 'Contrôle',
    html_body: '<p>x</p>', text_body: 'x', entity_type: 'affiliate_application', entity_id: state.applicationId,
  }).select().single();
  check('le serveur journalise un e-mail', !mailError, mailError?.message);
  check('affiliate_applications.view lit les e-mails de la candidature',
    ((await sessions.candidatures.from('email_outbox').select('id').eq('id', mail?.id)).data ?? []).length === 1);
  check('une session n’écrit pas dans le journal des e-mails',
    Boolean((await sessions.decideur.from('email_outbox').insert({
      template: 'x.y.z', recipient: 'controle@mora-shawiri.test', subject: 's', html_body: 'h', text_body: 't',
    })).error));
  const secretError = await admin.from('email_outbox')
    .update({ status: 'ECHEC', last_error: 'Invalid password=abc' }).eq('id', mail?.id).select();
  check('le journal refuse une erreur qui transporterait un secret', refused(secretError));
}


/* ========================================================================== */
/* 4H-3 — activation, coordonnées, codes, campagnes, auto-décision            */
/* ========================================================================== */

async function checkAffiliates(target, accessToken, admin, sessions, state) {
  log.step('Affiliés : activation, coordonnées, codes, campagnes');

  const affId = state.acceptedAffiliateId;
  check('une fiche acceptée existe pour la suite', Boolean(affId));
  if (!affId) return;

  // Le moyen souhaité à la candidature devient une demande à l'acceptation.
  const { data: seeded } = await admin.from('affiliate_payout_accounts').select('id, status, source').eq('affiliate_id', affId);
  check('l’acceptation a déposé le moyen souhaité en demande',
    (seeded ?? []).length === 1 && seeded[0].status === 'DEMANDE' && seeded[0].source === 'CANDIDATURE', JSON.stringify(seeded));

  const blockers = await sessions.accepteur.rpc('affiliate_activation_blockers', { p_affiliate_id: affId });
  check('tant qu’aucune coordonnée n’est validée, l’activation est bloquée',
    (blockers.data ?? []).some((b) => b.includes('versement')), JSON.stringify(blockers.data));

  // Le compte du candidat : créé par la voie administrative, à son adresse.
  const created = await admin.auth.admin.createUser({ email: state.candidateEmail, password: PASSWORD, email_confirm: true });
  state.candidateUserId = created.data.user?.id;

  const tooEarly = await sessions.accepteur.rpc('activate_affiliate', { p_affiliate_id: affId, p_user_id: state.candidateUserId });
  check('activer sans configuration complète est refusé', Boolean(tooEarly.error));

  // Coordonnées : validation sous payouts.manage seulement.
  const reviewAs = (client, approve, note = null) =>
    client.rpc('review_payout_account', { p_account_id: seeded[0].id, p_approve: approve, p_note: note });
  check('payouts.view seul ne valide pas des coordonnées', Boolean((await reviewAs(sessions.tresorier, true)).error));
  check('un refus sans motif est refusé', Boolean((await reviewAs(sessions.payeur, false)).error));
  const approved = await reviewAs(sessions.payeur, true);
  check('payouts.manage valide les coordonnées', !approved.error && approved.data?.status === 'ACTIF', approved.error?.message);
  const again = await reviewAs(sessions.payeur, true);
  check('une demande déjà traitée ne se retraite pas', Boolean(again.error));
  const tamperDetails = await admin.from('affiliate_payout_accounts').update({ details: { numero: '999' } }).eq('id', seeded[0].id).select();
  check('des coordonnées validées ne se réécrivent pas', refused(tamperDetails));

  const ready = await sessions.accepteur.rpc('affiliate_activation_blockers', { p_affiliate_id: affId });
  check('configuration complète : plus aucun blocage', (ready.data ?? []).length === 0, JSON.stringify(ready.data));

  // Un compte qui ne porte pas l'adresse de l'affilié ne peut pas être rattaché.
  const wrong = await sessions.accepteur.rpc('activate_affiliate', { p_affiliate_id: affId, p_user_id: state.client.userId });
  check('le compte d’un tiers ne peut pas être rattaché', Boolean(wrong.error));
  const self = await sessions.accepteur.rpc('activate_affiliate', { p_affiliate_id: affId, p_user_id: state.accepteur.userId });
  check('un administrateur ne s’active pas lui-même', Boolean(self.error));
  check('affiliate_applications.manage seul n’active pas',
    Boolean((await sessions.decideur.rpc('activate_affiliate', { p_affiliate_id: affId, p_user_id: state.candidateUserId })).error));

  // Deux activations simultanées : un seul numéro AFIL.
  const before = await runSql(target, accessToken, `select allocated_count from public.document_sequences where doc_type = 'AFIL';`).catch(() => []);
  const [a, b] = await Promise.all([
    sessions.accepteur.rpc('activate_affiliate', { p_affiliate_id: affId, p_user_id: state.candidateUserId }),
    sessions.accepteur.rpc('activate_affiliate', { p_affiliate_id: affId, p_user_id: state.candidateUserId }),
  ]);
  const after = await runSql(target, accessToken, `select allocated_count from public.document_sequences where doc_type = 'AFIL';`).catch(() => []);
  const consumed = (after?.[0]?.allocated_count ?? 0) - (before?.[0]?.allocated_count ?? 0);
  check('deux activations simultanées réussissent sans erreur', !a.error && !b.error, a.error?.message ?? b.error?.message);
  check('deux activations simultanées ne consomment qu’un seul numéro AFIL', consumed === 1, `${consumed}`);
  check('les deux réponses portent la même référence', a.data?.reference === b.data?.reference && /^MORA-AFIL-[A-Z]+\d{4}$/.test(a.data?.reference ?? ''),
    `${a.data?.reference} / ${b.data?.reference}`);
  const { data: roles } = await admin.from('user_roles').select('roles!inner(code)').eq('user_id', state.candidateUserId);
  check('le compte reçoit le rôle AFFILIE, et lui seul', (roles ?? []).length === 1 && roles[0].roles.code === 'AFFILIE', JSON.stringify(roles));

  // L'affilié activé : sa session, ses droits.
  sessions.candidat = await signIn(target, state.candidateEmail);
  const own = await sessions.candidat.from('affiliates').select('id, status, reference').eq('id', affId);
  check('l’affilié activé lit sa fiche', own.data?.[0]?.status === 'ACTIF');
  const ownDetails = await sessions.candidat.rpc('payout_account_details', { p_account_id: seeded[0].id });
  check('l’affilié lit ses propres coordonnées', ownDetails.data?.numero === '000 00 00', ownDetails.error?.message);
  check('un autre affilié ne les lit pas', Boolean((await sessions.affA.rpc('payout_account_details', { p_account_id: seeded[0].id })).error));
  check('un ADMIN sans payouts.view ne les lit pas', Boolean((await sessions.accepteur.rpc('payout_account_details', { p_account_id: seeded[0].id })).error));

  const request = await sessions.candidat.rpc('request_payout_account', { p_method: 'HOLO', p_details: { numero: '321 00 00', titulaire: 'Contrôle' } });
  check('l’affilié demande de nouvelles coordonnées', !request.error && request.data?.status === 'DEMANDE', request.error?.message);
  const { data: stillActive } = await admin.from('affiliate_payout_accounts').select('status').eq('id', seeded[0].id).single();
  check('ses coordonnées actives restent valables pendant la demande', stillActive.status === 'ACTIF');
  check('l’affilié ne valide pas sa propre demande',
    Boolean((await sessions.candidat.rpc('review_payout_account', { p_account_id: request.data?.id, p_approve: true })).error));
  const swap = await sessions.payeur.rpc('review_payout_account', { p_account_id: request.data?.id, p_approve: true, p_note: null });
  check('valider la nouvelle demande remplace l’ancienne coordonnée', !swap.error, swap.error?.message);
  const { data: history } = await admin.from('affiliate_payout_accounts').select('status').eq('affiliate_id', affId);
  const statuses = (history ?? []).map((row) => row.status).sort();
  check('l’ancienne coordonnée reste en base, marquée remplacée', JSON.stringify(statuses) === JSON.stringify(['ACTIF', 'REMPLACE']), statuses.join(','));

  // Campagnes : l'affilié pour lui-même.
  const campaign = await sessions.candidat.rpc('create_affiliate_campaign', { p_affiliate_id: affId, p_code: 'whatsapp', p_label: 'WhatsApp' });
  check('l’affilié crée sa campagne', !campaign.error, campaign.error?.message);
  check('un affilié ne crée pas de campagne pour un autre',
    Boolean((await sessions.affA.rpc('create_affiliate_campaign', { p_affiliate_id: affId, p_code: 'pirate', p_label: 'Pirate' })).error));
  check('un code de campagne contenant une adresse est refusé',
    Boolean((await sessions.candidat.rpc('create_affiliate_campaign', { p_affiliate_id: affId, p_code: 'moi@exemple.km', p_label: 'X' })).error));
  check('une campagne ne se supprime pas',
    refused(await admin.from('affiliate_campaigns').delete().eq('id', campaign.data?.id).select()));

  // Codes de réduction : sous affiliate_codes.manage.
  const codeName = `VERIF${RUN}`;
  const insertCode = (client, code = codeName) =>
    client.from('affiliate_codes').insert({ affiliate_id: affId, code, discount_kind: 'PERCENT', discount_value: 10 }).select();
  check('l’affilié ne crée pas de code', refused(await insertCode(sessions.candidat)));
  check('un ADMIN sans affiliate_codes.manage ne crée pas de code', refused(await insertCode(sessions.accepteur)));
  const code = await insertCode(sessions.codeur);
  check('affiliate_codes.manage crée un code', !code.error && code.data?.length === 1, code.error?.message);
  state.codeId = code.data?.[0]?.id;
  check('un code est unique, casse comprise', refused(await insertCode(sessions.codeur, codeName.toLowerCase())));
  check('une réduction de plus de 100 % est refusée',
    refused(await sessions.codeur.from('affiliate_codes').insert({ affiliate_id: affId, code: `${codeName}X`, discount_kind: 'PERCENT', discount_value: 150 }).select()));
  check('un code ne se renomme pas', refused(await sessions.codeur.from('affiliate_codes').update({ code: 'AUTRE' }).eq('id', state.codeId).select()));
  check('un code ne se supprime pas', refused(await admin.from('affiliate_codes').delete().eq('id', state.codeId).select()));
  check('l’affilié lit son code', ((await sessions.candidat.from('affiliate_codes').select('id').eq('id', state.codeId)).data ?? []).length === 1);
  check('un autre affilié ne le lit pas', empty(await sessions.affA.from('affiliate_codes').select('id').eq('id', state.codeId)));
  check('l’affilié ne modifie pas la valeur de son code',
    refused(await sessions.candidat.from('affiliate_codes').update({ discount_value: 50 }).eq('id', state.codeId).select()));

  // Pas d'auto-décision : l'affilié A reçoit des droits d'administration.
  const { data: perms } = await admin.from('permissions').select('id, code').in('code', ['affiliate_rules.manage', 'affiliates.disable', 'affiliate_codes.manage', 'payouts.manage']);
  await admin.from('user_permissions').upsert(perms.map((p) => ({ user_id: state.userA.userId, permission_id: p.id, effect: 'OCTROI' })), { onConflict: 'user_id,permission_id' });
  const selfSession = await signIn(target, state.userA.email);
  check('un administrateur ne fixe pas les règles de sa propre affiliation',
    Boolean((await selfSession.rpc('publish_affiliate_rule', {
      p_owner_type: 'AFFILIATE', p_owner_id: state.affA.id, p_target_type: 'ALL', p_target_id: null, p_kind: 'PERCENT', p_rate: 50,
      p_fixed_amount: null, p_tiers: null, p_min_commission: null, p_max_commission: null, p_min_base: null, p_effective_at: null,
      p_label: null, p_reason: 'auto', p_derogation: false, p_derogation_reason: null,
    })).error));
  check('ni ne change le statut de sa propre affiliation',
    Boolean((await selfSession.rpc('change_affiliate_status', { p_affiliate_id: state.affA.id, p_status: 'SUSPENDU', p_reason: 'auto' })).error));
  check('ni ne crée de code pour lui-même',
    refused(await selfSession.from('affiliate_codes').insert({ affiliate_id: state.affA.id, code: `SELF${RUN}`, discount_kind: 'PERCENT', discount_value: 5 }).select()));
  check('ni ne saisit ses propres coordonnées de versement',
    Boolean((await selfSession.rpc('propose_payout_account', { p_affiliate_id: state.affA.id, p_method: 'MVOLA', p_details: { numero: '111 11 11', titulaire: 'X' } })).error));

  // Statuts : sous affiliates.disable, selon le graphe.
  const status = (client, next, extra = {}) =>
    client.rpc('change_affiliate_status', { p_affiliate_id: affId, p_status: next, p_reason: 'Contrôle', ...extra });
  check('affiliates.create seul ne suspend pas', Boolean((await status(sessions.accepteur, 'SUSPENDU')).error));
  check('un motif est exigé', Boolean((await status(sessions.gardien, 'SUSPENDU', { p_reason: ' ' })).error));
  const suspended = await status(sessions.gardien, 'SUSPENDU');
  check('affiliates.disable suspend', suspended.data?.status === 'SUSPENDU', suspended.error?.message);
  const back = await status(sessions.gardien, 'ACTIF');
  check('puis réactive', back.data?.status === 'ACTIF', back.error?.message);
  const ended = await status(sessions.gardien, 'TERMINE');
  check('puis clôt, avec une date de fin', ended.data?.status === 'TERMINE' && Boolean(ended.data?.ended_on), ended.error?.message);
  check('une affiliation close ne revient pas', Boolean((await status(sessions.gardien, 'ACTIF')).error));
  check('la référence d’un affilié est définitive',
    refused(await admin.from('affiliates').update({ reference: 'MORA-AFIL-ZZ9999' }).eq('id', affId).select()));
  const { data: trace } = await admin.from('affiliate_events').select('event_type').eq('affiliate_id', affId);
  const kinds = new Set((trace ?? []).map((row) => row.event_type));
  check('l’historique trace activation, statuts, coordonnées, campagne et code',
    ['STATUT_ACTIF', 'STATUT_SUSPENDU', 'STATUT_TERMINE', 'COORDONNEES_VALIDEES', 'COORDONNEES_DEMANDEES', 'CAMPAGNE_CREEE', 'CODE_CREE'].every((k) => kinds.has(k)),
    [...kinds].join(', '));
}


/* ========================================================================== */
/* 4H-4 — clics, attribution, prospects, codes appliqués                      */
/* ========================================================================== */

async function checkAttribution(target, admin, sessions, state) {
  log.step('Attribution : clics, demandes, commandes, prospects, codes');
  const serial = (n) => `ZZ${String(n).padStart(4, '0')}`;
  const hash = (seed) => createHash('sha256').update(`${RUN}-${seed}`).digest('hex');

  // Clics : enregistrés par le serveur seul.
  const click = (slug, campaign = null, seed = 'v1') =>
    admin.rpc('record_affiliate_click', { p_slug: slug, p_campaign: campaign, p_landing: '/services/', p_visitor_hash: hash(seed) });
  const first = await click(state.affA.slug);
  check('un clic sur le lien d’un affilié actif rend un jeton', Boolean(first.data?.[0]?.token), first.error?.message);
  check('la durée du cookie est la fenêtre de l’affilié (90 jours)', first.data?.[0]?.window_days === 90);
  const again = await click(state.affA.slug);
  check('le même visiteur dans la demi-heure n’est compté qu’une fois', again.data?.[0]?.token === first.data?.[0]?.token);
  const other = await click(state.affA.slug, null, 'v2');
  check('un autre visiteur compte un autre clic', other.data?.[0]?.token && other.data[0].token !== first.data?.[0]?.token);
  check('un lien inconnu ne pose rien', ((await click('verif-inconnu')).data ?? []).length === 0);
  check('une campagne inconnue ne pose rien', ((await click(state.affA.slug, 'inconnue')).data ?? []).length === 0);
  check('l’anonyme n’enregistre pas de clic lui-même',
    Boolean((await sessionClient(target).rpc('record_affiliate_click', { p_slug: state.affA.slug, p_campaign: null, p_landing: '/', p_visitor_hash: hash('x') })).error));
  const { data: rawClick } = await admin.from('affiliate_clicks').select('visitor_hash, landing_path').eq('token', first.data?.[0]?.token).single();
  check('le clic garde une empreinte, jamais une adresse IP', /^[0-9a-f]{64}$/.test(rawClick.visitor_hash) && rawClick.landing_path === '/services/');
  check('une session ne lit pas l’empreinte d’un visiteur', Boolean((await sessions.lecteur.from('affiliate_clicks').select('visitor_hash').limit(1)).error));

  // Demandes de contrôle, sans numéro réel (série ZZ).
  const lead = async (label) => {
    const { data, error } = await admin.from('leads').insert({ email: `${PREFIX}-${label}-${RUN.toLowerCase()}@${TEST_DOMAIN}`, full_name: `Contrôle ${label}` }).select().single();
    if (error) throw new Error(`prospect ${label} : ${error.message}`);
    return data;
  };
  const request = async (leadRow, n) => {
    const { data, error } = await admin.from('quote_requests').insert({
      reference: `MORA-DMCL-${serial(n)}`, lead_id: leadRow.id, subject: 'Contrôle 4H', message: 'Contrôle automatisé',
    }).select().single();
    if (error) throw new Error(`demande : ${error.message}`);
    state.requestIds.push(data.id);
    return data;
  };
  state.requestIds = [];
  state.orderIds = [];
  state.leadEmails = [];
  const leadClient = await lead('client');
  const req1 = await request(leadClient, 9101);
  const attached = await admin.rpc('attach_click_to_request', { p_reference: req1.reference, p_click_token: first.data[0].token });
  check('une demande se rattache au dernier clic valide', Boolean(attached.data), attached.error?.message);
  const dup = await admin.rpc('attach_click_to_request', { p_reference: req1.reference, p_click_token: other.data[0].token });
  check('une demande ne reçoit qu’une attribution courante', !dup.data);

  const leadSelf = await admin.from('leads').insert({ email: state.userA.email, full_name: 'Moi-même' }).select().single();
  state.selfLeadId = leadSelf.data?.id;
  const reqSelf = await request(leadSelf.data, 9102);
  check('auto-affiliation : la demande de l’affilié lui-même n’est pas rattachée',
    !(await admin.rpc('attach_click_to_request', { p_reference: reqSelf.reference, p_click_token: other.data[0].token })).data);

  const old = await click(state.affA.slug, null, 'ancien');
  await admin.from('affiliate_clicks').update({ created_at: new Date(Date.now() - 91 * 86400000).toISOString() }).eq('token', old.data[0].token);
  const req3 = await request(await lead('tardif'), 9103);
  check('un clic au-delà de la fenêtre n’attribue rien',
    !(await admin.rpc('attach_click_to_request', { p_reference: req3.reference, p_click_token: old.data[0].token })).data);

  // La commande hérite de l'attribution de sa demande.
  const order = async (n, leadRow, requestRow = null) => {
    const { data, error } = await admin.from('orders').insert({
      reference: `MORA-CMCL-${serial(n)}`, user_id: state.client.userId, customer_name: 'Contrôle 4H',
      customer_email: leadRow.email, lead_id: leadRow.id, quote_request_id: requestRow?.id ?? null,
    }).select().single();
    if (error) throw new Error(`commande : ${error.message}`);
    state.orderIds.push(data.id);
    await admin.from('order_items').insert({ order_id: data.id, designation: 'Site vitrine — contrôle', unit_price: 300000, quantity: 1 });
    return data;
  };
  const order1 = await order(9201, leadClient, req1);
  const { data: inherited } = await admin.from('affiliate_attributions').select('*').eq('order_id', order1.id);
  check('la commande hérite de l’attribution de sa demande',
    (inherited ?? []).length === 1 && inherited[0].affiliate_id === state.affA.id && inherited[0].source === 'LIEN');

  // Prospects : déclarés par l'affilié, reconnus par MORA Shawiri.
  const declare = (client, extra = {}) =>
    client.rpc('declare_affiliate_prospect', {
      p_full_name: 'Prospect Contrôle', p_company: null, p_phone: '+269 777 00 01',
      p_email: `${PREFIX}-prospect-${RUN.toLowerCase()}@${TEST_DOMAIN}`, p_need: 'Une boutique en ligne',
      p_comment: null, p_consent: true, ...extra,
    });
  check('sans l’accord du prospect, la déclaration est refusée', Boolean((await declare(sessions.affA, { p_consent: false })).error));
  const declared = await declare(sessions.affA);
  check('l’affilié actif déclare un prospect', declared.data?.status === 'DECLARE', declared.error?.message);
  state.prospectId = declared.data?.id;
  check('il ne déclare pas deux fois le même prospect', Boolean((await declare(sessions.affA)).error));
  check('il ne se déclare pas lui-même',
    Boolean((await declare(sessions.affA, { p_email: state.userA.email, p_phone: '+269 777 99 99' })).error));
  check('l’affilié lit sa déclaration, sans l’indice réservé à l’administration',
    Boolean((await sessions.affA.from('affiliate_prospects').select('review_hint').eq('id', state.prospectId)).error));
  check('un autre affilié ne la lit pas', empty(await sessions.affB.from('affiliate_prospects').select('id').eq('id', state.prospectId)));
  check('l’affilié ne reconnaît pas son propre prospect',
    Boolean((await sessions.affA.rpc('review_affiliate_prospect', { p_prospect_id: state.prospectId, p_status: 'RECONNU' })).error));
  check('les indices de rapprochement sont fermés à l’affilié',
    Boolean((await sessions.affB.rpc('affiliate_prospect_hints', { p_affiliate_id: null })).error));
  check('un refus sans motif est refusé',
    Boolean((await sessions.attributeur.rpc('review_affiliate_prospect', { p_prospect_id: state.prospectId, p_status: 'REFUSE' })).error));
  const recognized = await sessions.attributeur.rpc('review_affiliate_prospect', { p_prospect_id: state.prospectId, p_status: 'RECONNU' });
  check('MORA Shawiri reconnaît le prospect, rattaché à une fiche et protégé',
    recognized.data?.status === 'RECONNU' && Boolean(recognized.data?.lead_id) && Boolean(recognized.data?.protected_until), recognized.error?.message);
  const months = (Date.parse(recognized.data?.protected_until) - Date.now()) / (30.4 * 86400000);
  check('la protection par défaut dure 6 mois', months > 5.8 && months < 6.2, months.toFixed(2));
  const { data: prospectLead } = await admin.from('leads').select('*').eq('id', recognized.data.lead_id).single();
  const order2 = await order(9202, prospectLead);
  const { data: viaProspect } = await admin.from('affiliate_attributions').select('*').eq('order_id', order2.id);
  check('une commande du prospect protégé est attribuée à son affilié',
    (viaProspect ?? []).length === 1 && viaProspect[0].source === 'PROSPECT' && viaProspect[0].affiliate_id === state.affA.id);
  const { data: converted } = await admin.from('affiliate_prospects').select('status').eq('id', state.prospectId).single();
  check('le prospect passe à « converti »', converted.status === 'CONVERTI');

  // Verrou : une attribution validée ne se déplace pas.
  const leadManual = await lead('manuel');
  const order3 = await order(9203, leadManual);
  check('une attribution manuelle sans justification est refusée',
    Boolean((await sessions.attributeur.rpc('attribute_affair', { p_target_type: 'ORDER', p_target_id: order3.id, p_affiliate_id: state.affA.id, p_reason: ' ' })).error));
  check('affiliates.view seul n’attribue rien',
    Boolean((await sessions.lecteur.rpc('attribute_affair', { p_target_type: 'ORDER', p_target_id: order3.id, p_affiliate_id: state.affA.id, p_reason: 'x' })).error));
  const manual = await sessions.attributeur.rpc('attribute_affair', {
    p_target_type: 'ORDER', p_target_id: order3.id, p_affiliate_id: state.affA.id, p_reason: 'Transmis par WhatsApp — contrôle',
  });
  check('l’attribution manuelle est aussitôt validée', manual.data?.status === 'VALIDEE', manual.error?.message);

  const { data: codeB } = await admin.from('affiliate_codes')
    .insert({ affiliate_id: state.affB.id, code: `VB${RUN}`, discount_kind: 'PERCENT', discount_value: 10 }).select().single();
  const { data: codeA } = await admin.from('affiliate_codes')
    .insert({ affiliate_id: state.affA.id, code: `VA${RUN}`, discount_kind: 'PERCENT', discount_value: 10, max_discount_amount: 20000 }).select().single();
  check('un code d’un autre affilié ne déplace pas une attribution validée',
    Boolean((await sessions.attributeur.rpc('apply_affiliate_code', { p_order_id: order3.id, p_code: codeB.code })).error));

  // Un code l'emporte sur un lien non validé, et sa remise est exacte.
  const applied = await sessions.attributeur.rpc('apply_affiliate_code', { p_order_id: order1.id, p_code: codeB.code.toLowerCase() });
  check('un code valide s’applique (casse indifférente)', Boolean(applied.data), applied.error?.message);
  const { data: afterCode } = await admin.from('orders').select('discount_amount, total_amount').eq('id', order1.id).single();
  check('la remise de 10 % figure sur la commande (30 000 KMF)', Number(afterCode.discount_amount) === 30000 && Number(afterCode.total_amount) === 270000, JSON.stringify(afterCode));
  const { data: nowAttr } = await admin.from('affiliate_attributions').select('affiliate_id, source, status').eq('order_id', order1.id).in('status', ['ACTIVE', 'VALIDEE']);
  check('le code remplace l’attribution par lien (décision B)', nowAttr?.[0]?.source === 'CODE' && nowAttr[0].affiliate_id === state.affB.id);
  check('un seul code par commande (décision I)',
    Boolean((await sessions.attributeur.rpc('apply_affiliate_code', { p_order_id: order1.id, p_code: codeA.code })).error));
  const removed = await sessions.attributeur.rpc('remove_affiliate_code', { p_order_id: order1.id, p_reason: 'Contrôle' });
  check('le code se retire', !removed.error, removed.error?.message);
  const { data: restored } = await admin.from('orders').select('discount_amount, total_amount').eq('id', order1.id).single();
  check('la remise est annulée à l’identique', Number(restored.discount_amount) === 0 && Number(restored.total_amount) === 300000, JSON.stringify(restored));
  const capped = await sessions.attributeur.rpc('apply_affiliate_code', { p_order_id: order1.id, p_code: codeA.code });
  const { data: cappedOrder } = await admin.from('orders').select('discount_amount').eq('id', order1.id).single();
  check('le plafond de réduction d’un code est respecté (20 000 KMF)', !capped.error && Number(cappedOrder.discount_amount) === 20000, capped.error?.message);
  check('l’affilié n’applique pas son propre code',
    Boolean((await sessions.affA.rpc('apply_affiliate_code', { p_order_id: order2.id, p_code: codeA.code })).error));
  check('une utilisation de code ne se supprime pas', refused(await admin.from('affiliate_code_uses').delete().eq('order_id', order1.id).select()));
  check('une attribution ne se supprime pas', refused(await admin.from('affiliate_attributions').delete().eq('order_id', order3.id).select()));

  // Ce que voit l'affilié : ses conversions, sans aucune donnée du client.
  const mine = await sessions.affA.rpc('my_affiliate_conversions');
  const refs = (mine.data ?? []).map((row) => row.order_reference);
  check('l’affilié voit ses commandes attribuées', refs.includes(order1.reference) && refs.includes(order2.reference) && refs.includes(order3.reference), refs.join(','));
  check('sans nom, adresse ni téléphone du client',
    (mine.data ?? []).every((row) => !Object.keys(row).some((key) => /customer|email|phone|name/.test(key))));
  check('un autre affilié ne les voit pas', !((await sessions.affB.rpc('my_affiliate_conversions')).data ?? []).some((row) => refs.includes(row.order_reference)));
  check('l’affilié ne lit pas les attributions brutes', empty(await sessions.affA.from('affiliate_attributions').select('id').limit(1)));
  const statsA = await sessions.affA.rpc('affiliate_stats', { p_affiliate_id: state.affA.id });
  check('l’affilié lit ses chiffres réels', (statsA.data?.[0]?.clicks ?? 0) >= 3 && statsA.data?.[0]?.conversions >= 2, JSON.stringify(statsA.data));
  check('mais pas ceux d’un autre affilié', Boolean((await sessions.affA.rpc('affiliate_stats', { p_affiliate_id: state.affB.id })).error));
}

/* ========================================================================== */

async function checkCommissions(target, accessToken, admin, sessions, state) {
  log.step('Commissions : calcul, plafond, acquisition, remboursement, ajustements');
  const serial = (n) => `ZZ${String(n).padStart(4, '0')}`;
  const { data: anyService } = await admin.from('services').select('category_id').limit(1).single();
  const service = async (slug, extra) => {
    const { data, error } = await admin.from('services').insert({
      slug: `${PREFIX}-${slug}-${RUN.toLowerCase()}`, category_id: anyService.category_id, title: 'Contrôle 4H', tag: 'Contrôle',
      short_description: 'Offre de contrôle.', description: 'Offre de contrôle, supprimée à la fin.', price_label: 'Sur devis',
      image_path: '/images/offre-logo.webp', cta_label: 'Demander', request_subject: 'Contrôle', ...extra,
    }).select().single();
    if (error) throw new Error(`offre ${slug} : ${error.message}`);
    return data;
  };
  const eligible = await service('eligible', { affiliate_eligible: true, affiliate_max_rate: 8 });
  const closed = await service('ferme', { affiliate_eligible: false });
  state.serviceIds = [eligible.id, closed.id];

  const leadRow = (await admin.from('leads').insert({ email: `${PREFIX}-commission-${RUN.toLowerCase()}@${TEST_DOMAIN}`, full_name: 'Contrôle commission' }).select().single()).data;
  const order = async (n) => {
    const { data, error } = await admin.from('orders').insert({
      reference: `MORA-CMCL-${serial(n)}`, user_id: state.client.userId, customer_name: 'Contrôle 4H',
      customer_email: leadRow.email, lead_id: leadRow.id,
    }).select().single();
    if (error) throw new Error(`commande : ${error.message}`);
    state.orderIds.push(data.id);
    return data;
  };
  const items = async (orderId) => {
    const { error } = await admin.from('order_items').insert([
      { order_id: orderId, service_id: eligible.id, designation: 'Offre éligible', unit_price: 300000, quantity: 1, position: 1 },
      { order_id: orderId, service_id: closed.id, designation: 'Offre non éligible', unit_price: 100000, quantity: 1, position: 2 },
      { order_id: orderId, designation: 'Ligne libre', unit_price: 50000, quantity: 1, position: 3 },
    ]);
    if (error) throw new Error(`lignes : ${error.message}`);
  };
  const attribute = (orderId) => sessions.attributeur.rpc('attribute_affair', {
    p_target_type: 'ORDER', p_target_id: orderId, p_affiliate_id: state.affB.id, p_reason: 'Contrôle commission',
  });
  const commissionOf = async (orderId) =>
    (await admin.from('affiliate_commissions').select('*').eq('order_id', orderId).order('created_at', { ascending: false }).limit(1)).data?.[0];
  const pay = async (orderId, amount, n) => {
    const now = new Date().toISOString();
    const { error } = await admin.from('payments').insert({
      order_id: orderId, method_code: 'ESPECES', amount, status: 'PAYE', transaction_reference: `ZZ-${RUN}-${n}`,
      declared_at: now, verified_at: now, confirmed_at: now,
    });
    if (error) throw new Error(`paiement : ${error.message}`);
  };

  // 1. L'attribution précède les lignes : la commission naît avec elles.
  const o1 = await order(9301);
  const att = await attribute(o1.id);
  check('l’affaire est attribuée à l’affilié B', !att.error, att.error?.message);
  check('sans ligne, aucune commission', !(await commissionOf(o1.id)));
  await items(o1.id);
  const c1 = await commissionOf(o1.id);
  if (!c1) throw new Error('aucune commission créée');
  state.commissionCreated = true;
  check('la commission naît avec les lignes, prévisionnelle', c1.status === 'PREVISIONNELLE', c1.status);
  check('elle porte une référence MORA-COMAF', /^MORA-COMAF-[A-Z]+\d{4}$/.test(c1.reference), c1.reference);
  check('N1 : le plafond de l’offre (8 %) s’impose au taux de catégorie (10 %) — 24 000 KMF', Number(c1.amount) === 24000, c1.amount);
  const lines = c1.lines ?? [];
  check('la ligne éligible porte l’instantané de sa règle et le plafond appliqué',
    lines[0]?.capApplied === true && lines[0]?.rule?.schema === 'affiliation-regle-1' && Number(lines[0]?.rule?.rate) === 10, JSON.stringify(lines[0]));
  check('l’offre non éligible ne rapporte rien', lines[1]?.reason === 'OFFRE_NON_ELIGIBLE' && Number(lines[1]?.amount) === 0);
  check('une ligne sans offre du catalogue ne rapporte rien', lines[2]?.reason === 'OFFRE_ABSENTE' && Number(lines[2]?.amount) === 0);
  check('l’assiette ne compte que les lignes éligibles (300 000 KMF)', Number(c1.base_amount) === 300000, c1.base_amount);
  check('elle ne contient aucune donnée du client', !/customer|phone|Contrôle commission|@/.test(JSON.stringify(c1)));
  const recorded = await notificationsOf(admin, 'affilie.commission.enregistree', c1.id, state.userB.userId);
  check('4J : commission enregistrée — une notification pour l’affilié, référence seule, aucun montant',
    recorded.length === 1 && JSON.stringify(recorded[0].params) === JSON.stringify({ reference: c1.reference }), JSON.stringify(recorded));

  // Lecture : l'affilié la sienne, personne d'autre sans permission.
  check('l’affilié B lit sa commission', ((await sessions.affB.from('affiliate_commissions').select('id').eq('id', c1.id)).data ?? []).length === 1);
  check('l’affilié A ne la lit pas', empty(await sessions.affA.from('affiliate_commissions').select('id').eq('id', c1.id)));
  check('affiliates.view seul ne lit pas les commissions', empty(await sessions.lecteur.from('affiliate_commissions').select('id').eq('id', c1.id)));
  check('commissions.view les lit', ((await sessions.commissaire.from('affiliate_commissions').select('id').eq('id', c1.id)).data ?? []).length === 1);
  check('une session n’écrit pas une commission', refused(await sessions.commissaire.from('affiliate_commissions').update({ amount: 1 }).eq('id', c1.id).select()));
  check('une commission ne se supprime pas, même par la clé de service', refused(await admin.from('affiliate_commissions').delete().eq('id', c1.id).select()));
  check('le graphe des statuts tient, même pour la clé de service',
    refused(await admin.from('affiliate_commissions').update({ status: 'VERSEE' }).eq('id', c1.id).select()));

  // 2. Acquisition au paiement intégral (défaut L).
  await pay(o1.id, 200000, 1);
  check('un paiement partiel laisse la commission prévisionnelle', (await commissionOf(o1.id))?.status === 'PREVISIONNELLE');
  await pay(o1.id, 250000, 2);
  const acquired = await commissionOf(o1.id);
  check('le paiement intégral l’acquiert', acquired?.status === 'ACQUISE' && Boolean(acquired.acquired_at), acquired?.status);
  check('le montant acquis est celui calculé', Number(acquired?.amount) === 24000);
  const { data: notes } = await admin.from('notification_events').select('event_type, recipient_id').eq('entity_id', c1.id);
  check('un événement de notification est préparé pour l’affilié (4J)',
    (notes ?? []).some((n) => n.event_type === 'affiliation.commission.acquise' && n.recipient_id === state.userB.userId), JSON.stringify(notes));
  const { data: consumed } = await admin.from('notification_events').select('status').eq('entity_id', c1.id).eq('event_type', 'affiliation.commission.acquise');
  check('4J : l’événement de file est consommé (TRAITE)', (consumed ?? []).length === 1 && consumed[0].status === 'TRAITE', JSON.stringify(consumed));
  check('4J : commission acquise — une notification pour l’affilié',
    (await notificationsOf(admin, 'affilie.commission.acquise', c1.id, state.userB.userId)).length === 1);
  check('une commission acquise est figée, même pour la clé de service',
    refused(await admin.from('affiliate_commissions').update({ amount: 1 }).eq('id', c1.id).select()));

  // 3. Remboursement avant versement (G) : ajustement sur le montant conservé.
  const { error: refundError } = await admin.from('refunds').insert({
    order_id: o1.id, amount: 90000, status: 'EFFECTUE', reason: 'Contrôle 4H', method_code: 'ESPECES', completed_at: new Date().toISOString(),
  });
  check('le remboursement est enregistré', !refundError, refundError?.message);
  const { data: adj } = await admin.from('affiliate_commission_adjustments').select('*').eq('commission_id', c1.id);
  check('G : un ajustement de −4 800 KMF ramène la commission au montant conservé (19 200 KMF)',
    (adj ?? []).length === 1 && Number(adj[0].amount) === -4800 && adj[0].kind === 'REMBOURSEMENT', JSON.stringify(adj));
  check('la commission initiale n’est pas réécrite', Number((await commissionOf(o1.id))?.amount) === 24000);
  const adjusted = await notificationsOf(admin, 'affilie.commission.ajustee', c1.id, state.userB.userId);
  check('4J : commission ajustée — une notification (Attention), sans le montant de l’ajustement',
    adjusted.length === 1 && adjusted[0].level === 'ATTENTION' && !('ajustement' in (adjusted[0].params ?? {})), JSON.stringify(adjusted));
  const totals = await sessions.affB.rpc('affiliate_commission_totals', { p_affiliate_id: state.affB.id });
  check('les totaux de l’affilié déduisent l’ajustement', Number(totals.data?.[0]?.acquired) === 19200, JSON.stringify(totals.data ?? totals.error?.message));
  check('un affilié ne lit pas les totaux d’un autre', Boolean((await sessions.affA.rpc('affiliate_commission_totals', { p_affiliate_id: state.affB.id })).error));
  check('un ajustement ne se supprime pas', refused(await admin.from('affiliate_commission_adjustments').delete().eq('commission_id', c1.id).select()));

  // 4. Ajustements manuels : motivés, sous permission, jamais par l'affilié.
  const adjust = (client, amount, reason = 'Correction de contrôle') =>
    client.rpc('adjust_commission', { p_affiliate_id: state.affB.id, p_commission_id: c1.id, p_amount: amount, p_reason: reason });
  check('sans commissions.manage, aucun ajustement', Boolean((await adjust(sessions.lecteur, 1000)).error));
  check('l’affilié ne s’ajuste pas lui-même', Boolean((await adjust(sessions.affB, 1000)).error));
  check('un ajustement sans motif est refusé', Boolean((await adjust(sessions.commissaire, 1000, ' ')).error));
  check('un ajustement ne rend pas la commission négative', Boolean((await adjust(sessions.commissaire, -50000)).error));
  const manual = await adjust(sessions.commissaire, 800);
  check('un ajustement motivé s’enregistre avec son auteur', manual.data?.created_by === state.commissaire.userId, manual.error?.message);

  // 5. Validation manuelle (L) et dérogation contractuelle (N1).
  await admin.from('affiliates').update({ acquisition_trigger: 'VALIDATION_MANUELLE' }).eq('id', state.affB.id);
  const derog = await sessions.derogateur.rpc('publish_affiliate_rule', {
    p_owner_type: 'AFFILIATE', p_owner_id: state.affB.id, p_target_type: 'SERVICE', p_target_id: eligible.id,
    p_kind: 'PERCENT', p_rate: 12, p_fixed_amount: null, p_tiers: null, p_min_commission: null, p_max_commission: null,
    p_min_base: null, p_effective_at: null, p_label: null, p_reason: 'Contrôle 4H', p_derogation: true,
    p_derogation_reason: 'Convention de contrôle',
  });
  check('une dérogation individuelle se publie', !derog.error, derog.error?.message);
  const o2 = await order(9302);
  await items(o2.id);
  await attribute(o2.id);
  const c2 = await commissionOf(o2.id);
  check('N1 : la dérogation contractuelle lève le plafond — 12 % de 300 000 = 36 000 KMF', Number(c2?.amount) === 36000, c2?.amount);
  check('la condition d’acquisition de l’affilié est figée dans la commission', c2?.acquisition_trigger === 'VALIDATION_MANUELLE');
  await pay(o2.id, 450000, 3);
  check('sous validation manuelle, le paiement n’acquiert rien', (await commissionOf(o2.id))?.status === 'PREVISIONNELLE');
  const validate = (client, reason = 'Contrôle validé') => client.rpc('validate_commission', { p_commission_id: c2.id, p_reason: reason });
  check('l’affilié ne valide pas sa propre commission', Boolean((await validate(sessions.affB)).error));
  check('sans commissions.validate, rien ne se valide', Boolean((await validate(sessions.lecteur)).error));
  check('une validation sans motif est refusée', Boolean((await validate(sessions.commissaire, ' ')).error));
  const validated = await validate(sessions.commissaire);
  check('commissions.validate acquiert la commission',
    validated.data?.status === 'ACQUISE' && validated.data?.acquired_by === state.commissaire.userId, validated.error?.message);
  check('4J : validation manuelle — une seule notification « validée », aucune « acquise » pour la même transition',
    (await notificationsOf(admin, 'affilie.commission.validee', c2.id, state.userB.userId)).length === 1
      && (await notificationsOf(admin, 'affilie.commission.acquise', c2.id, state.userB.userId)).length === 0);
  await admin.from('affiliates').update({ acquisition_trigger: null }).eq('id', state.affB.id);

  // 6. Aucune rétroactivité : une nouvelle version de règle n'atteint pas une affaire antérieure.
  // Depuis le correctif de clôture, l'éligibilité aussi se lit à la date de
  // l'affaire : l'offre est rendue éligible avant la commande.
  await admin.from('services').update({ affiliate_eligible: true, affiliate_max_rate: 50 }).eq('id', closed.id);
  const o3 = await order(9303);
  await attribute(o3.id);
  await admin.from('order_items').insert({ order_id: o3.id, designation: 'Ligne libre', unit_price: 100000, quantity: 1 });
  check('une commande sans ligne commissionnable n’a pas de commission', !(await commissionOf(o3.id)));
  await admin.from('order_items').insert({ order_id: o3.id, service_id: closed.id, designation: 'Offre éligible', unit_price: 100000, quantity: 1 });
  const newer = await sessions.regles.rpc('publish_affiliate_rule', {
    p_owner_type: 'CATEGORY', p_owner_id: state.category.id, p_target_type: 'ALL', p_target_id: null,
    p_kind: 'PERCENT', p_rate: 20, p_fixed_amount: null, p_tiers: null, p_min_commission: null,
    p_max_commission: null, p_min_base: null, p_effective_at: null, p_label: null,
    p_reason: 'Contrôle 4H — nouvelle version', p_derogation: false, p_derogation_reason: null,
  });
  check('une nouvelle version de la règle de catégorie se publie', !newer.error, newer.error?.message);
  await admin.from('order_items').insert({ order_id: o3.id, service_id: closed.id, designation: 'Seconde ligne', unit_price: 100000, quantity: 1 });
  const c3 = await commissionOf(o3.id);
  check('la règle appliquée est celle en vigueur à la date de l’affaire (10 %, pas 20 %)',
    Number(c3?.amount) === 20000 && (c3?.lines ?? []).every((l) => Number(l.rule?.rate) === 10), JSON.stringify(c3?.lines?.map((l) => l.rule?.rate)));
  check('le montant acquis de la première commission n’a pas bougé', Number((await commissionOf(o1.id))?.amount) === 24000);

  // 7. Annulation de la commande, annulation motivée.
  const { error: cancelError } = await admin.from('orders').update({ status: 'ANNULEE', cancel_reason: 'Contrôle 4H' }).eq('id', o3.id);
  check('la commande s’annule', !cancelError, cancelError?.message);
  const c3b = c3 ? (await admin.from('affiliate_commissions').select('status, cancel_reason').eq('id', c3.id).single()).data : null;
  check('sa commission prévisionnelle est annulée, avec le motif', c3b?.status === 'ANNULEE' && c3b.cancel_reason === 'Contrôle 4H', JSON.stringify(c3b));
  check('une commission annulée ne revit pas', refused(await admin.from('affiliate_commissions').update({ status: 'ACQUISE' }).eq('id', c3?.id).select()));
  check('l’affilié n’annule pas sa commission', Boolean((await sessions.affB.rpc('cancel_commission', { p_commission_id: c2.id, p_reason: 'x' })).error));
  check('une annulation sans motif est refusée', Boolean((await sessions.commissaire.rpc('cancel_commission', { p_commission_id: c2.id, p_reason: ' ' })).error));
  const cancelled = await sessions.commissaire.rpc('cancel_commission', { p_commission_id: c2.id, p_reason: 'Erreur de saisie — contrôle' });
  check('commissions.manage annule une commission acquise, non versée',
    !cancelled.error && (await admin.from('affiliate_commissions').select('status').eq('id', c2.id).single()).data?.status === 'ANNULEE', cancelled.error?.message);
  check('4J : commission annulée — une notification (Attention), pour chaque commission annulée',
    (await notificationsOf(admin, 'affilie.commission.annulee', c2.id, state.userB.userId)).length === 1
      && (!c3 || (await notificationsOf(admin, 'affilie.commission.annulee', c3.id, state.userB.userId)).length === 1));

  const { data: types } = await admin.from('affiliate_events').select('event_type').eq('affiliate_id', state.affB.id);
  const seen = new Set((types ?? []).map((t) => t.event_type));
  check('l’historique trace prévision, acquisition, validation, ajustement et annulation',
    ['COMMISSION_PREVISIONNELLE', 'COMMISSION_ACQUISE', 'COMMISSION_VALIDEE', 'COMMISSION_AJUSTEE', 'AJUSTEMENT', 'COMMISSION_ANNULEE'].every((t) => seen.has(t)),
    [...seen].join(', '));
}

async function checkPayouts(target, accessToken, admin, sessions, state) {
  log.step('Versements : préparation, double paiement, confirmation, RVAF, justificatif');
  const affId = state.affB.id;
  const { data: c1 } = await admin.from('affiliate_commissions').select('*').eq('affiliate_id', affId).eq('status', 'ACQUISE').single();
  if (!c1) throw new Error('aucune commission acquise pour les versements');
  const prepare = (client, extra = {}) =>
    client.rpc('prepare_affiliate_payout', { p_affiliate_id: affId, p_commission_ids: null, p_period_label: 'Octobre 2026 — contrôle', ...extra });
  const statusOf = async (id) => (await admin.from('affiliate_commissions').select('status, payout_id, paid_at').eq('id', id).single()).data;

  // Échéances (L) : fin de mois par défaut, et chaque fréquence configurable.
  const next = await runSql(target, accessToken, `
    select public.affiliate_next_payout_date('FIN_DE_MOIS', '2026-10-01') m, public.affiliate_next_payout_date('TRIMESTRIEL', '2026-10-01') t,
           public.affiliate_next_payout_date('HEBDOMADAIRE', '2026-10-01') h, public.affiliate_next_payout_date('HEBDOMADAIRE', '2026-10-02') hv,
           public.affiliate_next_payout_date('A_LA_DEMANDE', '2026-10-01') d`);
  check('échéances : fin de mois, fin de trimestre, vendredi, à la demande',
    next?.[0]?.m === '2026-10-31' && next[0].t === '2026-12-31' && next[0].h === '2026-10-02' && next[0].hv === '2026-10-02' && next[0].d === null,
    JSON.stringify(next));

  // Lecture de ce qui est à verser.
  const overview = await sessions.tresorier.rpc('affiliate_payable_overview');
  const row = (overview.data ?? []).find((r) => r.affiliate_id === affId);
  check('payouts.view lit ce qui est à verser, net des ajustements (20 000 KMF)', Number(row?.payable) === 20000 && Boolean(row.frequency),
    JSON.stringify(row ?? overview.error?.message));
  check('affiliates.view seul ne le lit pas', Boolean((await sessions.lecteur.rpc('affiliate_payable_overview')).error));

  // Préparer : permission, jamais l'affilié.
  check('payouts.view seul ne prépare rien', Boolean((await prepare(sessions.tresorier)).error));
  check('l’affilié ne prépare pas son versement', Boolean((await prepare(sessions.affB)).error));
  const draft = await prepare(sessions.payeur);
  check('payouts.manage prépare un versement : commission et ajustements regroupés (20 000 KMF)',
    draft.data?.status === 'BROUILLON' && Number(draft.data?.total_amount) === 20000, draft.error?.message ?? JSON.stringify(draft.data));
  const { data: items } = await admin.from('affiliate_payout_items').select('*').eq('payout_id', draft.data?.id);
  check('trois lignes : la commission et ses deux ajustements', (items ?? []).length === 3, String(items?.length));
  check('la commission passe « à verser » dans ce versement', (await statusOf(c1.id))?.status === 'A_VERSER');
  check('un second brouillon pour le même affilié est refusé', Boolean((await prepare(sessions.payeur)).error));
  check('une commission ne figure jamais dans deux lignes',
    refused(await admin.from('affiliate_payout_items').insert({ payout_id: draft.data.id, commission_id: c1.id, amount: 1, snapshot: {} }).select()));
  check('l’affilié ne voit pas un versement en préparation', empty(await sessions.affB.from('affiliate_payouts').select('id').eq('id', draft.data.id)));

  // Retirer, annuler, seuil (K).
  const commissionItem = (items ?? []).find((i) => i.commission_id === c1.id);
  const removed = await sessions.payeur.rpc('remove_payout_item', { p_item_id: commissionItem?.id });
  check('retirer la commission en retire aussi ses ajustements', !removed.error && Number(removed.data?.total_amount) === 0, removed.error?.message);
  check('elle redevient acquise', (await statusOf(c1.id))?.status === 'ACQUISE');
  check('annuler un brouillon exige un motif', Boolean((await sessions.payeur.rpc('cancel_affiliate_payout', { p_payout_id: draft.data.id, p_reason: ' ' })).error));
  const cancelled = await sessions.payeur.rpc('cancel_affiliate_payout', { p_payout_id: draft.data.id, p_reason: 'Contrôle — brouillon annulé' });
  check('le brouillon annulé reste dans l’historique', cancelled.data?.status === 'ANNULE', cancelled.error?.message);
  check('un versement ne se supprime jamais', refused(await admin.from('affiliate_payouts').delete().eq('id', draft.data.id).select()));
  await admin.from('affiliates').update({ payout_min_amount: 50000 }).eq('id', affId);
  const belowMin = await prepare(sessions.payeur);
  check('K : le seuil propre à l’affilié est respecté', Boolean(belowMin.error) && /seuil/.test(belowMin.error?.message ?? ''), belowMin.error?.message);
  await admin.from('affiliates').update({ payout_min_amount: null }).eq('id', affId);

  // Coordonnées validées de l'affilié, pour l'instantané masqué.
  const proposed = await sessions.payeur.rpc('propose_payout_account', { p_affiliate_id: affId, p_method: 'MVOLA', p_details: { numero: '321 12 34', titulaire: 'Contrôle B' } });
  const approved = await sessions.payeur.rpc('review_payout_account', { p_account_id: proposed.data?.id, p_approve: true, p_note: null });
  check('les coordonnées Mvola de l’affilié sont validées', approved.data?.status === 'ACTIF', approved.error?.message ?? proposed.error?.message);

  const draft2 = await prepare(sessions.payeur, { p_commission_ids: [c1.id] });
  check('un versement se prépare sur une sélection de commissions', Number(draft2.data?.total_amount) === 20000, draft2.error?.message);
  const confirm = (client, extra = {}) => client.rpc('confirm_affiliate_payout', {
    p_payout_id: draft2.data?.id, p_method_code: 'MVOLA', p_transaction_reference: `MV-${RUN}`,
    p_paid_on: new Date().toISOString().slice(0, 10), p_note: null, ...extra,
  });
  check('payouts.view seul ne confirme pas', Boolean((await confirm(sessions.tresorier)).error));
  check('l’affilié ne confirme pas son versement', Boolean((await confirm(sessions.affB)).error));
  check('un moyen exclu des versements est refusé', Boolean((await confirm(sessions.payeur, { p_method_code: 'WAKATI' })).error));
  check('la référence de transaction est exigée hors espèces', Boolean((await confirm(sessions.payeur, { p_transaction_reference: ' ' })).error));
  check('une date future est refusée', Boolean((await confirm(sessions.payeur, { p_paid_on: '2099-01-01' })).error));
  check('un moyen sans coordonnées validées exige une note',
    Boolean((await confirm(sessions.payeur, { p_method_code: 'VIREMENT', p_note: null })).error));

  const confirmed = await confirm(sessions.payeur);
  const payout = confirmed.data;
  check('le versement est confirmé avec sa référence MORA-RVAF', payout?.status === 'CONFIRME' && /^MORA-RVAF-[A-Z]+\d{4}$/.test(payout?.reference ?? ''),
    confirmed.error?.message ?? payout?.reference);
  check('le moyen réellement utilisé est figé, coordonnées masquées',
    payout?.method_snapshot?.code === 'MVOLA' && payout.method_snapshot.details?.numero === '•••• 2 34' && payout.method_snapshot.details?.titulaire === 'Contrôle B',
    JSON.stringify(payout?.method_snapshot));
  check('la référence de transaction est conservée', payout?.transaction_reference === `MV-${RUN}`);
  const after = await statusOf(c1.id);
  check('la commission est versée, datée', after?.status === 'VERSEE' && Boolean(after.paid_at));
  const { data: imputed } = await admin.from('affiliate_commission_adjustments').select('status, payout_id').eq('commission_id', c1.id);
  check('ses ajustements sont imputés sur ce versement', (imputed ?? []).every((a) => a.status === 'IMPUTE' && a.payout_id === payout?.id));
  const { data: doc } = await admin.from('documents').select('id, reference, doc_type, entity_type, entity_id, owner_id').eq('id', payout?.document_id).single();
  check('le RVAF est émis par le moteur de documents commun', doc?.doc_type === 'RVAF' && doc.reference === payout?.reference
    && doc.entity_id === payout?.id && doc.owner_id === state.userB.userId, JSON.stringify(doc));
  const { data: snap } = await admin.from('document_snapshots').select('content, content_sha256').eq('document_id', payout?.document_id).single();
  check('son instantané fige lignes, total, moyen et empreinte',
    Number(snap?.content?.total) === 20000 && snap.content.lines?.length === 3 && snap.content.payout?.method?.code === 'MVOLA'
      && /^[0-9a-f]{64}$/.test(snap.content_sha256 ?? '') && !/Contrôle commission|@/.test(JSON.stringify(snap.content.lines)),
    JSON.stringify(snap?.content?.lines?.length));
  const { data: notif } = await admin.from('notification_events').select('event_type').eq('entity_id', payout?.id);
  check('un événement de notification est préparé', (notif ?? []).some((n) => n.event_type === 'affiliation.versement.confirme'));
  const paid = await notificationsOf(admin, 'affilie.versement.confirme', payout?.id, state.userB.userId);
  check('4J : versement confirmé — une notification pour l’affilié, sans montant',
    paid.length === 1 && !('montant' in (paid[0].params ?? {})), JSON.stringify(paid));

  // Un versement confirmé est définitif.
  check('un versement confirmé ne se réécrit pas, même par la clé de service',
    refused(await admin.from('affiliate_payouts').update({ total_amount: 1 }).eq('id', payout.id).select()));
  check('ni ne se supprime', refused(await admin.from('affiliate_payouts').delete().eq('id', payout.id).select()));
  check('ses lignes ne bougent plus', refused(await admin.from('affiliate_payout_items').delete().eq('payout_id', payout.id).select()));
  check('il ne s’annule pas', Boolean((await sessions.payeur.rpc('cancel_affiliate_payout', { p_payout_id: payout.id, p_reason: 'x' })).error));
  check('il ne se confirme pas deux fois', Boolean((await confirm(sessions.payeur)).error));
  check('la commission versée ne revient pas dans un brouillon', Boolean((await prepare(sessions.payeur, { p_commission_ids: [c1.id] })).error));

  // L'affilié lit ses versements, et seulement l'essentiel.
  check('l’affilié lit son versement confirmé', ((await sessions.affB.from('affiliate_payouts').select('id, reference, total_amount').eq('id', payout.id)).data ?? []).length === 1);
  check('mais ni la note interne ni le justificatif', Boolean((await sessions.affB.from('affiliate_payouts').select('note, proof_path').eq('id', payout.id)).error));
  check('un autre affilié ne le lit pas', empty(await sessions.affA.from('affiliate_payouts').select('id').eq('id', payout.id)));
  check('l’affilié lit les lignes de son versement', ((await sessions.affB.from('affiliate_payout_items').select('id').eq('payout_id', payout.id)).data ?? []).length === 3);
  const totals = await sessions.affB.rpc('affiliate_commission_totals', { p_affiliate_id: affId });
  check('ses totaux comptent 20 000 KMF versés', Number(totals.data?.[0]?.paid) === 20000, JSON.stringify(totals.data));

  // Justificatif privé, rattaché une seule fois.
  const proof = (path) => sessions.payeur.rpc('attach_payout_proof', { p_payout_id: payout.id, p_path: path });
  check('un chemin de justificatif étranger est refusé', Boolean((await proof(`RVAF/${randomUUID()}/${randomUUID()}.pdf`)).error));
  const attached = await proof(`RVAF/${payout.id}/${randomUUID()}.pdf`);
  check('le justificatif se rattache au versement confirmé', Boolean(attached.data?.proof_path), attached.error?.message);
  check('il ne se remplace pas', Boolean((await proof(`RVAF/${payout.id}/${randomUUID()}.pdf`)).error));
  const { data: bucket } = await admin.storage.getBucket('affiliation-justificatifs');
  check('le dépôt des justificatifs est privé', bucket?.public === false);

  // H : annulation après versement — qualifiée comme telle.
  const late = await sessions.commissaire.rpc('cancel_commission', { p_commission_id: c1.id, p_reason: 'Contrôle — affaire annulée après versement' });
  const { data: lateAdj } = await admin.from('affiliate_commission_adjustments').select('kind, amount, status').eq('commission_id', c1.id).eq('status', 'A_IMPUTER');
  check('une commission versée puis annulée produit « annulation après versement » (−20 000 KMF)',
    !late.error && lateAdj?.length === 1 && lateAdj[0].kind === 'ANNULATION_APRES_VERSEMENT' && Number(lateAdj[0].amount) === -20000,
    late.error?.message ?? JSON.stringify(lateAdj));
  check('4J : annulation après versement — une notification « annulée », pas deux',
    (await notificationsOf(admin, 'affilie.commission.annulee', c1.id, state.userB.userId)).length === 1);
  const { data: unchanged } = await admin.from('affiliate_payouts').select('status, total_amount').eq('id', payout.id).single();
  check('le versement passé reste intact', unchanged?.status === 'CONFIRME' && Number(unchanged.total_amount) === 20000);
  check('la commission versée garde son statut', (await statusOf(c1.id))?.status === 'VERSEE');
  const negative = await prepare(sessions.payeur);
  check('un solde négatif ne se verse pas : il attend les commissions suivantes', Boolean(negative.error), negative.error?.message);
  const totals2 = await sessions.affB.rpc('affiliate_commission_totals', { p_affiliate_id: affId });
  check('les totaux montrent l’ajustement à imputer', Number(totals2.data?.[0]?.adjustments_pending) === -20000, JSON.stringify(totals2.data));

  const { data: events } = await admin.from('affiliate_events').select('event_type').eq('affiliate_id', affId);
  const seen = new Set((events ?? []).map((e) => e.event_type));
  check('l’historique trace préparation, annulation, confirmation, justificatif, annulation après versement',
    ['VERSEMENT_PREPARE', 'VERSEMENT_ANNULE', 'VERSEMENT_CONFIRME', 'JUSTIFICATIF_RATTACHE', 'COMMISSION_ANNULEE_APRES_VERSEMENT'].every((t) => seen.has(t)),
    [...seen].join(', '));
  const { count: audits } = await admin.from('audit_logs').select('id', { count: 'exact', head: true })
    .eq('resource_id', affId).like('action', 'affiliation.%');
  check('le journal d’audit reçoit chaque acte', (audits ?? 0) >= 5, String(audits));
}

async function checkDocuments(target, accessToken, admin, sessions, state) {
  log.step('Pièces officielles : fiche FIAF, relevé RVAF, aperçu, droits de lecture');
  const affId = state.affB.id;
  const issue = (client, id = affId) => client.rpc('issue_affiliate_sheet', { p_affiliate_id: id });

  // Aperçu : l'affilié lui-même, ou affiliates.view ; sans numéro.
  const preview = await sessions.affB.rpc('affiliate_sheet_preview', { p_affiliate_id: affId });
  check('l’affilié lit l’aperçu de sa fiche, sans numéro', preview.data?.preview === true && preview.data?.reference === null, preview.error?.message);
  check('l’aperçu porte ses conditions et ses règles', Array.isArray(preview.data?.rules) && Boolean(preview.data?.terms?.payoutFrequency));
  check('un autre affilié ne lit pas cet aperçu', Boolean((await sessions.affA.rpc('affiliate_sheet_preview', { p_affiliate_id: affId })).error));
  check('affiliates.view lit l’aperçu', !(await sessions.lecteur.rpc('affiliate_sheet_preview', { p_affiliate_id: affId })).error);
  check('l’aperçu ne montre jamais un numéro de versement entier', !JSON.stringify(preview.data ?? {}).includes('321 12 34'));

  // Émission : permission, jamais par l'affilié.
  check('affiliates.view seul n’émet pas de fiche', Boolean((await issue(sessions.lecteur)).error));
  check('l’affilié n’émet pas sa propre fiche', Boolean((await issue(sessions.affB)).error));
  const first = await issue(sessions.documentiste);
  check('affiliate_documents.issue émet la fiche, numérotée MORA-FIAF', /^MORA-FIAF-[A-Z]+\d{4}$/.test(first.data?.reference ?? ''), first.error?.message);
  const sheet = await notificationsOf(admin, 'affilie.fiche.mise_a_jour', affId, state.userB.userId);
  check('4J : fiche émise — l’affilié est notifié une fois, avec la référence FIAF',
    sheet.length === 1 && sheet[0].params?.reference === first.data?.reference, JSON.stringify(sheet));
  const { data: snap1 } = await admin.from('document_snapshots').select('content, content_sha256').eq('document_id', first.data?.id).single();
  check('son instantané fige identité, conditions, règles et codes',
    snap1?.content?.type === 'FIAF' && snap1.content.preview === false && snap1.content.reference === first.data?.reference
      && Array.isArray(snap1.content.rules) && Array.isArray(snap1.content.codes) && /^[0-9a-f]{64}$/.test(snap1.content_sha256));
  check('l’instantané ne se réécrit pas, même par la voie privilégiée',
    await runSql(target, accessToken, `update public.document_snapshots set content = content || '{"x":1}' where document_id = '${first.data?.id}';`).then(() => false, () => true));
  const second = await issue(sessions.documentiste);
  const { data: firstNow } = await admin.from('documents').select('status').eq('id', first.data?.id).single();
  check('une nouvelle émission remplace la précédente, qui reste consultable',
    second.data?.version === 2 && second.data?.replaces_id === first.data?.id && firstNow?.status === 'REMPLACE', JSON.stringify({ v: second.data?.version, s: firstNow?.status }));
  check('une fiche émise ne se supprime pas', refused(await admin.from('documents').delete().eq('id', second.data?.id).select()));

  // Lecture des pièces.
  const own = await sessions.affB.from('documents').select('reference, doc_type').in('doc_type', ['FIAF', 'RVAF']);
  const refs = (own.data ?? []).map((d) => d.reference);
  check('l’affilié lit ses fiches et ses relevés', refs.includes(first.data?.reference) && refs.includes(second.data?.reference)
    && (own.data ?? []).some((d) => d.doc_type === 'RVAF'), refs.join(','));
  check('et leur instantané', ((await sessions.affB.from('document_snapshots').select('document_id').eq('document_id', second.data?.id)).data ?? []).length === 1);
  check('un autre affilié ne les lit pas', empty(await sessions.affA.from('documents').select('id').eq('id', second.data?.id)));
  check('affiliates.view lit les fiches', ((await sessions.lecteur.from('documents').select('id').eq('id', second.data?.id)).data ?? []).length === 1);
  check('mais pas les relevés de versement', empty(await sessions.lecteur.from('documents').select('id').eq('doc_type', 'RVAF').eq('owner_id', state.userB.userId)));
  check('payouts.view lit les relevés', ((await sessions.tresorier.from('documents').select('id').eq('doc_type', 'RVAF').eq('owner_id', state.userB.userId)).data ?? []).length >= 1);

  const { data: rvaf } = await admin.from('documents').select('id').eq('doc_type', 'RVAF').eq('owner_id', state.userB.userId).limit(1).single();
  const { data: rsnap } = await admin.from('document_snapshots').select('content').eq('document_id', rvaf?.id).single();
  check('le relevé garde commissions, ajustements, total, moyen, transaction et date',
    rsnap?.content?.lines?.some((l) => l.type === 'COMMISSION') && rsnap.content.lines.some((l) => l.type === 'AJUSTEMENT')
      && Number(rsnap.content.total) > 0 && rsnap.content.payout?.method?.code && rsnap.content.payout?.transaction && rsnap.content.payout?.paidOn,
    JSON.stringify(rsnap?.content?.payout));

  const { data: events } = await admin.from('affiliate_events').select('event_type').eq('affiliate_id', affId).eq('event_type', 'FICHE_EMISE');
  check('chaque émission rejoint l’historique de l’affilié', (events ?? []).length === 2);
}

/* ========================================================================== */


/* ========================================================================== */
/* 4I-5 — profil suspendu : plus aucune lecture propriétaire d'affilié        */
/* ========================================================================== */

/**
 * Exception minimale au gel de 4H, autorisée le 2 octobre 2026 : un compte
 * dont le profil est réellement suspendu ne lit plus ses données privées
 * d'affilié, même avec la session ouverte avant la suspension. Les accès
 * d'administration ne changent pas.
 */
async function checkProfileSuspension(target, admin, sessions, state) {
  log.step('Profil suspendu, session déjà ouverte : aucune donnée privée d’affilié');
  const affId = state.affB.id;
  const s = sessions.affB; // session ouverte au début du contrôle
  const reads = async () => ({
    affiliation: ((await s.from('affiliates').select('id').eq('id', affId)).data ?? []).length,
    regles: ((await s.from('affiliate_rules').select('id')).data ?? []).length,
    campagnes: ((await s.from('affiliate_campaigns').select('id').eq('affiliate_id', affId)).data ?? []).length,
    codes: ((await s.from('affiliate_codes').select('id').eq('affiliate_id', affId)).data ?? []).length,
    prospects: ((await s.from('affiliate_prospects').select('id').eq('affiliate_id', affId)).data ?? []).length,
    coordonnees: ((await s.from('affiliate_payout_accounts').select('id').eq('affiliate_id', affId)).data ?? []).length,
    commissions: ((await s.from('affiliate_commissions').select('id').eq('affiliate_id', affId)).data ?? []).length,
    ajustements: ((await s.from('affiliate_commission_adjustments').select('id').eq('affiliate_id', affId)).data ?? []).length,
    versements: ((await s.from('affiliate_payouts').select('id').eq('affiliate_id', affId)).data ?? []).length,
    pieces: ((await s.from('documents').select('id').in('doc_type', ['FIAF', 'RVAF'])).data ?? []).length,
    conversions: ((await s.rpc('my_affiliate_conversions')).data ?? []).length,
    statistiques: (await s.rpc('affiliate_stats', { p_affiliate_id: affId })).error ? 0 : 1,
    totaux: (await s.rpc('affiliate_commission_totals', { p_affiliate_id: affId })).error ? 0 : 1,
    apercu_fiche: (await s.rpc('affiliate_sheet_preview', { p_affiliate_id: affId })).error ? 0 : 1,
  });

  const before = await reads();
  check('profil actif : l’affilié lit son affiliation, ses commissions, ses versements, ses pièces',
    before.affiliation === 1 && before.commissions >= 1 && before.versements >= 1 && before.pieces >= 1 && before.statistiques === 1 && before.totaux === 1,
    JSON.stringify(before));

  await admin.from('profiles').update({ status: 'SUSPENDU' }).eq('id', state.userB.userId);
  const after = await reads();
  check('profil suspendu, ancienne session : aucune donnée privée lue (fiche, règles, campagnes, codes, prospects, coordonnées, commissions, ajustements, versements, pièces, conversions, statistiques, aperçu)',
    Object.values(after).every((n) => n === 0), JSON.stringify(after));
  const campaign = await s.rpc('create_affiliate_campaign', { p_affiliate_id: affId, p_code: 'suspendu', p_label: 'Tentative suspendue' });
  check('profil suspendu : aucune campagne créée', Boolean(campaign.error));
  const contact = await s.rpc('update_my_affiliate_contact', { p_phone: '+269 000 00 99', p_city: 'Moroni', p_country: 'Comores' });
  check('profil suspendu : coordonnées non modifiables', Boolean(contact.error));
  check('administration intacte : affiliates.view lit toujours l’affilié',
    ((await sessions.lecteur.from('affiliates').select('id').eq('id', affId)).data ?? []).length === 1);
  check('administration intacte : payouts.view lit toujours ses versements',
    ((await sessions.tresorier.from('affiliate_payouts').select('id').eq('affiliate_id', affId)).data ?? []).length >= 1);

  await admin.from('profiles').update({ status: 'ACTIF' }).eq('id', state.userB.userId);
  const back = await reads();
  check('profil réactivé : même session, tout est de nouveau lisible', JSON.stringify(back) === JSON.stringify(before), JSON.stringify(back));
  const other = await sessions.affA.from('affiliate_commissions').select('id').eq('affiliate_id', affId);
  check('un autre affilié ne lit toujours rien de B', (other.data ?? []).length === 0);
}

/* ========================================================================== */
/* Correctif de clôture 4H — éligibilité administrable, ajout direct          */
/* ========================================================================== */

async function checkOfferEligibility(target, admin, sessions, state) {
  log.step('Clôture 4H — éligibilité des offres : permissions, sept cas métier, services et produits');
  const run = RUN.toLowerCase();
  const serial = (n) => `ZZ${String(n).padStart(4, '0')}`;

  // A5 : l'état réel du catalogue, relu à la fin.
  const realEligible = async () => {
    const [s, p] = await Promise.all([
      admin.from('services').select('id', { count: 'exact', head: true }).eq('affiliate_eligible', true).not('slug', 'like', `${PREFIX}-%`),
      admin.from('products').select('id', { count: 'exact', head: true }).eq('affiliate_eligible', true).not('slug', 'like', `${PREFIX}-%`),
    ]);
    return `${s.count}/${p.count}`;
  };
  const eligibleBefore = await realEligible();

  // Offres de contrôle. « Publiées » sans paraître nulle part : le site public
  // ne liste que les offres montrées en Boutique.
  const { data: serviceCategory } = await admin.from('categories').select('id').eq('kind', 'SERVICE').limit(1).single();
  const { data: productCategory, error: pcError } = await admin.from('categories')
    .insert({ slug: `${PREFIX}-produits-${run}`, name: 'Contrôle 4H', kind: 'PRODUIT', is_active: false }).select().single();
  if (pcError) throw new Error(`catégorie produit : ${pcError.message}`);
  state.productCategoryId = productCategory.id;
  const common = {
    title: 'Contrôle 4H', tag: 'Contrôle', short_description: 'Offre de contrôle.', description: 'Offre de contrôle, supprimée à la fin.',
    price_label: 'Sur devis', image_path: '/images/offre-logo.webp', cta_label: 'Demander', show_in_shop: false,
  };
  const offer = async (type, slug, status) => {
    const table = type === 'SERVICE' ? 'services' : 'products';
    const extra = type === 'SERVICE'
      ? { category_id: serviceCategory.id, request_subject: 'Contrôle', show_in_services: false }
      : { category_id: productCategory.id };
    const { data, error } = await admin.from(table)
      .insert({ ...common, ...extra, slug: `${PREFIX}-${slug}-${run}`, status }).select().single();
    if (error) throw new Error(`offre ${slug} : ${error.message}`);
    return { ...data, type, table };
  };
  const sPub = await offer('SERVICE', 'svc-publie', 'PUBLIE');
  const pPub = await offer('PRODUCT', 'prd-publie', 'PUBLIE');
  const sDraft = await offer('SERVICE', 'svc-brouillon', 'BROUILLON');
  const pDraft = await offer('PRODUCT', 'prd-brouillon', 'BROUILLON');
  check('les offres de contrôle naissent non éligibles', [sPub, pPub, sDraft, pDraft].every((o) => o.affiliate_eligible === false && o.affiliate_max_rate === null));
  const { data: seeded } = await admin.from('offer_affiliation_history').select('offer_id, eligible').in('offer_id', [sPub.id, pPub.id]);
  check('chaque offre créée ouvre son historique d’éligibilité', (seeded ?? []).length === 2 && seeded.every((h) => h.eligible === false), JSON.stringify(seeded));

  // Catégorie et affilié dédiés : une règle de catégorie à 10 %, rien d'autre.
  const { data: category, error: catError } = await admin.from('affiliate_categories')
    .insert({ code: `${CATEGORY_CODE}_E`, label: 'Contrôle 4H — éligibilité', description: 'Catégorie de contrôle automatisé' }).select().single();
  if (catError) throw new Error(`catégorie d’éligibilité : ${catError.message}`);
  const publishRule = (client, extra) => client.rpc('publish_affiliate_rule', {
    p_owner_type: 'CATEGORY', p_owner_id: category.id, p_target_type: 'ALL', p_target_id: null, p_kind: 'PERCENT', p_rate: 10,
    p_fixed_amount: null, p_tiers: null, p_min_commission: null, p_max_commission: null, p_min_base: null, p_effective_at: null,
    p_label: null, p_reason: 'Contrôle 4H — éligibilité', p_derogation: false, p_derogation_reason: null, ...extra,
  });
  const rule = await publishRule(sessions.regles, {});
  check('la catégorie de contrôle reçoit sa règle à 10 %', !rule.error, rule.error?.message);
  state.userE = await createAccount(admin, { roleCode: 'AFFILIE', label: 'affe' });
  const { data: affE, error: affError } = await admin.from('affiliates').insert({
    slug: `${PREFIX}-e-${run}`, reference: 'MORA-AFIL-ZZ9003', user_id: state.userE.userId, category_id: category.id, status: 'ACTIF',
    display_name: 'Contrôle E', contact_email: state.userE.email, started_on: new Date().toISOString().slice(0, 10),
  }).select().single();
  if (affError) throw new Error(`affilié E : ${affError.message}`);

  // ---------------------------------------------------------------- A3
  const setAs = (client, o, eligible, rate) =>
    client.rpc('set_offer_affiliation', { p_offer_type: o.type, p_offer_id: o.id, p_eligible: eligible, p_max_rate: rate });
  const current = async (o) => (await admin.from(o.table).select('status, affiliate_eligible, affiliate_max_rate').eq('id', o.id).single()).data;
  for (const o of [sPub, pPub]) {
    const label = o.type === 'SERVICE' ? 'service' : 'produit';
    check(`A3 (${label}) : l’édition du catalogue seule ne rend pas affiliable (fonction)`, Boolean((await setAs(sessions.catalogueSeul, o, true, 8)).error));
    const direct = await sessions.catalogueSeul.from(o.table).update({ affiliate_eligible: true, affiliate_max_rate: 8 }).eq('id', o.id).select();
    check(`A3 (${label}) : ni par une écriture directe, refusée par la base`, refused(direct), JSON.stringify(direct.data ?? direct.error?.message));
    const plain = await sessions.catalogueSeul.from(o.table).update({ tag: 'Contrôle modifié' }).eq('id', o.id).select();
    check(`A3 (${label}) : elle modifie toujours le reste de l’offre`, !plain.error && plain.data?.length === 1, plain.error?.message);
    check(`A3 (${label}) : affiliate_rules.manage seul ne modifie pas l’offre (fonction)`, Boolean((await setAs(sessions.regles, o, true, 8)).error));
    await sessions.regles.from(o.table).update({ affiliate_eligible: true, affiliate_max_rate: 8 }).eq('id', o.id);
    check(`A3 (${label}) : ni par écriture directe`, (await current(o))?.affiliate_eligible === false);
    check(`A3 (${label}) : un ADMIN sans permission ne fait rien`, Boolean((await setAs(sessions.nu, o, true, 8)).error));
    check(`A3 (${label}) : une offre éligible sans plafond est refusée`, Boolean((await setAs(sessions.eligibilite, o, true, null)).error));
    check(`A3 (${label}) : un plafond hors bornes est refusé`,
      Boolean((await setAs(sessions.eligibilite, o, true, 0)).error) && Boolean((await setAs(sessions.eligibilite, o, true, 150)).error));
    check(`A3 (${label}) : rien n’a changé après ces refus`, (await current(o))?.affiliate_eligible === false);
  }

  // Ventes de contrôle, attribuées à E.
  const leadRow = (await admin.from('leads').insert({ email: `${PREFIX}-eligibilite-${run}@${TEST_DOMAIN}`, full_name: 'Contrôle éligibilité' }).select().single()).data;
  const sale = async (n, o, amount = 200000) => {
    const { data, error } = await admin.from('orders').insert({
      reference: `MORA-CMCL-${serial(n)}`, user_id: state.client.userId, customer_name: 'Contrôle 4H', customer_email: leadRow.email, lead_id: leadRow.id,
    }).select().single();
    if (error) throw new Error(`commande ${n} : ${error.message}`);
    state.orderIds.push(data.id);
    const line = await admin.from('order_items').insert({
      order_id: data.id, [o.type === 'SERVICE' ? 'service_id' : 'product_id']: o.id, designation: `Ligne ${n}`, unit_price: amount, quantity: 1, position: 1,
    });
    if (line.error) throw new Error(`ligne ${n} : ${line.error.message}`);
    const att = await sessions.attributeur.rpc('attribute_affair', { p_target_type: 'ORDER', p_target_id: data.id, p_affiliate_id: affE.id, p_reason: 'Contrôle éligibilité' });
    if (att.error) throw new Error(`attribution ${n} : ${att.error.message}`);
    return data;
  };
  const commissionOf = async (orderId) =>
    (await admin.from('affiliate_commissions').select('*').eq('order_id', orderId).order('created_at', { ascending: false }).limit(1)).data?.[0];
  const pay = async (orderId, amount, n) => {
    const now = new Date().toISOString();
    const { error } = await admin.from('payments').insert({
      order_id: orderId, method_code: 'ESPECES', amount, status: 'PAYE', transaction_reference: `ZZ-${RUN}-E${n}`,
      declared_at: now, verified_at: now, confirmed_at: now,
    });
    if (error) throw new Error(`paiement : ${error.message}`);
  };

  let n = 9400;
  const history = {};
  for (const o of [sPub, pPub]) {
    const label = o.type === 'SERVICE' ? 'service' : 'produit';
    // 1. Publiée et non affiliable : aucune commission.
    const o1 = await sale(++n, o);
    check(`cas 1 (${label}) : publiée et non affiliable → aucune commission`, !(await commissionOf(o1.id)));

    // 2. Publiée et affiliable (plafond 8 %) : commission correcte.
    const enabled = await setAs(sessions.eligibilite, o, true, 8);
    check(`édition + affiliate_rules.manage rend le ${label} affiliable`, !enabled.error && enabled.data?.eligible === true, enabled.error?.message);
    check(`la publication n’a pas bougé (${label})`, (await current(o))?.status === 'PUBLIE');
    const o2 = await sale(++n, o);
    const c2 = await commissionOf(o2.id);
    check(`cas 2 (${label}) : publiée et affiliable → 8 % de 200 000 = 16 000 KMF (règle 10 %, plafond 8 %)`,
      Number(c2?.amount) === 16000 && c2?.lines?.[0]?.capApplied === true, JSON.stringify(c2?.lines?.[0] ?? null));
    check(`une vente antérieure à l’éligibilité reste sans commission (${label})`, !(await commissionOf(o1.id)));

    // 4. Plafond modifié : les nouveaux calculs suivent.
    const lowered = await setAs(sessions.eligibilite, o, true, 5);
    check(`le plafond du ${label} passe à 5 %`, !lowered.error && Number(lowered.data?.maxRate) === 5, lowered.error?.message);
    const o4 = await sale(++n, o);
    check(`cas 4 (${label}) : nouveau plafond → 5 % de 200 000 = 10 000 KMF`, Number((await commissionOf(o4.id))?.amount) === 10000);

    // 5. Historique : la commission prévisionnelle de o2 garde le plafond de sa vente…
    await admin.from('order_items').insert({
      order_id: o2.id, [o.type === 'SERVICE' ? 'service_id' : 'product_id']: o.id, designation: 'Seconde ligne', unit_price: 100000, quantity: 1, position: 2,
    });
    check(`cas 5 (${label}) : recalculée, la commission prévisionnelle garde le plafond de sa date (8 % de 300 000 = 24 000)`,
      Number((await commissionOf(o2.id))?.amount) === 24000, (await commissionOf(o2.id))?.amount);

    // … même quand l'offre cesse d'être affiliable.
    const disabled = await setAs(sessions.eligibilite, o, false, null);
    check(`retirer le ${label} de l’affiliation conserve le plafond mémorisé`,
      !disabled.error && disabled.data?.eligible === false && Number(disabled.data?.maxRate) === 5, disabled.error?.message);
    const o5 = await sale(++n, o);
    check(`après désactivation, une nouvelle vente du ${label} ne produit aucune commission`, !(await commissionOf(o5.id)));
    await pay(o2.id, 300000, n);
    const acquired = await commissionOf(o2.id);
    check(`cas 5 (${label}) : payée après la désactivation, la commission historique s’acquiert intacte (24 000 KMF)`,
      acquired?.status === 'ACQUISE' && Number(acquired.amount) === 24000, `${acquired?.status} ${acquired?.amount}`);
    check(`cas 5 (${label}) : la commission au plafond 5 % reste à 10 000 KMF`, Number((await commissionOf(o4.id))?.amount) === 10000);

    // 6. Non affiliable + dérogation contractuelle : toujours rien.
    const derog = await sessions.derogateur.rpc('publish_affiliate_rule', {
      p_owner_type: 'AFFILIATE', p_owner_id: affE.id, p_target_type: o.type, p_target_id: o.id, p_kind: 'PERCENT', p_rate: 30,
      p_fixed_amount: null, p_tiers: null, p_min_commission: null, p_max_commission: null, p_min_base: null, p_effective_at: null,
      p_label: null, p_reason: 'Contrôle 4H', p_derogation: true, p_derogation_reason: 'Convention de contrôle',
    });
    check(`une dérogation contractuelle se publie sur le ${label}`, !derog.error, derog.error?.message);
    const o6 = await sale(++n, o);
    check(`cas 6 (${label}) : non affiliable + dérogation → aucune commission`, !(await commissionOf(o6.id)));

    // 7. Affiliable + dérogation : le plafond est dépassé.
    await setAs(sessions.eligibilite, o, true, 5);
    const o7 = await sale(++n, o);
    const c7 = await commissionOf(o7.id);
    check(`cas 7 (${label}) : affiliable + dérogation → 30 % de 200 000 = 60 000 KMF, au-delà du plafond de 5 %`,
      Number(c7?.amount) === 60000 && c7?.lines?.[0]?.capRate === null, JSON.stringify(c7?.lines?.[0] ?? null));

    // Traçabilité : historique daté, auteur, journal du catalogue.
    const { data: rows } = await admin.from('offer_affiliation_history').select('eligible, max_rate, changed_by').eq('offer_id', o.id).order('id');
    history[o.type] = rows ?? [];
    check(`l’historique du ${label} trace chaque changement, avec son auteur`,
      JSON.stringify((rows ?? []).map((r) => [r.eligible, r.max_rate === null ? null : Number(r.max_rate)])) ===
        JSON.stringify([[false, null], [true, 8], [true, 5], [false, 5], [true, 5]]) &&
        rows.slice(1).every((r) => r.changed_by === state.eligibilite.userId),
      JSON.stringify(rows));
    check(`l’historique du ${label} ne se réécrit pas`,
      refused(await admin.from('offer_affiliation_history').update({ eligible: true }).eq('offer_id', o.id).select()) &&
        refused(await admin.from('offer_affiliation_history').delete().eq('offer_id', o.id).select()));
    const { data: audit } = await admin.from('audit_logs').select('action, actor_id').eq('resource_id', o.id);
    check(`le journal d’audit du catalogue enregistre les changements du ${label}`,
      (audit ?? []).some((a) => a.actor_id === state.eligibilite.userId), JSON.stringify(audit?.slice(0, 3)));
  }

  // 3. Non publiée et affiliable : la configuration ne dépend pas de la publication.
  for (const o of [sDraft, pDraft]) {
    const label = o.type === 'SERVICE' ? 'service' : 'produit';
    const set = await setAs(sessions.eligibilite, o, true, 15);
    check(`cas 3 (${label}) : un brouillon se rend affiliable sans être publié`,
      !set.error && (await current(o))?.status === 'BROUILLON' && (await current(o))?.affiliate_eligible === true, set.error?.message);
    await admin.from(o.table).update({ status: 'PUBLIE' }).eq('id', o.id);
    await admin.from(o.table).update({ status: 'NON_PUBLIE' }).eq('id', o.id);
    const after = await current(o);
    check(`cas 3 (${label}) : publication puis retrait laissent l’affiliation intacte (15 %)`,
      after?.status === 'NON_PUBLIE' && after.affiliate_eligible === true && Number(after.affiliate_max_rate) === 15, JSON.stringify(after));
  }

  // L'espace affilié ne liste que des offres publiées : un brouillon affiliable n'y paraît pas.
  const affSession = await signIn(target, state.userE.email);
  const visible = await affSession.from('services').select('id').eq('id', sDraft.id);
  check('un brouillon affiliable reste invisible pour l’affilié', empty(visible));

  check('A5 : aucune offre réelle n’a changé d’éligibilité', (await realEligible()) === eligibleBefore, `${eligibleBefore} → ${await realEligible()}`);
  state.eligibilityHistory = history;
}

async function checkManualAffiliates(target, accessToken, admin, sessions, state) {
  log.step('Clôture 4H — ajout direct d’un affilié : permission, doublons, activation');
  const fresh = (label) => `${PREFIX}-${label}-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`;
  const create = (client, email, extra = {}) => client.rpc('create_affiliate', {
    p_display_name: `Contrôle manuel ${RUN}`, p_party_type: 'PERSONNE', p_legal_name: null, p_email: email,
    p_phone: '+269 000 00 00', p_country: 'Union des Comores', p_city: 'Moroni', p_category_id: state.category.id,
    p_contract_reference: null, p_contract_signed_on: null, p_reason: 'Contrôle automatisé', ...extra,
  });
  const authUser = async (email) => (await admin.rpc('find_auth_user_by_email', { p_email: email })).data ?? null;

  // B5 : permission.
  const newEmail = fresh('manuel-nouveau');
  check('B5 : sans affiliates.create, la vérification est refusée', Boolean((await sessions.nu.rpc('affiliate_creation_check', { p_email: newEmail })).error));
  check('B5 : sans affiliates.create, la création est refusée (ADMIN sans droit)', Boolean((await create(sessions.nu, newEmail)).error));
  check('B5 : affiliates.update ne suffit pas', Boolean((await create(sessions.editeur, newEmail)).error));
  check('B5 : l’affilié ne s’ajoute pas lui-même', Boolean((await create(sessions.affA, newEmail)).error));
  check('B5 : un visiteur anonyme non plus', Boolean((await sessionClient(target).rpc('create_affiliate', {
    p_display_name: 'X', p_party_type: 'PERSONNE', p_legal_name: null, p_email: newEmail, p_phone: null, p_country: null, p_city: null, p_category_id: state.category.id,
  })).error));

  // B3 : une adresse inconnue.
  const probe = await sessions.createur.rpc('affiliate_creation_check', { p_email: newEmail });
  check('B3 : adresse inconnue — ni compte, ni client, ni fiche, ni candidature',
    probe.data && !probe.data.account && !probe.data.client && probe.data.affiliate === null && probe.data.application === null, JSON.stringify(probe.data ?? probe.error?.message));
  const created = await create(sessions.createur, newEmail.toUpperCase());
  check('affiliates.create crée la fiche en préparation', !created.error && created.data?.status === 'PREPARATION', created.error?.message);
  const manual = created.data;
  state.manualNewId = manual?.id;
  check('B4 : origine ADMINISTRATION, auteur enregistré, adresse normalisée',
    manual?.origin === 'ADMINISTRATION' && manual.created_by === state.createur.userId && manual.contact_email === newEmail, JSON.stringify(manual));
  check('B3 : aucune référence ni compte avant l’activation', manual?.reference === null && manual?.user_id === null);
  check('B3 : aucun compte Auth n’a été créé', (await authUser(newEmail)) === null);
  const { count: fakeApps } = await admin.from('affiliate_applications').select('id', { count: 'exact', head: true }).ilike('email', newEmail);
  check('B4 : aucune candidature fabriquée', fakeApps === 0, String(fakeApps));
  const { data: events } = await admin.from('affiliate_events').select('event_type, actor_id, reason, created_at').eq('affiliate_id', manual?.id);
  check('B4 : l’historique dit qui, quand et selon quelle origine',
    (events ?? []).length === 1 && events[0].event_type === 'AFFILIE_CREE' && events[0].actor_id === state.createur.userId &&
      /Ajout direct par l'administration/.test(events[0].reason ?? '') && Boolean(events[0].created_at), JSON.stringify(events));
  check('une candidature acceptée garde l’origine CANDIDATURE',
    (await admin.from('affiliates').select('origin').eq('id', state.acceptedAffiliateId).single()).data?.origin === 'CANDIDATURE');

  // B7 : doublons.
  check('B7 : même adresse qu’un affilié existant → refusé', Boolean((await create(sessions.createur, ` ${newEmail} `)).error));
  check('B7 : l’adresse d’un affilié actif → refusé', Boolean((await create(sessions.createur, state.userA.email)).error));
  const dupCheck = await sessions.createur.rpc('affiliate_creation_check', { p_email: state.userA.email });
  check('B7 : la vérification désigne la fiche existante', dupCheck.data?.affiliate?.id === state.affA.id, JSON.stringify(dupCheck.data));
  // Même compte Auth, rattaché à une fiche dont l'adresse de contact diffère.
  const linked = await createAccount(admin, { roleCode: 'AFFILIE', label: 'lie' });
  const { error: linkError } = await admin.from('affiliates').insert({
    slug: `${PREFIX}-lie-${RUN.toLowerCase()}`, reference: 'MORA-AFIL-ZZ9004', user_id: linked.userId, category_id: state.category.id, status: 'ACTIF',
    display_name: 'Contrôle lié', contact_email: fresh('contact-lie'), started_on: new Date().toISOString().slice(0, 10),
  });
  if (linkError) throw new Error(`fiche liée : ${linkError.message}`);
  check('B7 : un compte Auth déjà rattaché à une affiliation → refusé', Boolean((await create(sessions.createur, linked.email)).error));
  // Candidature en cours.
  const candidate = fresh('candidat-en-cours');
  const submitted = await sessionClient(target).rpc('submit_affiliate_application', application({ p_email: candidate }));
  if (submitted.error) throw new Error(`candidature : ${submitted.error.message}`);
  state.applicationIds = [...(state.applicationIds ?? []), submitted.data?.id ?? submitted.data].filter((v) => typeof v === 'string');
  const appCheck = await sessions.createur.rpc('affiliate_creation_check', { p_email: candidate });
  check('B7 : la vérification signale la candidature en cours', Boolean(appCheck.data?.application), JSON.stringify(appCheck.data));
  check('B7 : un candidat déjà présent → refusé, la candidature se traite', Boolean((await create(sessions.createur, candidate)).error));
  // Double clic : deux envois simultanés, une seule fiche.
  const twice = fresh('double-clic');
  const [first, second] = await Promise.all([create(sessions.createur, twice), create(sessions.createur, twice)]);
  const { count: twins } = await admin.from('affiliates').select('id', { count: 'exact', head: true }).eq('contact_email', twice);
  check('B7 : double clic — un seul envoi aboutit, une seule fiche', twins === 1 && [first, second].filter((r) => !r.error).length === 1,
    `${twins} fiche(s) ; ${first.error?.message ?? 'ok'} / ${second.error?.message ?? 'ok'}`);
  const forced = await admin.from('affiliates').insert({
    slug: `${PREFIX}-force-${RUN.toLowerCase()}`, category_id: state.category.id, display_name: 'Forcé', contact_email: twice.toUpperCase(),
  }).select();
  check('B7 : la base refuse le doublon même par la clé de service (index unique, casse comprise)', refused(forced) && forced.error?.code === '23505', forced.error?.code);

  // B8 : client existant → ajout → activation sur son compte.
  const clientCheck = await sessions.createur.rpc('affiliate_creation_check', { p_email: state.client.email });
  check('B3 : un client existant est reconnu (compte et client), sans fiche',
    clientCheck.data?.account === true && clientCheck.data?.client === true && clientCheck.data?.affiliate === null, JSON.stringify(clientCheck.data));
  const fromClient = await create(sessions.createur, state.client.email, { p_display_name: 'Client devenu affilié' });
  check('B8 : la fiche d’un client existant se crée, sans compte rattaché', !fromClient.error && fromClient.data?.user_id === null, fromClient.error?.message);
  state.manualClientId = fromClient.data?.id;

  const activate = async (affiliateId, email) => {
    const proposed = await sessions.payeur.rpc('propose_payout_account', {
      p_affiliate_id: affiliateId, p_method: 'MVOLA', p_details: { numero: '000 00 00', titulaire: 'Contrôle' },
    });
    if (proposed.error) throw new Error(`coordonnées : ${proposed.error.message}`);
    const reviewed = await sessions.payeur.rpc('review_payout_account', { p_account_id: proposed.data.id, p_approve: true, p_note: null });
    if (reviewed.error) throw new Error(`validation : ${reviewed.error.message}`);
    const blockers = await sessions.createur.rpc('affiliate_activation_blockers', { p_affiliate_id: affiliateId });
    check('la fiche ajoutée suit le parcours existant : plus aucun blocage', (blockers.data ?? []).length === 0, JSON.stringify(blockers.data));
    // Même enchaînement que l'action `activateAffiliate` : compte retrouvé par l'adresse, créé sinon.
    let userId = await authUser(email);
    let createdAccount = false;
    if (!userId) {
      const made = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (made.error) throw new Error(`compte : ${made.error.message}`);
      userId = made.data.user.id;
      createdAccount = true;
    }
    const done = await sessions.createur.rpc('activate_affiliate', { p_affiliate_id: affiliateId, p_user_id: userId, p_started_on: null });
    return { done, userId, createdAccount };
  };

  const { data: usersBefore } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const b8 = await activate(state.manualClientId, state.client.email);
  check('B8 : le compte du client est retrouvé, pas recréé', b8.createdAccount === false && b8.userId === state.client.userId);
  check('B8 : activation réussie, référence MORA-AFIL attribuée',
    !b8.done.error && b8.done.data?.status === 'ACTIF' && /^MORA-AFIL-[A-Z]+\d{4}$/.test(b8.done.data?.reference ?? ''), b8.done.error?.message ?? b8.done.data?.reference);
  const { data: usersAfter } = await admin.auth.admin.listUsers({ perPage: 1000 });
  check('B8 : aucun second compte', (usersAfter?.users ?? []).filter((u) => u.email === state.client.email).length === 1 &&
    (usersAfter?.users ?? []).length === (usersBefore?.users ?? []).length);
  const { data: clientRoles } = await admin.from('user_roles').select('roles!inner(code)').eq('user_id', state.client.userId);
  const clientCodes = (clientRoles ?? []).map((r) => r.roles.code).sort();
  check('B8 : le client garde son rôle CLIENT et reçoit AFFILIE', JSON.stringify(clientCodes) === JSON.stringify(['AFFILIE', 'CLIENT']), clientCodes.join(','));
  const clientSession = await signIn(target, state.client.email);
  const ownB8 = await clientSession.from('affiliates').select('id, status, reference, origin').eq('id', state.manualClientId);
  check('B8 : sa session lit sa fiche active (espace affilié)', ownB8.data?.[0]?.status === 'ACTIF' && ownB8.data[0].origin === 'ADMINISTRATION', JSON.stringify(ownB8.data));

  // B9 : nouvelle adresse .test → activation crée le compte.
  const b9 = await activate(state.manualNewId, newEmail);
  check('B9 : le compte est créé à l’activation, pas avant', b9.createdAccount === true);
  check('B9 : activation réussie, référence MORA-AFIL attribuée',
    !b9.done.error && b9.done.data?.status === 'ACTIF' && /^MORA-AFIL-[A-Z]+\d{4}$/.test(b9.done.data?.reference ?? ''), b9.done.error?.message);
  const { data: newRoles } = await admin.from('user_roles').select('roles!inner(code)').eq('user_id', b9.userId);
  check('B9 : le nouveau compte reçoit le rôle AFFILIE, et lui seul', (newRoles ?? []).length === 1 && newRoles[0].roles.code === 'AFFILIE', JSON.stringify(newRoles));
  const newSession = await signIn(target, newEmail);
  const ownB9 = await newSession.from('affiliates').select('id, status').eq('id', state.manualNewId);
  check('B9 : sa session lit sa fiche active (espace affilié)', ownB9.data?.[0]?.status === 'ACTIF');
  check('B1 : une fois actif, il emprunte le même moteur (totaux de commission lisibles)',
    !(await newSession.rpc('affiliate_commission_totals', { p_affiliate_id: state.manualNewId })).error);
}

async function teardown(target, accessToken, admin, state, before) {
  log.step('Nettoyage des données de contrôle');
  // 4H-4 : attributions et utilisations de code d'abord (elles référencent
  // commandes, codes et prospects), puis commandes et demandes de contrôle,
  // reconnues à leur série ZZ et à leur libellé — même après une exécution
  // interrompue.
  await runSql(target, accessToken, `
    begin;
    alter table public.affiliate_attributions disable trigger affiliate_attributions_guard;
    alter table public.affiliate_code_uses disable trigger affiliate_code_uses_guard;
    alter table public.affiliate_prospects disable trigger affiliate_prospects_guard;
    alter table public.affiliate_events disable trigger affiliate_events_append_only;
    alter table public.affiliate_commissions disable trigger affiliate_commissions_guard;
    alter table public.affiliate_commission_adjustments disable trigger affiliate_adjustments_guard;
    alter table public.affiliate_payouts disable trigger affiliate_payouts_guard;
    alter table public.affiliate_payout_items disable trigger affiliate_payout_items_guard;
    create temporary table zz_payouts on commit drop as
      select p.id, p.document_id from public.affiliate_payouts p join public.affiliates a on a.id = p.affiliate_id
       where a.slug like '${PREFIX}-%' or a.contact_email like '${PREFIX}-%';
    delete from public.notification_events where entity_id in (select id from zz_payouts);
    delete from public.affiliate_payout_items where payout_id in (select id from zz_payouts);
    delete from public.notification_events n using public.affiliate_commissions c, public.affiliates a
     where n.entity_id = c.id and c.affiliate_id = a.id and (a.slug like '${PREFIX}-%' or a.contact_email like '${PREFIX}-%');
    delete from public.affiliate_commission_adjustments j using public.affiliates a
     where j.affiliate_id = a.id and (a.slug like '${PREFIX}-%' or a.contact_email like '${PREFIX}-%');
    delete from public.affiliate_commissions c using public.affiliates a
     where c.affiliate_id = a.id and (a.slug like '${PREFIX}-%' or a.contact_email like '${PREFIX}-%');
    -- Les versements après les commissions et ajustements qui les désignent.
    delete from public.affiliate_payouts where id in (select id from zz_payouts);
    -- Une pièce émise s'annule avant de se supprimer (règle de 4D).
    update public.documents set status = 'ANNULE' where id in (select document_id from zz_payouts where document_id is not null);
    delete from public.documents where id in (select document_id from zz_payouts where document_id is not null);
    -- Fiches FIAF de contrôle : annulées, déliées de leurs versions, supprimées.
    create temporary table zz_sheets on commit drop as
      select d.id from public.documents d join public.affiliates a on a.id = d.entity_id
       where d.doc_type = 'FIAF' and (a.slug like '${PREFIX}-%' or a.contact_email like '${PREFIX}-%');
    update public.documents set status = 'ANNULE' where id in (select id from zz_sheets);
    update public.documents set replaces_id = null where id in (select id from zz_sheets);
    delete from public.documents where id in (select id from zz_sheets);
    alter table public.affiliate_payouts enable trigger affiliate_payouts_guard;
    alter table public.affiliate_payout_items enable trigger affiliate_payout_items_guard;
    alter table public.affiliate_commissions enable trigger affiliate_commissions_guard;
    alter table public.affiliate_commission_adjustments enable trigger affiliate_adjustments_guard;
    delete from public.refunds f using public.orders o
     where f.order_id = o.id and o.reference like 'MORA-CMCL-ZZ%' and o.customer_name = 'Contrôle 4H';
    delete from public.payments y using public.orders o
     where y.order_id = o.id and o.reference like 'MORA-CMCL-ZZ%' and o.customer_name = 'Contrôle 4H';
    delete from public.affiliate_code_uses u using public.orders o
     where u.order_id = o.id and o.reference like 'MORA-CMCL-ZZ%' and o.customer_name = 'Contrôle 4H';
    delete from public.affiliate_attributions at using public.affiliates a
     where at.affiliate_id = a.id and (a.slug like '${PREFIX}-%' or a.contact_email like '${PREFIX}-%');
    delete from public.affiliate_prospects p using public.affiliates a
     where p.affiliate_id = a.id and (a.slug like '${PREFIX}-%' or a.contact_email like '${PREFIX}-%');
    alter table public.order_items disable trigger order_items_closed_order;
    delete from public.order_items i using public.orders o
     where i.order_id = o.id and o.reference like 'MORA-CMCL-ZZ%' and o.customer_name = 'Contrôle 4H';
    alter table public.order_items enable trigger order_items_closed_order;
    delete from public.order_events e using public.orders o
     where e.order_id = o.id and o.reference like 'MORA-CMCL-ZZ%' and o.customer_name = 'Contrôle 4H';
    delete from public.order_status_history h using public.orders o
     where h.order_id = o.id and o.reference like 'MORA-CMCL-ZZ%' and o.customer_name = 'Contrôle 4H';
    delete from public.orders where reference like 'MORA-CMCL-ZZ%' and customer_name = 'Contrôle 4H';
    delete from public.quote_request_events e using public.quote_requests r
     where e.quote_request_id = r.id and r.reference like 'MORA-DMCL-ZZ%' and r.subject = 'Contrôle 4H';
    delete from public.quote_requests where reference like 'MORA-DMCL-ZZ%' and subject = 'Contrôle 4H';
    delete from public.leads where email like '${PREFIX}-%';
    alter table public.affiliate_attributions enable trigger affiliate_attributions_guard;
    alter table public.affiliate_code_uses enable trigger affiliate_code_uses_guard;
    alter table public.affiliate_prospects enable trigger affiliate_prospects_guard;
    alter table public.affiliate_events enable trigger affiliate_events_append_only;
    commit;
  `).catch((error) => log.fail(`démontage de l'attribution : ${error.message}`));


  // Candidatures de contrôle : leur historique (protégé en ajout seul) et
  // leurs e-mails d'abord, puis les candidatures, puis les fiches nées d'une
  // acceptation de contrôle.
  const appIds = (state.applicationIds ?? []).filter(Boolean);
  const { data: strayApps } = await admin.from('affiliate_applications').select('id').like('email', `${PREFIX}-%`);
  for (const row of strayApps ?? []) if (!appIds.includes(row.id)) appIds.push(row.id);
  if (appIds.length > 0) {
    const list = appIds.map((id) => `'${id}'`).join(', ');
    await runSql(target, accessToken, `
      begin;
      alter table public.affiliate_application_events disable trigger affiliate_application_events_append_only;
      alter table public.affiliate_events disable trigger affiliate_events_append_only;
      delete from public.email_outbox where entity_type = 'affiliate_application' and entity_id in (${list});
      delete from public.affiliate_application_events where application_id in (${list});
      delete from public.affiliate_applications where id in (${list});
      alter table public.affiliate_application_events enable trigger affiliate_application_events_append_only;
      alter table public.affiliate_events enable trigger affiliate_events_append_only;
      commit;
    `).catch((error) => log.fail(`démontage des candidatures : ${error.message}`));
  }
  await runSql(target, accessToken,
    `delete from public.rate_limit_counters where bucket = 'affiliation.candidature' and subject_hash like 'verif-%';`,
  ).catch(() => {});


  // Une transaction : les gardes d'immuabilité ne sont levés que le temps de
  // supprimer des données de contrôle, et reviennent quoi qu'il arrive.
  await runSql(target, accessToken, `
    begin;
    alter table public.affiliate_rules  disable trigger affiliate_rules_immutable;
    alter table public.affiliate_rules  disable trigger affiliate_rules_history;
    alter table public.affiliate_events disable trigger affiliate_events_append_only;
    alter table public.affiliate_payout_accounts disable trigger affiliate_payout_accounts_guard;
    alter table public.affiliate_campaigns disable trigger affiliate_campaigns_guard;
    alter table public.affiliate_codes disable trigger affiliate_codes_guard;
    delete from public.affiliate_payout_accounts p using public.affiliates a
     where p.affiliate_id = a.id and (a.slug like '${PREFIX}-%' or a.contact_email like '${PREFIX}-%');
    delete from public.affiliate_campaigns c using public.affiliates a
     where c.affiliate_id = a.id and (a.slug like '${PREFIX}-%' or a.contact_email like '${PREFIX}-%');
    delete from public.affiliate_codes c using public.affiliates a
     where c.affiliate_id = a.id and (a.slug like '${PREFIX}-%' or a.contact_email like '${PREFIX}-%');
    alter table public.affiliate_payout_accounts enable trigger affiliate_payout_accounts_guard;
    alter table public.affiliate_campaigns enable trigger affiliate_campaigns_guard;
    alter table public.affiliate_codes enable trigger affiliate_codes_guard;
    -- supersedes_id est en « restrict », vérifié ligne à ligne : on délie
    -- les versions avant de les supprimer.
    update public.affiliate_rules r set supersedes_id = null
      from public.affiliates a
     where r.affiliate_id = a.id and (a.slug like '${PREFIX}-%' or a.contact_email like '${PREFIX}-%');
    update public.affiliate_rules r set supersedes_id = null
      from public.affiliate_categories c
     where r.category_id = c.id and c.code like 'ZZ_VERIF_%';
    delete from public.affiliate_rules r
     using public.affiliates a
     where r.affiliate_id = a.id and (a.slug like '${PREFIX}-%' or a.contact_email like '${PREFIX}-%');
    delete from public.affiliate_rules r
     using public.affiliate_categories c
     where r.category_id = c.id and c.code like 'ZZ_VERIF_%';
    delete from public.affiliate_events e
     using public.affiliate_categories c
     where e.category_id = c.id and c.code like 'ZZ_VERIF_%';
    delete from public.affiliates where slug like '${PREFIX}-%' or contact_email like '${PREFIX}-%';
    delete from public.affiliate_categories where code like 'ZZ_VERIF_%';
    -- Offres de contrôle publiées (cas 1 et 2 du correctif de clôture) : la
    -- garde « publiée = jamais supprimée » est levée le temps de les retirer.
    alter table public.services disable trigger services_no_delete_when_published;
    alter table public.products disable trigger products_no_delete_when_published;
    delete from public.services where slug like '${PREFIX}-%';
    delete from public.products where slug like '${PREFIX}-%';
    alter table public.services enable trigger services_no_delete_when_published;
    alter table public.products enable trigger products_no_delete_when_published;
    delete from public.categories where slug like '${PREFIX}-%';
    alter table public.affiliate_rules  enable trigger affiliate_rules_immutable;
    alter table public.affiliate_rules  enable trigger affiliate_rules_history;
    alter table public.affiliate_events enable trigger affiliate_events_append_only;
    commit;
  `).catch((error) => log.fail(`démontage SQL : ${error.message}`));

  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of users?.users ?? []) {
    if (user.email?.startsWith(PREFIX)) await admin.auth.admin.deleteUser(user.id);
  }

  const triggers = await runSql(target, accessToken, `
    select tgname, tgenabled from pg_trigger
     where tgname in ('affiliate_rules_immutable', 'affiliate_rules_history', 'affiliate_events_append_only',
                      'affiliate_application_events_append_only', 'affiliate_commissions_guard', 'affiliate_adjustments_guard',
                      'affiliate_payouts_guard', 'affiliate_payout_items_guard',
                      'services_no_delete_when_published', 'products_no_delete_when_published');
  `).catch(() => []);
  check('les gardes d’immuabilité sont réactivés',
    (triggers ?? []).length === 10 && triggers.every((t) => t.tgenabled === 'O'), JSON.stringify(triggers));

  for (const table of TABLES) {
    const { count } = await admin.from(table).select('id', { count: 'exact', head: true });
    check(`aucun résidu de contrôle dans ${table}`, count === before.counts[table], `${count} contre ${before.counts[table]}`);
  }
  const { data: accounts } = await admin.auth.admin.listUsers({ perPage: 1000 });
  check('aucun compte de contrôle ne subsiste',
    !(accounts?.users ?? []).some((user) => user.email?.startsWith(PREFIX)));

  // Le compteur AFIL a pu être consommé par l'activation de contrôle (la
  // référence est allouée par l'allocateur réel). Le document qui portait ce
  // numéro n'existe pas — AFIL n'émet rien — et l'affilié vient d'être
  // supprimé : on rend donc le compteur tel qu'il a été trouvé.
  for (const code of SEQUENCES) {
    const initial = before.sequences[code];
    const sql = initial
      ? `update public.document_sequences set series = '${initial.series}', last_number = ${initial.last_number}, allocated_count = ${initial.allocated_count} where doc_type = '${code}';`
      : `delete from public.document_sequences where doc_type = '${code}';`;
    await runSql(target, accessToken, sql).catch((error) => log.fail(`restitution ${code} : ${error.message}`));
  }

  const after = await runSql(target, accessToken, `
    select doc_type, series, last_number, allocated_count from public.document_sequences
     where doc_type in (${SEQUENCES.map((c) => `'${c}'`).join(', ')}) order by doc_type;
  `).catch(() => null);
  const restored = Object.fromEntries((after ?? []).map((row) => [row.doc_type, row]));
  for (const code of SEQUENCES) {
    check(`la suite ${code} n’a pas bougé`,
      JSON.stringify(before.sequences[code] ?? null) === JSON.stringify(restored[code] ?? null),
      `avant ${JSON.stringify(before.sequences[code] ?? null)} — après ${JSON.stringify(restored[code] ?? null)}`);
  }
}

async function main() {
  const target = resolveTarget();
  const accessToken = resolveAccessToken();
  log.step(`Affiliation — ${describeTarget(target)}`);

  const admin = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = await runSql(target, accessToken, `
    select doc_type, series, last_number, allocated_count from public.document_sequences
     where doc_type in (${SEQUENCES.map((c) => `'${c}'`).join(', ')});
  `);
  const sequences = {};
  for (const row of rows ?? []) sequences[row.doc_type] = row;
  const counts = {};
  for (const table of TABLES) {
    const { count } = await admin.from(table).select('id', { count: 'exact', head: true });
    counts[table] = count ?? 0;
  }
  const before = { sequences, counts };
  const state = { startedAt: new Date().toISOString() };

  // Mode de reprise : nettoie les données de contrôle laissées par une
  // exécution interrompue, sans rien contrôler d'autre.
  if (process.argv.includes('--nettoyage-seul')) {
    await teardown(target, accessToken, admin, state, before);
    return;
  }

  try {
    await checkCatalogue(admin);
    await checkParity(admin);

    log.step('Comptes et affiliés de contrôle');
    state.client = await createAccount(admin, { roleCode: 'CLIENT', label: 'client' });
    state.userA = await createAccount(admin, { roleCode: 'AFFILIE', label: 'affa' });
    state.userB = await createAccount(admin, { roleCode: 'AFFILIE', label: 'affb' });
    state.nu = await createAccount(admin, { roleCode: 'ADMIN', label: 'nu' });
    state.lecteur = await createAccount(admin, { roleCode: 'ADMIN', label: 'lecteur', grants: ['affiliates.view'] });
    state.editeur = await createAccount(admin, { roleCode: 'ADMIN', label: 'editeur', grants: ['affiliates.view', 'affiliates.update'] });
    state.regles = await createAccount(admin, { roleCode: 'ADMIN', label: 'regles', grants: ['affiliates.view', 'affiliate_rules.manage'] });
    state.candidatures = await createAccount(admin, { roleCode: 'ADMIN', label: 'candidatures', grants: ['affiliates.view', 'affiliate_applications.view'] });
    state.decideur = await createAccount(admin, { roleCode: 'ADMIN', label: 'decideur', grants: ['affiliates.view', 'affiliate_applications.view', 'affiliate_applications.manage'] });
    state.accepteur = await createAccount(admin, { roleCode: 'ADMIN', label: 'accepteur', grants: ['affiliates.view', 'affiliate_applications.view', 'affiliate_applications.manage', 'affiliates.create'] });
    state.tresorier = await createAccount(admin, { roleCode: 'ADMIN', label: 'tresorier', grants: ['affiliates.view', 'affiliate_applications.view', 'payouts.view'] });
    state.payeur = await createAccount(admin, { roleCode: 'ADMIN', label: 'payeur', grants: ['affiliates.view', 'payouts.view', 'payouts.manage'] });
    state.codeur = await createAccount(admin, { roleCode: 'ADMIN', label: 'codeur', grants: ['affiliates.view', 'affiliate_codes.manage'] });
    state.gardien = await createAccount(admin, { roleCode: 'ADMIN', label: 'gardien', grants: ['affiliates.view', 'affiliates.disable'] });
    state.attributeur = await createAccount(admin, {
      roleCode: 'ADMIN', label: 'attributeur',
      grants: ['affiliates.view', 'affiliate_attributions.manage', 'affiliate_codes.manage', 'orders.view', 'orders.update'],
    });
    state.documentiste = await createAccount(admin, {
      roleCode: 'ADMIN', label: 'documentiste', grants: ['affiliates.view', 'affiliate_documents.issue'],
    });
    state.commissaire = await createAccount(admin, {
      roleCode: 'ADMIN', label: 'commissaire', grants: ['affiliates.view', 'commissions.view', 'commissions.manage', 'commissions.validate'],
    });
    state.candidateEmail = `${PREFIX}-candidat-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`;
    state.catalogueSeul = await createAccount(admin, {
      roleCode: 'ADMIN', label: 'catalogue', grants: ['services.view', 'services.update', 'products.view', 'products.update'],
    });
    state.eligibilite = await createAccount(admin, {
      roleCode: 'ADMIN', label: 'eligibilite',
      grants: ['services.view', 'services.update', 'products.view', 'products.update', 'affiliates.view', 'affiliate_rules.manage'],
    });
    state.createur = await createAccount(admin, { roleCode: 'ADMIN', label: 'createur', grants: ['affiliates.view', 'affiliates.create'] });
    state.derogateur = await createAccount(admin, {
      roleCode: 'ADMIN', label: 'derogateur', grants: ['affiliates.view', 'affiliate_rules.manage', 'affiliate_rules.derogate'],
    });

    const { data: category, error: catError } = await admin.from('affiliate_categories')
      .insert({ code: CATEGORY_CODE, label: 'Contrôle 4H', description: 'Catégorie de contrôle automatisé' })
      .select().single();
    if (catError) throw new Error(`catégorie de contrôle : ${catError.message}`);
    state.category = category;

    const affiliate = async (user, suffix, serial) => {
      const { data, error } = await admin.from('affiliates').insert({
        slug: `${PREFIX}-${suffix}-${RUN.toLowerCase()}`,
        // Série ZZ, écrite par la clé de service : aucun numéro réel consommé.
        reference: `MORA-AFIL-ZZ${String(serial).padStart(4, '0')}`,
        user_id: user.userId,
        category_id: category.id,
        status: 'ACTIF',
        display_name: `Contrôle ${suffix.toUpperCase()}`,
        contact_email: user.email,
        started_on: new Date().toISOString().slice(0, 10),
      }).select().single();
      if (error) throw new Error(`affilié ${suffix} : ${error.message}`);
      return data;
    };
    state.affA = await affiliate(state.userA, 'a', 9001);
    state.affB = await affiliate(state.userB, 'b', 9002);
    check('les affiliés de contrôle sont créés (série ZZ)', true);

    const sessions = {};
    for (const key of ['catalogueSeul', 'eligibilite', 'createur', 'documentiste', 'commissaire', 'client', 'nu', 'lecteur', 'editeur', 'regles', 'derogateur', 'candidatures', 'decideur', 'accepteur', 'tresorier', 'payeur', 'codeur', 'gardien', 'attributeur']) {
      sessions[key] = await signIn(target, state[key].email);
    }
    sessions.affA = await signIn(target, state.userA.email);
    sessions.affB = await signIn(target, state.userB.email);

    await checkRules(admin, sessions, state);
    await checkIsolation(target, admin, sessions, state);
    await checkAttribution(target, admin, sessions, state);
    await checkCommissions(target, accessToken, admin, sessions, state);
    await checkPayouts(target, accessToken, admin, sessions, state);
    await checkDocuments(target, accessToken, admin, sessions, state);
    await checkProfileSuspension(target, admin, sessions, state);
    await checkApplications(target, admin, sessions, state);
    await checkAffiliates(target, accessToken, admin, sessions, state);
    await checkOfferEligibility(target, admin, sessions, state);
    await checkManualAffiliates(target, accessToken, admin, sessions, state);
  } catch (error) {
    results.failed += 1;
    log.fail(`interruption : ${error.message}`);
  } finally {
    await teardown(target, accessToken, admin, state, before).catch((error) => {
      results.failed += 1;
      log.fail(`nettoyage incomplet : ${error.message}`);
    });
  }

  log.step('Bilan');
  console.log(`  ${results.passed} contrôle(s) réussi(s), ${results.failed} en échec.`);
  if (results.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  log.fail(error.message);
  process.exitCode = 1;
});
