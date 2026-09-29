/**
 * Génération PDF — structure du fichier et fidélité du texte.
 *
 * Un PDF mal formé s'ouvre parfois quand même : les lecteurs indulgents
 * réparent la table de références croisées en la reconstruisant. Ce n'est pas
 * une raison pour en produire un. Ces contrôles vérifient donc que chaque
 * décalage de la table `xref` désigne réellement le début de l'objet annoncé —
 * ce qu'aucun rendu à l'écran ne révélerait.
 *
 * Référence : `01_IDENTITE_MARQUE/SYSTEME_DESIGN_MORA_SHAWIRI.md` § 5-7 ;
 * `07_ARCHITECTURE_TECHNIQUE/05_STOCKAGE.md` § 128.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRAND_COLORS,
  measureText,
  renderDocumentPdf,
  toWinAnsi,
  wrapText,
  type DocumentPdfSpec,
} from '../../src/lib/domain/pdf';

const SPEC: DocumentPdfSpec = {
  title: 'Facture client',
  reference: 'MORA-FACL-A0001',
  issuedAt: '30 septembre 2026 à 14:05',
  subjectName: 'Mohamed Ali',
  statusNotice: null,
  fields: [
    { label: 'Référence officielle', value: 'MORA-FACL-A0001' },
    { label: 'Type de document', value: 'Facture client (FACL)' },
    { label: 'Série', value: 'A0001' },
  ],
  footer: 'MORA Shawiri — Moroni, Union des Comores.',
};

function asLatin1(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

test('le fichier produit est un PDF complet', () => {
  const bytes = renderDocumentPdf(SPEC);
  const text = asLatin1(bytes);

  assert.ok(text.startsWith('%PDF-1.4\n'), 'en-tête PDF absent');
  assert.ok(text.endsWith('%%EOF\n'), 'marque de fin absente');
  assert.ok(text.includes('/Type /Catalog'));
  assert.ok(text.includes('/Type /Page '));
  assert.ok(text.includes('/BaseFont /Helvetica'));
  assert.ok(text.includes('/BaseFont /Helvetica-Bold'));
  assert.ok(bytes.byteLength > 1000, 'fichier suspectement court');
});

test('chaque décalage de la table xref désigne bien son objet', () => {
  const text = asLatin1(renderDocumentPdf(SPEC));

  const startxref = /startxref\n(\d+)\n%%EOF/.exec(text);
  assert.ok(startxref, 'startxref introuvable');

  const xrefOffset = Number.parseInt(startxref[1]!, 10);
  assert.ok(text.startsWith('xref\n', xrefOffset), 'startxref ne pointe pas sur la table');

  const header = /^xref\n0 (\d+)\n/.exec(text.slice(xrefOffset));
  assert.ok(header);

  const count = Number.parseInt(header[1]!, 10);
  const entries = [
    ...text.slice(xrefOffset).matchAll(/^(\d{10}) (\d{5}) ([nf]) $/gm),
  ];

  assert.equal(entries.length, count, 'la table ne contient pas le nombre d\'entrées annoncé');
  assert.equal(entries[0]![3], 'f', 'la première entrée doit être libre');

  entries.slice(1).forEach((entry, index) => {
    const offset = Number.parseInt(entry[1]!, 10);
    assert.ok(
      text.startsWith(`${index + 1} 0 obj\n`, offset),
      `l'objet ${index + 1} n'est pas à l'offset ${offset}`,
    );
  });
});

test('la longueur déclarée du flux correspond à son contenu', () => {
  const text = asLatin1(renderDocumentPdf(SPEC));

  const match = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(text);
  assert.ok(match, 'flux de contenu introuvable');

  assert.equal(match[2]!.length, Number.parseInt(match[1]!, 10));
});

test('les couleurs officielles sont celles du système de design', () => {
  const text = asLatin1(renderDocumentPdf(SPEC));

  const [r, g, b] = BRAND_COLORS.blue;
  assert.ok(
    text.includes(`${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`),
    'le Bleu MORA n\'apparaît pas dans le flux',
  );

  const [gr, gg, gb] = BRAND_COLORS.gold;
  assert.ok(text.includes(`${gr.toFixed(4)} ${gg.toFixed(4)} ${gb.toFixed(4)} rg`));

  // Aucune couleur hors palette : toutes les composantes rencontrées doivent
  // appartenir à l'une des six couleurs officielles.
  const palette = new Set(
    Object.values(BRAND_COLORS).map(
      ([cr, cg, cb]) => `${cr.toFixed(4)} ${cg.toFixed(4)} ${cb.toFixed(4)}`,
    ),
  );

  for (const match of text.matchAll(/([\d.]+ [\d.]+ [\d.]+) (?:rg|RG)/g)) {
    assert.ok(palette.has(match[1]!), `couleur hors palette : ${match[1]}`);
  }
});

test('le texte accentué survit à l\'encodage', () => {
  const text = asLatin1(
    renderDocumentPdf({ ...SPEC, subjectName: 'Aïcha Saïd', title: 'Relevé de commission' }),
  );

  assert.ok(text.includes('(Aïcha Saïd)'), 'les accents ont été perdus');
  assert.ok(text.includes('Relevé'));
  assert.ok(text.includes('/Encoding /WinAnsiEncoding'));
});

test('les caractères hors Latin-1 sont repositionnés, jamais perdus', () => {
  assert.equal(toWinAnsi('tiret — cadratin'), `tiret \u0097 cadratin`);
  assert.equal(toWinAnsi('apostrophe ’ typographique'), 'apostrophe \u0092 typographique');
  assert.equal(toWinAnsi('€ 1 000'), '\u0080 1 000');
  // Ni accent ni équivalent : une espace, pas un point d'interrogation.
  assert.equal(toWinAnsi('kanji 漢'), 'kanji  ');
});

test('les caractères qui casseraient une chaîne PDF sont échappés', () => {
  const text = asLatin1(
    renderDocumentPdf({
      ...SPEC,
      subjectName: 'Nom (avec) paren\\theses',
    }),
  );

  assert.ok(text.includes('(Nom \\(avec\\) paren\\\\theses)'));
  // Aucune parenthèse non échappée ne doit subsister dans une chaîne littérale.
  for (const match of text.matchAll(/\(((?:[^()\\]|\\.)*)\) Tj/g)) {
    assert.ok(!/(?<!\\)[()]/.test(match[1]!), `parenthèse non échappée : ${match[1]}`);
  }
});

test('la mesure et la découpe du texte restent cohérentes', () => {
  assert.ok(measureText('MORA', 12) > 0);
  assert.ok(measureText('MMMM', 12) > measureText('iiii', 12));
  assert.equal(measureText('', 12), 0);

  const lines = wrapText('un texte assez long pour tenir sur plusieurs lignes étroites', 10, 80);
  assert.ok(lines.length > 1);
  for (const line of lines) {
    // Un mot seul plus large que la colonne reste sur sa ligne : on ne coupe
    // pas au milieu d'un mot, c'est une facture, pas un journal.
    const words = line.split(' ');
    assert.ok(measureText(line, 10) <= 80 || words.length === 1, `ligne trop large : ${line}`);
  }

  assert.deepEqual(wrapText('   ', 10, 100), []);
});

test('un document annulé le dit sur la page', () => {
  const text = asLatin1(
    renderDocumentPdf({ ...SPEC, statusNotice: 'Document annulé — sans valeur.' }),
  );

  assert.ok(text.includes('Document annulé \u0097 sans valeur.'));
});

test('les métadonnées portent la référence officielle', () => {
  const text = asLatin1(renderDocumentPdf(SPEC));

  assert.ok(text.includes('/Title (Facture client MORA-FACL-A0001)'));
  assert.ok(text.includes('/Subject (MORA-FACL-A0001)'));
  assert.ok(text.includes('/Author (MORA Shawiri)'));
});
