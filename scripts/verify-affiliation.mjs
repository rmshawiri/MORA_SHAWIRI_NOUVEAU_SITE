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

import { randomUUID } from 'node:crypto';

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

const refused = (result) =>
  Boolean(result.error) || (Array.isArray(result.data) && result.data.length === 0);
const empty = (result) => Boolean(result.error) || (result.data ?? []).length === 0;

const TEST_DOMAIN = 'mora-shawiri.test';
const PREFIX = 'verif-affiliation';
const PASSWORD = `Verif-4H-${randomUUID()}`;
const RUN = randomUUID().slice(0, 6).toUpperCase().replace(/[^A-Z]/g, 'X');
const CATEGORY_CODE = `ZZ_VERIF_${RUN}`;
const SEQUENCES = ['AFIL', 'FIAF', 'RVAF', 'COMAF'];
const TABLES = [
  'affiliates', 'affiliate_rules', 'affiliate_categories', 'affiliate_notes', 'affiliate_events',
  'affiliate_applications', 'affiliate_application_events', 'email_outbox',
  'affiliate_payout_accounts', 'affiliate_campaigns', 'affiliate_codes',
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
      template: 'x.y.z', recipient: 'a@b.cd', subject: 's', html_body: 'h', text_body: 't',
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

async function teardown(target, accessToken, admin, state, before) {
  log.step('Nettoyage des données de contrôle');

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
                      'affiliate_application_events_append_only');
  `).catch(() => []);
  check('les gardes d’immuabilité sont réactivés',
    (triggers ?? []).length === 4 && triggers.every((t) => t.tgenabled === 'O'), JSON.stringify(triggers));

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
    state.candidateEmail = `${PREFIX}-candidat-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`;
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
    for (const key of ['client', 'nu', 'lecteur', 'editeur', 'regles', 'derogateur', 'candidatures', 'decideur', 'accepteur', 'tresorier', 'payeur', 'codeur', 'gardien']) {
      sessions[key] = await signIn(target, state[key].email);
    }
    sessions.affA = await signIn(target, state.userA.email);
    sessions.affB = await signIn(target, state.userB.email);

    await checkRules(admin, sessions, state);
    await checkIsolation(target, admin, sessions, state);
    await checkApplications(target, admin, sessions, state);
    await checkAffiliates(target, accessToken, admin, sessions, state);
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
