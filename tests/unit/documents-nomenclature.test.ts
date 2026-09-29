/**
 * Nomenclature officielle des documents — vérifications à froid.
 *
 * Ces contrôles ne remplacent pas `scripts/verify-documents.mjs`, qui éprouve
 * l'allocation contre une vraie base et sous concurrence réelle. Ils couvrent
 * ce qui se démontre sans base : le format, la progression des séries sur
 * l'intégralité d'un cycle, et la normalisation des noms de fichiers.
 *
 * La checklist de la phase 4D demande explicitement quatre d'entre eux :
 * 10 000 allocations sans doublon, la bascule `A9999` → `B0001`, l'identifiant
 * stable après changement de nom du client, et le nom de fichier purgé des
 * caractères interdits.
 *
 * Références : prompt maître § 37-42, § 75-77 ; plan de développement, phase 4D.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCUMENT_TYPES,
  FORBIDDEN_FILENAME_CHARACTERS,
  REFERENCE_PATTERN,
  SERIES_CAPACITY,
  documentFileName,
  documentTypeLabel,
  formatReference,
  isDocumentType,
  isSafeFileName,
  nextReference,
  nextSeries,
  normalizeSubjectName,
  parseReference,
} from '../../src/lib/domain/documents';
import { PERMISSIONS } from '../../src/lib/rbac/catalogue';

const MIGRATION = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '20260930120000_moteur_de_documents.sql'),
  'utf8',
);

/* -------------------------------------------------------------------------- */
/* Format                                                                      */
/* -------------------------------------------------------------------------- */

test('le format officiel est celui du § 37, et lui seul', () => {
  assert.equal(formatReference({ type: 'FACL', series: 'A', number: 1 }), 'MORA-FACL-A0001');
  assert.equal(formatReference({ type: 'COMAF', series: 'A', number: 1 }), 'MORA-COMAF-A0001');
  assert.equal(formatReference({ type: 'CMCL', series: 'B', number: 9999 }), 'MORA-CMCL-B9999');
  assert.equal(formatReference({ type: 'DVCL', series: 'AA', number: 42 }), 'MORA-DVCL-AA0042');
});

test('aucune référence ne porte l\'année (décision D-2)', () => {
  const reference = formatReference({ type: 'FACL', series: 'A', number: 1 });

  assert.ok(!/\d{4}-/.test(reference), 'un millésime apparaît dans la référence');
  // Les deux conventions écartées par D-2 ne doivent jamais être produites.
  assert.ok(!/^MS-/.test(reference));
  assert.ok(!/^(CMD|COM)-/.test(reference));
});

test('un numéro hors série est refusé plutôt que corrigé', () => {
  assert.throws(() => formatReference({ type: 'FACL', series: 'A', number: 0 }), RangeError);
  assert.throws(() => formatReference({ type: 'FACL', series: 'A', number: 10000 }), RangeError);
  assert.throws(() => formatReference({ type: 'FACL', series: 'A', number: 1.5 }), RangeError);
  assert.throws(() => formatReference({ type: 'FACL', series: 'a', number: 1 }), RangeError);
  assert.throws(() => formatReference({ type: 'FAC', series: 'A', number: 1 }), RangeError);
});

test('analyser puis recomposer rend la référence inchangée', () => {
  for (const type of DOCUMENT_TYPES) {
    for (const [series, number] of [['A', 1], ['C', 777], ['AA', 9999]] as const) {
      const reference = formatReference({ type: type.code, series, number });
      const parsed = parseReference(reference);

      assert.ok(parsed, `référence non analysable : ${reference}`);
      assert.equal(formatReference(parsed), reference);
    }
  }
});

test('une chaîne qui n\'est pas une référence officielle est rejetée', () => {
  for (const value of [
    'MS-2026-000001',
    'CMD-2026-0001',
    'COM-2026-0001',
    'MORA-FACL-0001',
    'MORA-FACL-A001',
    'MORA-FACL-A00001',
    'MORA-FACL-A0000',
    'MORA--A0001',
    'MORA-FACL-0A001',
    'MORA_FACL_A0001',
    '',
  ]) {
    assert.equal(parseReference(value), null, `acceptée à tort : ${value}`);
  }
});

