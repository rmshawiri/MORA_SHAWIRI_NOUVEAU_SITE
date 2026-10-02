/**
 * Vérification du Moteur de Documents contre une base réelle.
 *
 *   node scripts/verify-documents.mjs --env shared
 *   node scripts/verify-documents.mjs --env prod --i-know-this-is-production
 *
 * Les tests unitaires prouvent le *format* et la progression des séries à
 * froid. Ils ne peuvent rien dire de ce qui compte le plus ici : qu'aucune
 * allocation ne collisionne quand plusieurs requêtes arrivent en même temps.
 * C'est un fait de base de données, pas de JavaScript, et il se vérifie contre
 * PostgreSQL ou pas du tout.
 *
 * ## Ce qui est éprouvé
 *
 *   * 10 000 allocations consécutives, sans doublon, avec bascule de série ;
 *   * des allocations réellement **concurrentes**, lancées en parallèle ;
 *   * la bascule `A9999` → `B0001` et `Z9999` → `AA0001` ;
 *   * l'immuabilité de l'identifiant, y compris après changement de nom ;
 *   * les privilèges : le rôle connecté ne peut ni écrire un document, ni
 *     consommer un numéro, ni lire le compteur ;
 *   * la lecture : le destinataire lit sa pièce, un autre compte ne la voit
 *     pas, un administrateur habilité la voit.
 *
 * ## Le décor, et sa destruction
 *
 * Deux types documentaires transitoires, `ZZTEST` et `ZZCONC`, sont créés puis
 * supprimés. Ils ne figurent dans aucune migration et n'existent que le temps
 * du contrôle : consommer 10 000 numéros sur `FACL` percerait un trou de
 * 10 000 factures dans une suite comptable réelle. Le bloc `finally` les
 * démonte, et un balayage final vérifie qu'il ne reste rien.
 *
 * Les documents émis pendant le contrôle laissent une trace dans le journal
 * d'audit. Elle n'est pas effacée : le journal enregistre ce qui s'est
 * réellement passé, et ce qui s'est passé, c'est cette vérification.
 *
 * Références : prompt maître § 36-42 ; `05_STOCKAGE.md` § 184-185 ;
 * plan de développement, phase 4D ; décision D-2.
 */

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import {
  describeTarget,
  log,
  resolveAccessToken,
  resolveTarget,
  runSql,
} from './lib/config.mjs';
import { readClientSequence, restoreClientSequence } from './lib/client-sequence.mjs';

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

/** Types documentaires transitoires. Jamais dans une migration. */
const TEST_TYPE = 'ZZTEST';
const CONCURRENT_TYPE = 'ZZCONC';
const TEST_TYPES = [TEST_TYPE, CONCURRENT_TYPE];

/** Instantané des suites réelles au démarrage. Voir le bilan final. */
let sequencesBefore = '[]';
// Suite MORA-CLI (phase 4I) : les comptes CLIENT de ce contrôle y prennent un
// numéro ; il est rendu dès leur suppression, avant le bilan des suites.
let clientSequenceBefore = null;

const TEST_DOMAIN = 'mora-shawiri.test';
const PASSWORD = `Verif-4D-${randomUUID()}`;