test('une référence saisie en minuscules est ramenée à sa forme officielle', () => {
  // Les URLs voyagent en minuscules dans certains clients de messagerie, et un
  // refus sec renverrait un 404 sur un document parfaitement légitime. La
  // tolérance porte sur la saisie, jamais sur ce qui est écrit en base.
  assert.deepEqual(parseReference('  mora-facl-a0001 '), {
    type: 'FACL',
    series: 'A',
    number: 1,
  });
  assert.equal(formatReference(parseReference('mora-facl-a0001')!), 'MORA-FACL-A0001');
});

/* -------------------------------------------------------------------------- */
/* Séries                                                                      */
/* -------------------------------------------------------------------------- */

test('la série progresse comme le § 38 le décrit', () => {
  assert.equal(nextSeries('A'), 'B');
  assert.equal(nextSeries('Y'), 'Z');
  assert.equal(nextSeries('Z'), 'AA');
  assert.equal(nextSeries('AA'), 'AB');
  assert.equal(nextSeries('AZ'), 'BA');
  assert.equal(nextSeries('ZZ'), 'AAA');
  assert.equal(nextSeries('AAZ'), 'ABA');
  assert.equal(nextSeries('ZZZ'), 'AAAA');
});

test('les 26 premières séries sont exactement A à Z, sans répétition', () => {
  const seen: string[] = ['A'];
  for (let index = 1; index < 26; index += 1) {
    seen.push(nextSeries(seen[index - 1]!));
  }

  assert.deepEqual(seen, [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']);
  assert.equal(nextSeries(seen[25]!), 'AA');
});

test('A9999 est suivi de B0001, et Z9999 de AA0001', () => {
  assert.deepEqual(nextReference({ type: 'FACL', series: 'A', number: SERIES_CAPACITY }), {
    type: 'FACL',
    series: 'B',
    number: 1,
  });

  assert.deepEqual(nextReference({ type: 'FACL', series: 'Z', number: SERIES_CAPACITY }), {
    type: 'FACL',
    series: 'AA',
    number: 1,
  });

  assert.deepEqual(nextReference({ type: 'FACL', series: 'ZZ', number: SERIES_CAPACITY }), {
    type: 'FACL',
    series: 'AAA',
    number: 1,
  });
});

test('10 000 identifiants consécutifs sont tous distincts et tous conformes', () => {
  const references = new Set<string>();
  let current = { type: 'FACL', series: 'A', number: 1 };

  for (let index = 0; index < 10_000; index += 1) {
    const reference = formatReference(current);

    assert.match(reference, REFERENCE_PATTERN, `référence non conforme : ${reference}`);
    assert.ok(!references.has(reference), `doublon détecté : ${reference}`);
    references.add(reference);

    current = nextReference(current);
  }

  assert.equal(references.size, 10_000);
  // La série A compte 9 999 identifiants : la bascule se produit donc à
  // l'intérieur même de ce tirage, et c'est exactement ce que la checklist de
  // la phase 4D demande de prouver.
  assert.ok(references.has('MORA-FACL-A9999'));
  assert.ok(references.has('MORA-FACL-B0001'));
  assert.equal(formatReference(current), 'MORA-FACL-B0002');
});

test('la bascule de série ne réutilise jamais un identifiant déjà émis', () => {
  const references = new Set<string>();
  // Trois séries complètes : A, B, puis C. 30 000 identifiants.
  let current = { type: 'CMCL', series: 'A', number: 1 };

  for (let index = 0; index < 30_000; index += 1) {
    const reference = formatReference(current);
    assert.ok(!references.has(reference), `doublon au passage de série : ${reference}`);
    references.add(reference);
    current = nextReference(current);
  }

  assert.equal(references.size, 30_000);
  // Trois bascules ont eu lieu, et aucune n'a rendu un identifiant déjà vu.
  for (const reference of [
    'MORA-CMCL-A9999', 'MORA-CMCL-B0001',
    'MORA-CMCL-B9999', 'MORA-CMCL-C0001',
    'MORA-CMCL-C9999', 'MORA-CMCL-D0001',
  ]) {
    assert.ok(references.has(reference), `identifiant manquant : ${reference}`);
  }
});

/* -------------------------------------------------------------------------- */
/* Noms de fichiers                                                            */
/* -------------------------------------------------------------------------- */

test('le nom est normalisé comme le § 42 le demande', () => {
  assert.equal(normalizeSubjectName('Mohamed Ali'), 'Mohamed-Ali');
  assert.equal(normalizeSubjectName('  Amina   Ahmed  '), 'Amina-Ahmed');
  assert.equal(normalizeSubjectName('Aïcha Saïd'), 'Aicha-Said');
  assert.equal(normalizeSubjectName('Jean-Pierre'), 'Jean-Pierre');
  assert.equal(normalizeSubjectName('O’Brien'), 'OBrien');
});

test('les neuf caractères interdits du § 42 ne survivent jamais', () => {
  const hostile = `Mo/ha\\med:A*li?"<>|`;
  const normalized = normalizeSubjectName(hostile);

  for (const character of FORBIDDEN_FILENAME_CHARACTERS) {
    assert.ok(!normalized.includes(character), `caractère interdit conservé : ${character}`);
  }

  const fileName = documentFileName('MORA-FACL-A0001', hostile);
  assert.ok(isSafeFileName(fileName), `nom de fichier non sûr : ${fileName}`);
  assert.ok(fileName.startsWith('MORA-FACL-A0001_'));
});

test('ni caractère de contrôle, ni traversée de chemin, ni nom réservé', () => {
  assert.equal(normalizeSubjectName('../../etc/passwd'), 'etc-passwd');
  assert.equal(normalizeSubjectName('nom\u0000nul'), 'nom-nul');
  assert.equal(normalizeSubjectName('ligne\nsuivante'), 'ligne-suivante');
  // `NUL.pdf` est inouvrable sur Windows : le nom réservé est désamorcé.
  assert.equal(normalizeSubjectName('NUL'), 'NUL-doc');
  assert.equal(normalizeSubjectName('con'), 'con-doc');
  assert.equal(normalizeSubjectName('...'), '');
  assert.equal(normalizeSubjectName(null), '');
  assert.equal(normalizeSubjectName(undefined), '');
});

test('un nom vide ne produit pas un fichier bancal', () => {
  assert.equal(documentFileName('MORA-FACL-A0001', null), 'MORA-FACL-A0001.pdf');
  assert.equal(documentFileName('MORA-FACL-A0001', '   '), 'MORA-FACL-A0001.pdf');
  assert.equal(documentFileName('MORA-FACL-A0001', '???'), 'MORA-FACL-A0001.pdf');
  assert.ok(isSafeFileName(documentFileName('MORA-FACL-A0001', null)));
});

test('le nom des exemples du prompt maître est reproduit à l\'identique', () => {
  assert.equal(
    documentFileName('MORA-FACL-A0001', 'Mohamed Ali'),
    'MORA-FACL-A0001_Mohamed-Ali.pdf',
  );
  assert.equal(
    documentFileName('MORA-COMAF-A0001', 'Amina Ahmed'),
    'MORA-COMAF-A0001_Amina-Ahmed.pdf',
  );
  for (const type of ['DVCL', 'CMCL', 'FACL', 'AVCL'] as const) {
    assert.equal(
      documentFileName(`MORA-${type}-A0001`, 'Mohamed Ali'),
      `MORA-${type}-A0001_Mohamed-Ali.pdf`,
    );
  }
});

test('changer le nom du client ne change pas l\'identifiant (§ 40)', () => {
  const reference = 'MORA-FACL-A0001';

  const before = documentFileName(reference, 'Mohamed Ali');
  const after = documentFileName(reference, 'Mohamed Ali Soilihi');
  const married = documentFileName(reference, 'Aïcha Saïd-Ahmed');

  assert.notEqual(before, after);
  assert.notEqual(after, married);

  // Seul le suffixe humain bouge. La partie identifiante est la même partout,
  // et c'est la seule chose que le § 40 protège.
  for (const name of [before, after, married]) {
    assert.ok(name.startsWith(`${reference}_`), `identifiant altéré : ${name}`);
    assert.equal(parseReference(name.split('_')[0]!)?.number, 1);
  }
});

test('un nom très long est tronqué sans laisser de tiret en suspens', () => {
  const long = 'Mohamed '.repeat(30);
  const normalized = normalizeSubjectName(long);

  assert.ok(normalized.length <= 60);
  assert.ok(!normalized.endsWith('-'));
  assert.ok(isSafeFileName(documentFileName('MORA-FACL-A0001', long)));
});

/* -------------------------------------------------------------------------- */
/* Accord entre le code et la base                                             */
/* -------------------------------------------------------------------------- */

test('les sept types du § 75 sont les mêmes dans le code et dans la migration', () => {
  const declared = DOCUMENT_TYPES.map((entry) => entry.code).sort();

  const inSql = [...MIGRATION.matchAll(/^\s*\('([A-Z]{4,6})',\s+'/gm)].map((match) => match[1]!).sort();

  assert.deepEqual(declared, ['ACCL', 'AVCL', 'BLCL', 'CMCL', 'COMAF', 'DVCL', 'FACL']);
  assert.deepEqual(inSql, declared, 'le code et la migration ne déclarent pas les mêmes types');

  for (const code of declared) {
    assert.ok(isDocumentType(code));
    assert.ok(documentTypeLabel(code));
  }
});

test('aucune permission « documents.* » n\'a été inventée', () => {
  // Le catalogue des 64 permissions a été figé en phase 4A et il est comparé au
  // SQL par `rbac-catalogue.test.ts`. Le Moteur de Documents étant un service
  // transverse et non un module, il n'a pas de permission propre : un document
  // se lit avec le droit du domaine métier auquel il appartient.
  assert.ok(
    !/insert\s+into\s+public\.permissions/i.test(MIGRATION),
    'la migration ajoute une permission au catalogue figé en 4A',
  );
  assert.ok(
    !/has_permission\s*\(\s*'documents\./i.test(MIGRATION),
    'la migration exige une permission documents.*, qui n\'existe pas',
  );

  // Les permissions déclarées par les types documentaires appartiennent toutes
  // au catalogue existant.
  const declared = [
    ...MIGRATION.matchAll(/'((?:orders|payments|quotes|commissions)\.[a-z_]+)'/g),
  ].map((match) => match[1]!);

  assert.ok(declared.length >= 14, 'les types documentaires ne déclarent pas leurs permissions');
  for (const code of new Set(declared)) {
    assert.ok(PERMISSIONS.includes(code as never), `permission hors catalogue : ${code}`);
  }
});

test('la migration traduit la règle du § 36 en privilèges', () => {
  // Aucune écriture accordée au rôle connecté sur la table des documents.
  assert.ok(/revoke all on public\.documents from anon, authenticated;/.test(MIGRATION));
  assert.ok(/grant select on public\.documents to authenticated;/.test(MIGRATION));
  assert.ok(!/grant[^;]*\b(insert|update|delete)\b[^;]*on public\.documents/i.test(MIGRATION));

  // Le compteur n'est accessible à personne, et l'allocation est réservée au
  // serveur : un compte connecté ne peut pas consommer de numéro.
  assert.ok(/revoke all on public\.document_sequences from anon, authenticated;/.test(MIGRATION));
  assert.ok(
    /revoke execute on function public\.allocate_document_number\(text\) from public, anon, authenticated;/.test(
      MIGRATION,
    ),
  );
  assert.ok(
    !/grant\s+execute on function public\.allocate_document_number\(text\) to [^;]*authenticated/.test(
      MIGRATION,
    ),
  );

  // Aucune politique d'écriture sur les documents.
  assert.ok(
    !/create policy [a-z_]+\s+on public\.documents for (insert|update|delete)/i.test(MIGRATION),
  );
});