function newEmail(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`;
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Appel d'allocation **corrélé** à la ligne courante.
 *
 * Un détail de PostgreSQL qui a failli rendre ce script mensonger. Écrit
 * naïvement — `cross join lateral allocate_document_number('ZZTEST')` — le
 * planificateur constate que l'argument ne dépend pas de la ligne extérieure,
 * exécute la fonction **une seule fois** et rejoue le même résultat pour les
 * 10 000 lignes. Ce n'est pas un défaut : c'est la sémantique d'une jointure
 * non latérale. Mais le contrôle aurait alors annoncé 10 000 allocations en
 * n'en faisant qu'une, et un doublon massif aurait ressemblé à un bug du
 * moteur.
 *
 * Faire dépendre l'argument du compteur force une évaluation par ligne. La
 * condition est toujours vraie — `generate_series` commence à 1 — et la valeur
 * passée reste exactement le code du type.
 *
 * Le chemin de production, lui, n'est pas concerné : `issue_document()` appelle
 * la fonction une fois par exécution, depuis du plpgsql. C'est ce chemin-là que
 * `checkRealIssuanceConcurrency()` éprouve.
 */
function correlatedAllocation(code, counter = 'g') {
  return `public.allocate_document_number(case when ${counter} > 0 then ${quote(code)} end)`;
}

async function withRetry(label, operation, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        log.skip(`${label} — tentative ${attempt} échouée, nouvel essai`);
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
  }

  throw lastError;
}

/* ========================================================================== */
/*  1. Le schéma                                                              */
/* ========================================================================== */

async function checkSchema(target, accessToken) {
  log.step('Schéma et privilèges');

  const tables = await runSql(
    target,
    accessToken,
    `select c.relname, c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('documents', 'document_types', 'document_sequences');`,
  );

  const byName = new Map((tables ?? []).map((row) => [row.relname, row]));

  for (const table of ['documents', 'document_types', 'document_sequences']) {
    check(`la table « ${table} » existe`, byName.has(table));
    check(`RLS est activée sur « ${table} »`, byName.get(table)?.relrowsecurity === true);
  }

  const policies = await runSql(
    target,
    accessToken,
    `select tablename, policyname, cmd
       from pg_policies
      where schemaname = 'public'
        and tablename in ('documents', 'document_types', 'document_sequences');`,
  );

  const rows = policies ?? [];

  check(
    'aucune politique d’écriture sur « documents »',
    rows.every((row) => row.tablename !== 'documents' || row.cmd === 'SELECT'),
    rows.filter((r) => r.tablename === 'documents' && r.cmd !== 'SELECT').map((r) => r.policyname).join(', '),
  );

  check(
    '« document_sequences » n’a aucune politique — refus total assumé',
    rows.every((row) => row.tablename !== 'document_sequences'),
  );

  const grants = await runSql(
    target,
    accessToken,
    `select table_name, grantee, privilege_type
       from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in ('documents', 'document_types', 'document_sequences')
        and grantee in ('anon', 'authenticated');`,
  );

  const granted = grants ?? [];

  check(
    'le rôle anonyme n’a aucun droit sur les documents',
    granted.every((row) => row.grantee !== 'anon'),
    granted.filter((r) => r.grantee === 'anon').map((r) => `${r.table_name}:${r.privilege_type}`).join(', '),
  );

  check(
    'le rôle connecté n’a que la lecture sur « documents »',
    granted
      .filter((row) => row.table_name === 'documents' && row.grantee === 'authenticated')
      .every((row) => row.privilege_type === 'SELECT'),
  );

  check(
    'le rôle connecté n’a aucun droit sur le compteur',
    granted.every((row) => row.table_name !== 'document_sequences'),
  );

  const execution = await runSql(
    target,
    accessToken,
    `select has_function_privilege('authenticated', 'public.allocate_document_number(text)', 'EXECUTE') as allocate,
            has_function_privilege('authenticated', 'public.issue_document(text, text, uuid, uuid, text, jsonb, uuid)', 'EXECUTE') as issue,
            has_function_privilege('anon', 'public.issue_document(text, text, uuid, uuid, text, jsonb, uuid)', 'EXECUTE') as issue_anon;`,
  );

  const privileges = execution?.[0] ?? {};

  check('un compte connecté ne peut pas allouer un numéro', privileges.allocate === false);
  check('un compte connecté peut appeler issue_document', privileges.issue === true);
  check('un visiteur anonyme ne peut pas émettre de document', privileges.issue_anon === false);

  const types = await runSql(
    target,
    accessToken,
    `select code, view_permission, issue_permission, is_reference_only from public.document_types order by sort_order;`,
  );

  const real = (types ?? []).filter((row) => !TEST_TYPES.includes(row.code));

  // Les six pièces client du § 75, plus les deux pièces d'affiliation de la
  // phase 4H (décision N2 : fiche FIAF, relevé de versement RVAF), et elles
  // seules, émettent une pièce. COMAF est devenu une numérotation métier :
  // une commission porte une référence, elle n'est pas un document.
  const issuing = real.filter((row) => row.is_reference_only === false).map((row) => row.code);

  check(
    'les pièces du § 75 et de la phase 4H sont en base, et elles seules',
    issuing.join(',') === 'DVCL,CMCL,ACCL,BLCL,FACL,AVCL,FIAF,RVAF',
    issuing.join(','),
  );

  // Codes qui **numérotent** une entité métier sans émettre de document :
  // une demande et un rendez-vous (phase 4F, décision B2), un affilié et une
  // commission (phase 4H, décision N2), un client (phase 4I, décision 6 :
  // MORA-CLI). Ils partagent l'allocateur, jamais la
  // table `documents`. Ce contrôle vérifie qu'aucun autre code ne se glisse
  // dans cette catégorie sans décision.
  const referenceOnly = real.filter((row) => row.is_reference_only === true).map((row) => row.code);

  check(
    'les codes de numérotation métier sont ceux des phases 4F, 4H et 4I',
    referenceOnly.sort().join(',') === 'AFIL,CLI,COMAF,DMCL,RVCL',
    referenceOnly.join(','),
  );

  check(
    'aucun type ne référence une permission absente du catalogue',
    (types ?? []).every((row) => row.view_permission && row.issue_permission),
  );
}

/* ========================================================================== */
/*  2. L'allocation                                                           */
/* ========================================================================== */

async function createTestType(target, accessToken, code) {
  await runSql(
    target,
    accessToken,
    `insert into public.document_types (code, label, entity_type, view_permission, issue_permission, sort_order)
     values (${quote(code)}, 'Type de vérification (transitoire)', 'order', 'orders.view', 'orders.update', 9000)
     on conflict (code) do nothing;`,
  );
}

async function checkAllocation(target, accessToken) {
  log.step('Allocation — 10 000 identifiants consécutifs');

  const summary = await runSql(
    target,
    accessToken,
    `select count(*)::int as total,
            count(distinct a.reference)::int as distincts,
            count(*) filter (where a.reference !~ '^MORA-[A-Z]{4,6}-[A-Z]+[0-9]{4}$')::int as malformes,
            count(distinct a.series)::int as series
       from generate_series(1, 10000) g
       cross join lateral ${correlatedAllocation(TEST_TYPE)} a;`,
  );

  const row = summary?.[0] ?? {};

  check('10 000 allocations ont abouti', row.total === 10000, String(row.total));
  check(
    '10 000 identifiants, 10 000 valeurs distinctes — aucun doublon',
    row.distincts === 10000,
    `${row.distincts} distincts`,
  );
  check('aucun identifiant mal formé', row.malformes === 0, String(row.malformes));
  check('la bascule de série s’est produite dans le tirage', row.series === 2, `${row.series} série(s)`);

  const state = await runSql(
    target,
    accessToken,
    `select series, last_number, allocated_count from public.document_sequences where doc_type = ${quote(TEST_TYPE)};`,
  );

  const sequence = state?.[0] ?? {};

  // 9 999 identifiants en série A, puis B0001 : le dix-millième est B0001.
  check('le compteur s’est arrêté sur B0001', sequence.series === 'B' && sequence.last_number === 1,
    `${sequence.series}${sequence.last_number}`);
  check('le total historique est exact', Number(sequence.allocated_count) === 10000,
    String(sequence.allocated_count));

  const existing = await runSql(
    target,
    accessToken,
    `select count(*)::int as total from public.documents where doc_type = ${quote(TEST_TYPE)};`,
  );

  check(
    'allouer un numéro ne crée aucun document',
    existing?.[0]?.total === 0,
    'un numéro alloué sans pièce ne doit laisser aucune ligne',
  );
}

async function checkRollovers(target, accessToken) {
  log.step('Bascules de série');

  const cases = [
    { from: ['A', 9998], expect: ['MORA-ZZTEST-A9999', 'MORA-ZZTEST-B0001'] },
    { from: ['Z', 9999], expect: ['MORA-ZZTEST-AA0001', 'MORA-ZZTEST-AA0002'] },
    { from: ['ZZ', 9999], expect: ['MORA-ZZTEST-AAA0001', 'MORA-ZZTEST-AAA0002'] },
  ];

  for (const testCase of cases) {
    await runSql(
      target,
      accessToken,
      `update public.document_sequences
          set series = ${quote(testCase.from[0])}, last_number = ${testCase.from[1]}
        where doc_type = ${quote(TEST_TYPE)};`,
    );

    const allocated = await runSql(
      target,
      accessToken,
      `select a.reference
         from generate_series(1, 2) g
         cross join lateral ${correlatedAllocation(TEST_TYPE)} a;`,
    );

    const references = (allocated ?? []).map((row) => row.reference);

    check(
      `${testCase.from[0]}${testCase.from[1]} est suivi de ${testCase.expect.join(' puis ')}`,
      references.join(',') === testCase.expect.join(','),
      references.join(','),
    );
  }

  // La fonction SQL et son miroir TypeScript doivent donner le même résultat.
  const series = await runSql(
    target,
    accessToken,
    `select s as depuis, public.document_next_series(s) as suivante
       from unnest(array['A','Y','Z','AA','AZ','ZZ','AAZ','ZZZ']) s;`,
  );

  // Les valeurs attendues sont littéralement celles que `nextSeries()` doit
  // rendre, et que `tests/unit/documents-nomenclature.test.ts` vérifie du côté
  // TypeScript. Les deux implémentations sont ainsi tenues au même barème, sans
  // importer un module TypeScript depuis un script Node.
  const expected = {
    A: 'B', Y: 'Z', Z: 'AA', AA: 'AB', AZ: 'BA', ZZ: 'AAA', AAZ: 'ABA', ZZZ: 'AAAA',
  };

  check(
    'la progression des séries en base est celle du § 38, et celle du code',
    (series ?? []).length === 8 && (series ?? []).every((row) => expected[row.depuis] === row.suivante),
    (series ?? []).map((row) => `${row.depuis}→${row.suivante}`).join(' '),
  );
}

async function checkConcurrency(target, accessToken) {
  log.step('Allocations concurrentes');

  const BATCHES = 40;
  const PER_BATCH = 25;

  const batches = Array.from({ length: BATCHES }, () =>
    runSql(
      target,
      accessToken,
      `select a.reference
         from generate_series(1, ${PER_BATCH}) g
         cross join lateral ${correlatedAllocation(CONCURRENT_TYPE)} a;`,
    ),
  );

  const settled = await Promise.allSettled(batches);

  const refused = settled.filter((entry) => entry.status === 'rejected');
  check(
    `les ${BATCHES} requêtes simultanées ont toutes abouti`,
    refused.length === 0,
    `${refused.length} rejetée(s)`,
  );

  const references = settled
    .filter((entry) => entry.status === 'fulfilled')
    .flatMap((entry) => (entry.value ?? []).map((row) => row.reference));

  const unique = new Set(references);

  check(
    `${references.length} allocations concurrentes, aucune collision`,
    unique.size === references.length,
    `${references.length - unique.size} doublon(s)`,
  );

  const state = await runSql(
    target,
    accessToken,
    `select last_number, allocated_count from public.document_sequences where doc_type = ${quote(CONCURRENT_TYPE)};`,
  );

  check(
    'le compteur a exactement compté ce qui a été distribué',
    Number(state?.[0]?.allocated_count) === references.length,
    `${state?.[0]?.allocated_count} contre ${references.length}`,
  );

  // Le contrôle le plus révélateur : la suite distribuée doit être continue.
  // Un verrou mal posé produirait soit un doublon, soit un trou.
  const numbers = [...references]
    .map((reference) => Number.parseInt(reference.slice(-4), 10))
    .sort((a, b) => a - b);

  const continuous = numbers.every((value, index) => value === index + 1);
  check('la suite distribuée est continue, sans trou', continuous);
}

/**
 * Le chemin réel : 30 émissions simultanées via `issue_document()`.
 *
 * Le contrôle précédent éprouve l'allocateur nu, sur une requête forgée. Celui-
 * ci éprouve ce que la plateforme fera vraiment : trente flux métier qui
 * émettent une pièce au même instant, chacun dans sa transaction, chacun avec
 * son insertion dans `public.documents`.
 *
 * C'est le contrôle qui compte. La contrainte d'unicité sur (type, série,
 * numéro) transformerait toute collision en échec d'insertion, donc en document
 * manquant — pas en doublon silencieux. Trente références distinctes ET trente
 * pièces enregistrées prouvent les deux d'un coup.
 */
async function checkRealIssuanceConcurrency(admin, owner) {
  log.step('Émissions simultanées par le chemin de production');

  const COUNT = 30;

  const settled = await Promise.allSettled(
    Array.from({ length: COUNT }, (_, index) =>
      admin.rpc('issue_document', {
        p_type: CONCURRENT_TYPE,
        p_entity_type: 'order',
        p_entity_id: null,
        p_owner_id: owner.userId,
        p_subject_name: `Concurrent ${index}`,
        p_metadata: { origine: 'verification-4D' },
        p_replaces: null,
      }),
    ),
  );

  const issued = settled
    .filter((entry) => entry.status === 'fulfilled' && !entry.value.error && entry.value.data)
    .map((entry) => entry.value.data);

  check(`les ${COUNT} émissions simultanées ont toutes abouti`, issued.length === COUNT,
    `${issued.length} aboutie(s)`);

  const references = new Set(issued.map((row) => row.reference));
  check(
    'chaque émission a reçu un identifiant distinct',
    references.size === issued.length,
    `${issued.length - references.size} doublon(s)`,
  );

  const { data: stored } = await admin
    .from('documents')
    .select('reference')
    .eq('doc_type', CONCURRENT_TYPE);

  check(
    'autant de pièces enregistrées que d’identifiants distribués',
    (stored ?? []).length === issued.length,
    `${(stored ?? []).length} en base`,
  );

  return issued.map((row) => row.id);
}

/* ========================================================================== */
/*  3. L'émission, l'immuabilité, la lecture                                  */
/* ========================================================================== */

async function checkIssuance(target, accessToken, admin, owner, stranger, reader) {
  log.step('Émission et immuabilité');

  const { data: issued, error: issueError } = await admin.rpc('issue_document', {
    p_type: TEST_TYPE,
    p_entity_type: 'order',
    p_entity_id: null,
    p_owner_id: owner.userId,
    p_subject_name: 'Mohamed Ali',
    p_metadata: { origine: 'verification-4D' },
    p_replaces: null,
  });

  check('le serveur peut émettre un document', !issueError && Boolean(issued), issueError?.message);
  if (!issued) return null;

  check('la référence émise est conforme', /^MORA-ZZTEST-[A-Z]+\d{4}$/.test(issued.reference), issued.reference);
  check('le document est émis à l’état EMIS', issued.status === 'EMIS');
  check('le document porte sa version 1', issued.version === 1);

  const counted = await runSql(
    target,
    accessToken,
    `select count(*)::int as total from public.documents where reference = ${quote(issued.reference)};`,
  );
  check('la pièce est bien enregistrée', counted?.[0]?.total === 1);

  // Immuabilité de l'identifiant.
  for (const [column, value] of [
    ['reference', quote('MORA-ZZTEST-Z9999')],
    ['doc_type', quote('FACL')],
    ['series', quote('Q')],
    ['number', '4242'],
  ]) {
    let refused = false;
    try {
      await runSql(
        target,
        accessToken,
        `update public.documents set ${column} = ${value} where id = ${quote(issued.id)};`,
      );
    } catch {
      refused = true;
    }
    check(`« ${column} » ne peut pas être modifié après émission`, refused);
  }

  // Le nom du client change : l'identifiant ne bouge pas (§ 40).
  await runSql(
    target,
    accessToken,
    `update public.documents set subject_name = 'Mohamed Ali Soilihi' where id = ${quote(issued.id)};`,
  );

  const after = await runSql(
    target,
    accessToken,
    `select reference, subject_name from public.documents where id = ${quote(issued.id)};`,
  );

  check(
    'changer le nom du client est possible…',
    after?.[0]?.subject_name === 'Mohamed Ali Soilihi',
  );
  check(
    '…et ne change pas l’identifiant officiel (§ 40)',
    after?.[0]?.reference === issued.reference,
  );

  // Versionnage : un document qui en remplace un autre reçoit SON numéro.
  const { data: replacement } = await admin.rpc('issue_document', {
    p_type: TEST_TYPE,
    p_entity_type: 'order',
    p_entity_id: null,
    p_owner_id: owner.userId,
    p_subject_name: 'Mohamed Ali',
    p_metadata: {},
    p_replaces: issued.id,
  });

  check('un remplacement reçoit son propre identifiant', replacement?.reference !== issued.reference);
  check('un remplacement porte la version suivante', replacement?.version === 2);

  const replaced = await runSql(
    target,
    accessToken,
    `select status from public.documents where id = ${quote(issued.id)};`,
  );
  check('le document remplacé passe à REMPLACE, il ne disparaît pas', replaced?.[0]?.status === 'REMPLACE');

  // Un type inconnu ne s'invente pas.
  let unknownRefused = false;
  try {
    await runSql(target, accessToken, `select public.allocate_document_number('INCONNU');`);
  } catch {
    unknownRefused = true;
  }
  check('un type documentaire inconnu est refusé', unknownRefused);

  /* ---------------------------------------------------------------------- */

  log.step('Lecture — propriété et permission');

  const ownerClient = await signIn(target, owner.email);
  const strangerClient = await signIn(target, stranger.email);
  const readerClient = await signIn(target, reader.email);

  const own = await ownerClient
    .from('documents')
    .select('reference')
    .eq('reference', issued.reference)
    .maybeSingle();

  check('le destinataire lit sa pièce sans aucune permission', own.data?.reference === issued.reference);

  const foreign = await strangerClient
    .from('documents')
    .select('reference')
    .eq('reference', issued.reference)
    .maybeSingle();

  check('un autre client ne voit pas la pièce', !foreign.data);

  const byPermission = await readerClient
    .from('documents')
    .select('reference')
    .eq('reference', issued.reference)
    .maybeSingle();

  check('un administrateur détenant orders.view la voit', byPermission.data?.reference === issued.reference);

  /* ---------------------------------------------------------------------- */

  log.step('Privilèges — ce qu’une session ne peut pas faire');

  const forgedInsert = await ownerClient.from('documents').insert({
    reference: 'MORA-ZZTEST-Z0001',
    doc_type: TEST_TYPE,
    series: 'Z',
    number: 1,
    entity_type: 'order',
    owner_id: owner.userId,
  });
  check('un compte connecté ne peut pas écrire un document', Boolean(forgedInsert.error));

  const forgedUpdate = await ownerClient
    .from('documents')
    .update({ status: 'ANNULE' })
    .eq('id', issued.id);
  check('un compte connecté ne peut pas modifier un document', Boolean(forgedUpdate.error));

  const forgedDelete = await ownerClient.from('documents').delete().eq('id', issued.id);
  check('un compte connecté ne peut pas supprimer un document', Boolean(forgedDelete.error));

  const allocate = await ownerClient.rpc('allocate_document_number', { p_type: TEST_TYPE });
  check('un compte connecté ne peut pas consommer un numéro', Boolean(allocate.error));

  const sequences = await ownerClient.from('document_sequences').select('*');
  check(
    'un compte connecté ne lit pas le compteur',
    Boolean(sequences.error) || (sequences.data ?? []).length === 0,
  );

  // Un compte qui n'a pas la permission d'émission du type n'émet pas. (Le
  // second facteur n'est plus exigé depuis le 1er octobre 2026 : c'est la
  // permission, ici absente, qui refuse.)
  const issueAttempt = await readerClient.rpc('issue_document', {
    p_type: TEST_TYPE,
    p_entity_type: 'order',
    p_entity_id: null,
    p_owner_id: reader.userId,
    p_subject_name: null,
    p_metadata: {},
    p_replaces: null,
  });
  check(
    'une session sans la permission d’émission ne peut pas émettre de document',
    Boolean(issueAttempt.error),
    issueAttempt.error ? '' : 'émission acceptée à tort',
  );

  const anonymous = createClient(target.url, target.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const anonRead = await anonymous.from('documents').select('*').limit(1);
  check(
    'un visiteur anonyme ne lit aucun document',
    Boolean(anonRead.error) || (anonRead.data ?? []).length === 0,
  );

  const anonIssue = await anonymous.rpc('issue_document', { p_type: TEST_TYPE });
  check('un visiteur anonyme ne peut pas émettre de document', Boolean(anonIssue.error));

  /* ---------------------------------------------------------------------- */

  log.step('Un document émis ne s’efface pas');

  let deleteRefused = false;
  try {
    await runSql(target, accessToken, `delete from public.documents where id = ${quote(replacement.id)};`);
  } catch {
    deleteRefused = true;
  }
  check('même la clé à privilèges ne supprime pas un document émis', deleteRefused);

  return [issued.id, replacement?.id].filter(Boolean);
}

/* ========================================================================== */
/*  Comptes de test                                                           */
/* ========================================================================== */

function sessionClient(target) {
  return createClient(target.url, target.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(target, email) {
  const client = sessionClient(target);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`connexion impossible pour ${email} : ${error.message}`);
  return client;
}

async function createAccount(admin, { roleCode, grants = [], prefix }) {
  const email = newEmail(prefix);

  const data = await withRetry(`création du compte ${prefix}`, async () => {
    const result = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });

    if (result.error || !result.data.user) {
      const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const found = existing.data?.users.find((user) => user.email === email);
      if (found) return { user: found };
      throw new Error(`création du compte ${prefix} impossible : ${result.error?.message ?? 'inconnue'}`);
    }

    return result.data;
  });

  const userId = data.user.id;

  const { data: role } = await admin.from('roles').select('id').eq('code', roleCode).maybeSingle();
  if (!role) throw new Error(`rôle ${roleCode} introuvable`);

  const attributed = await admin.from('user_roles').insert({ user_id: userId, role_id: role.id });
  if (attributed.error && !attributed.error.message.includes('duplicate')) {
    throw new Error(attributed.error.message);
  }

  if (grants.length > 0) {
    const { data: permissions } = await admin.from('permissions').select('id, code').in('code', grants);
    const rows = (permissions ?? []).map((row) => ({
      user_id: userId,
      permission_id: row.id,
      effect: 'OCTROI',
    }));

    if (rows.length !== grants.length) {
      throw new Error(`catalogue incomplet pour ${prefix}`);
    }

    const written = await admin
      .from('user_permissions')
      .upsert(rows, { onConflict: 'user_id,permission_id' });
    if (written.error) throw new Error(written.error.message);
  }

  return { userId, email };
}

/* ========================================================================== */
/*  Exécution                                                                 */
/* ========================================================================== */

async function main() {
  const target = resolveTarget();
  const accessToken = resolveAccessToken();

  log.step(`Moteur de Documents — ${describeTarget(target)}`);

  await checkSchema(target, accessToken);

  // L'état des suites réelles avant toute chose : c'est à lui que le bilan
  // final se compare, pour prouver que ce contrôle n'a percé aucun trou dans
  // une numérotation de production.
  clientSequenceBefore = await readClientSequence(runSql, target, accessToken).catch(() => null);
  sequencesBefore = JSON.stringify(
    (await runSql(
      target,
      accessToken,
      `select doc_type, allocated_count from public.document_sequences order by doc_type;`,
    ).catch(() => [])) ?? [],
  );

  const admin = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const created = [];
  let documents = [];

  try {
    for (const code of TEST_TYPES) {
      await createTestType(target, accessToken, code);
    }

    await checkAllocation(target, accessToken);
    await checkRollovers(target, accessToken);
    await checkConcurrency(target, accessToken);

    const owner = await createAccount(admin, { roleCode: 'CLIENT', prefix: 'destinataire' });
    created.push(owner.userId);

    const stranger = await createAccount(admin, { roleCode: 'CLIENT', prefix: 'tiers' });
    created.push(stranger.userId);

    const reader = await createAccount(admin, {
      roleCode: 'ADMIN',
      prefix: 'lecteur',
      grants: ['orders.view'],
    });
    created.push(reader.userId);

    documents = (await checkIssuance(target, accessToken, admin, owner, stranger, reader)) ?? [];
    documents = documents.concat(await checkRealIssuanceConcurrency(admin, owner));
  } finally {
    log.step('Démontage du décor');

    // Un document émis ne se supprime pas : il faut d'abord l'annuler. C'est la
    // règle que le contrôle précédent vient de prouver, appliquée à lui-même.
    for (const id of documents) {
      await runSql(
        target,
        accessToken,
        `update public.documents set status = 'ANNULE' where id = ${quote(id)};`,
      ).catch(() => undefined);
    }

    const codes = TEST_TYPES.map((code) => quote(code)).join(', ');

    await runSql(target, accessToken, `delete from public.documents where doc_type in (${codes});`)
      .catch(() => undefined);
    await runSql(target, accessToken, `delete from public.document_sequences where doc_type in (${codes});`)
      .catch(() => undefined);
    await runSql(target, accessToken, `delete from public.document_types where code in (${codes});`)
      .catch(() => undefined);

    for (const userId of created) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }

    const clientSequence = await restoreClientSequence(runSql, target, accessToken, clientSequenceBefore).catch(
      (error) => ({ identical: false, note: error.message }),
    );
    check('la suite MORA-CLI est rendue telle qu’elle a été trouvée', clientSequence.identical, clientSequence.note ?? '');

    const residue = await runSql(
      target,
      accessToken,
      `select
         (select count(*) from public.document_types where code in (${codes}))::int as types,
         (select count(*) from public.document_sequences where doc_type in (${codes}))::int as sequences,
         (select count(*) from public.documents where doc_type in (${codes}))::int as documents;`,
    ).catch(() => null);

    const left = residue?.[0] ?? { types: -1, sequences: -1, documents: -1 };

    check(
      'aucun type, compteur ni document de test ne subsiste',
      left.types === 0 && left.sequences === 0 && left.documents === 0,
      JSON.stringify(left),
    );

    const { data: users } = await admin.auth.admin
      .listUsers({ page: 1, perPage: 200 })
      .catch(() => ({ data: null }));

    const leftovers = (users?.users ?? []).filter((user) => user.email?.endsWith(`@${TEST_DOMAIN}`));

    for (const user of leftovers) {
      await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
      log.warn('compte de test résiduel supprimé');
    }

    check('aucun compte de test ne subsiste', leftovers.length === 0, `${leftovers.length} trouvé(s)`);

    // Ce contrôle a longtemps exigé qu'aucun compteur réel n'existe : avant la
    // phase 4F, aucun chemin de production n'émettait quoi que ce soit, et un
    // compteur en service n'aurait pu venir que d'un test mal rangé.
    //
    // Depuis 4F, l'émission d'un devis est un acte réel — et les demandes et
    // rendez-vous consomment leurs propres suites. Exiger zéro reviendrait à
    // interdire au système de fonctionner. Ce qui doit rester vrai, c'est que
    // **ce script** ne consomme rien sur une suite réelle : il compare donc
    // l'état d'après à celui qu'il a relevé avant de commencer.
    const real = await runSql(
      target,
      accessToken,
      `select doc_type, allocated_count from public.document_sequences order by doc_type;`,
    ).catch(() => null);

    const after = JSON.stringify(real ?? []);

    check(
      'aucun numéro n’a été consommé sur un type réel par ce contrôle',
      after === sequencesBefore,
      `avant ${sequencesBefore} — après ${after}`,
    );
  }
}

main()
  .then(() => {
    log.step(`Résultat : ${results.passed} contrôle(s) réussi(s), ${results.failed} échec(s).`);
    if (results.failed > 0) process.exitCode = 1;
  })
  .catch((error) => {
    log.fail(error.message);
    process.exitCode = 1;
  });
