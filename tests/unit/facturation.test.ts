/**
 * Finalisation 4G — facture officielle : permission, instantané, PDF.
 *
 * Trois familles de contrôles, à froid :
 *
 *   1. la migration dit bien ce que la décision propriétaire demande —
 *      `invoices.issue` critique, distincte d'`orders.update`, idempotence
 *      sous verrou, instantané immuable, bucket privé ;
 *   2. le PDF est un vrai PDF, multi-pages quand il le faut, déterministe, et
 *      il porte exactement les données de l'instantané — rien d'autre ;
 *   3. le rendu ne dépend que de l'instantané : ni catalogue, ni base.
 *
 * Ce qui demande une vraie base (sessions, AAL2, concurrence, suites
 * documentaires) est éprouvé par `scripts/verify-facturation.mjs`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { invoiceLogo } from '../../src/lib/documents/logo';
import {
  INVOICE_RENDERER_VERSION,
  formatInvoiceAmount,
  formatInvoiceDate,
  formatInvoiceQuantity,
  invoiceFileName,
  parseInvoiceSnapshot,
  renderInvoicePdf,
  type InvoiceSnapshot,
} from '../../src/lib/domain/invoice-pdf';
import { BRAND_COLORS, textWidth, wrapLines } from '../../src/lib/domain/pdf-engine';
import {
  ADMIN_TEMPLATE_PERMISSIONS,
  CRITICAL_PERMISSIONS,
  PERMISSIONS,
  grants,
} from '../../src/lib/rbac/catalogue';
import { site } from '../../src/lib/site';

const ROOT = process.cwd();
const SQL = readFileSync(
  resolve(ROOT, 'supabase', 'migrations', '20261001120000_facturation_officielle.sql'),
  'utf8',
);
const CODE = SQL.replace(/--[^\n]*/g, '');

function functionBody(name: string): string {
  const start = CODE.indexOf(`create or replace function public.${name}(`);
  assert.ok(start !== -1, `fonction ${name} absente`);
  return CODE.slice(start, CODE.indexOf('$fn$;', start));
}

/* ------------------------------------------------------------------------- */
/* Données                                                                    */
/* ------------------------------------------------------------------------- */

const NB = ' ';

function sample(lines = 1, overrides: Partial<InvoiceSnapshot> = {}): InvoiceSnapshot {
  const items = Array.from({ length: lines }, (_, index) => ({
    designation: index === 0 ? 'Création de site vitrine — formule « Essentielle »' : `Prestation n° ${index + 1}`,
    reference: index === 0 ? 'MORA-DVCL-A0001' : null,
    unit: null,
    quantity: index === 0 ? 1 : 2,
    unit_price: index === 0 ? 15000 : 2500,
    discount: 0,
    total: index === 0 ? 15000 : 5000,
  }));
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);

  return {
    schema: 1,
    type: 'FACL',
    reference: 'MORA-FACL-A0001',
    issued_at: '2026-10-01T09:30:00+00:00',
    issuer: {
      name: site.name,
      slogan: site.slogan,
      address: site.addressLabel,
      phone: site.phone,
      email: site.email,
    },
    customer: { name: 'Aïcha Saïd', email: 'aicha@exemple.km', phone: '+269 000 00 00' },
    references: { order: 'MORA-CMCL-A0001', quote: 'MORA-DVCL-A0001', request: 'MORA-DMCL-A0001' },
    currency: 'KMF',
    lines: items,
    totals: { subtotal, discount: 0, fees: 0, total: subtotal, paid: 0, due: subtotal },
    ...overrides,
  };
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

const WIN_ANSI_BACK: Record<number, string> = {
  0x92: '’', 0x96: '–', 0x97: '—', 0xa0: ' ', 0x85: '…', 0x9c: 'œ', 0x8c: 'Œ',
};

/** Texte visible d'une page, dans l'ordre d'écriture. */
function pageTexts(bytes: Uint8Array): string[] {
  const file = latin1(bytes);
  const streams = [...file.matchAll(/stream\n([\s\S]*?)\nendstream/g)]
    .map((match) => match[1]!)
    .filter((stream) => stream.includes(' Tj ET'));

  return streams.map((stream) =>
    [...stream.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
      .map((match) =>
        [...match[1]!.replace(/\\([\\()])/g, '$1')]
          .map((character) => WIN_ANSI_BACK[character.charCodeAt(0)] ?? character)
          .join(''),
      )
      .join('\n'),
  );
}

/* ------------------------------------------------------------------------- */
/* 1. Permission                                                              */
/* ------------------------------------------------------------------------- */

test('invoices.issue est au catalogue, critique, et hors du modèle ADMIN', () => {
  assert.ok(PERMISSIONS.includes('invoices.issue'));
  assert.ok((CRITICAL_PERMISSIONS as readonly string[]).includes('invoices.issue'));
  assert.ok(!(ADMIN_TEMPLATE_PERMISSIONS as readonly string[]).includes('invoices.issue'));
  assert.match(SQL, /\('invoices\.issue',\s*'invoices',\s*'issue',\s*'[^']+',\s*true\)/);
});

test('orders.update seul ne permet pas d’émettre ; admin.full_access le permet', () => {
  assert.equal(grants(['orders.view', 'orders.update', 'orders.cancel'], 'invoices.issue'), false);
  assert.equal(grants(['payments.verify'], 'invoices.issue'), false);
  assert.equal(grants(['invoices.issue'], 'invoices.issue'), true);
  assert.equal(grants(['admin.full_access'], 'invoices.issue'), true);
  assert.equal(grants([], 'invoices.issue'), false);
});

test('la migration n’accorde invoices.issue à aucun rôle', () => {
  assert.ok(!/insert into public\.role_permissions/i.test(CODE));
  assert.ok(!/insert into public\.user_permissions/i.test(CODE));
});

test('FACL s’émet désormais sous invoices.issue', () => {
  assert.match(
    CODE,
    /update public\.document_types\s+set issue_permission = 'invoices\.issue',[\s\S]*?where code = 'FACL';/,
  );
});

test('issue_order_invoice exige invoices.issue, et non plus orders.update', () => {
  const body = functionBody('issue_order_invoice');
  assert.match(body, /has_permission\('invoices\.issue'\)/);
  assert.ok(!/orders\.update/.test(body), 'orders.update ne doit plus suffire');
  assert.match(body, /errcode = '42501'/);
});

test('l’action serveur vérifie invoices.issue, et la fiche ne propose le bouton qu’avec elle', () => {
  const actions = readFileSync(resolve(ROOT, 'src', 'lib', 'commerce', 'actions.ts'), 'utf8');
  const issue = actions.slice(actions.indexOf('export async function issueInvoice'));
  assert.match(issue.slice(0, 600), /assertPermission\('invoices\.issue'/);

  const page = readFileSync(
    resolve(ROOT, 'src', 'app', '(pilotage)', 'administration', 'commandes', '[reference]', 'page.tsx'),
    'utf8',
  );
  assert.match(page, /context\.can\('invoices\.issue'\)/);
});

/* ------------------------------------------------------------------------- */
/* 2. Émission : numéro, idempotence, instantané                              */
/* ------------------------------------------------------------------------- */

test('la commande est verrouillée avant de chercher une facture existante', () => {
  const body = functionBody('issue_order_invoice');
  const lock = body.search(/from public\.orders where id = p_order_id for update/);
  const lookup = body.indexOf("where doc_type = 'FACL'");
  const allocate = body.indexOf('public.issue_document(');
  assert.ok(lock !== -1, 'verrou absent');
  assert.ok(lock < lookup && lookup < allocate, 'verrou → recherche → allocation');
});

test('le numéro vient du Moteur de Documents, et de lui seul', () => {
  const body = functionBody('issue_order_invoice');
  assert.match(body, /public\.issue_document\(\s*'FACL'/);
  assert.ok(!/allocate_document_number/.test(body));
  assert.ok(!/max\(\s*number/i.test(CODE));
  assert.ok(!/create or replace function public\.(issue_document|allocate_document_number)/.test(CODE));
});

test('une seule facture active par commande, garantie par index', () => {
  assert.match(
    CODE,
    /create unique index if not exists documents_one_active_invoice_per_order\s+on public\.documents \(entity_id\)\s+where doc_type = 'FACL' and status = 'EMIS'/,
  );
});

test('l’instantané est écrit dans la même fonction que le numéro, depuis les lignes de commande', () => {
  const body = functionBody('issue_order_invoice');
  assert.match(body, /insert into public\.document_snapshots/);
  assert.match(body, /from public\.order_items oi/);
  // Jamais le tarif courant du catalogue.
  assert.ok(!/price_amount/.test(body), 'le catalogue ne doit pas être relu');
  assert.ok(!/public\.services/.test(body));
  assert.ok(!/public\.products/.test(body));
  assert.match(body, /'issuer',\s+public\.document_issuer_identity\(\)/);
});

test('aucune taxe ni mention légale n’est inventée', () => {
  for (const word of ['tva', 'tax', 'siret', 'rcs', 'nif', 'penalit', 'escompte']) {
    assert.ok(!new RegExp(word, 'i').test(CODE), `${word} n’existe pas dans le modèle`);
  }
});

test('l’instantané est immuable, et son empreinte calculée par la base', () => {
  assert.match(CODE, /create trigger document_snapshots_immutable\s+before update/);
  assert.match(CODE, /create trigger document_snapshots_hash\s+before insert/);
  assert.match(CODE, /create trigger document_snapshots_no_delete\s+before delete/);
  assert.match(functionBody('tg_document_snapshots_hash'), /sha256\(convert_to\(new\.content::text/);
});

test('l’identité de l’émetteur en base est celle du site', () => {
  // La définition en vigueur est la dernière : l'adresse officielle a changé
  // le 2026-10-03 (remarques 01). Les instantanés déjà émis gardent la leur.
  const marker = 'create or replace function public.document_issuer_identity(';
  const current = readdirSync(resolve(ROOT, 'supabase', 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(resolve(ROOT, 'supabase', 'migrations', name), 'utf8').replace(/--[^\n]*/g, ''))
    .filter((sql) => sql.includes(marker))
    .pop()!;
  const start = current.indexOf(marker);
  const body = current.slice(start, current.indexOf('$fn$;', start));
  for (const value of [site.name, site.slogan, site.addressLabel, site.phone, site.email]) {
    assert.ok(body.includes(`'${value}'`), `${value} absent de document_issuer_identity()`);
  }
});

/* ------------------------------------------------------------------------- */
/* 3. Stockage et accès                                                       */
/* ------------------------------------------------------------------------- */

test('le bucket des pièces officielles est privé, PDF seulement, sans écriture de session', () => {
  assert.match(CODE, /'documents-officiels', 'documents-officiels', false, 10485760, array\['application\/pdf'\]/);
  assert.match(CODE, /set public\s+= false/);
  assert.ok(!/on storage\.objects for (insert|update|delete)/.test(CODE));
});

test('la lecture d’une archive suit exactement la lecture de la pièce', () => {
  const policy = CODE.slice(CODE.indexOf('create policy documents_officiels_read'));
  assert.match(policy, /d\.owner_id = auth\.uid\(\)/);
  assert.match(policy, /public\.can_read_document_type\(d\.doc_type\)/);
});

test('l’archive ne s’enregistre que par le serveur', () => {
  assert.match(
    CODE,
    /revoke execute on function public\.record_document_archive\(uuid, text, text, integer, text\) from public, anon, authenticated;/,
  );
  assert.match(
    CODE,
    /grant\s+execute on function public\.record_document_archive\(uuid, text, text, integer, text\) to service_role;/,
  );
});

test('l’instantané n’est lisible que de qui lit la pièce, et ne s’écrit pas depuis une session', () => {
  assert.match(CODE, /revoke all on public\.document_snapshots from anon, authenticated;/);
  assert.match(CODE, /grant select on public\.document_snapshots to authenticated;/);
  assert.ok(!/grant[^;]*(insert|update|delete)[^;]*document_snapshots/i.test(CODE));
  assert.ok(!/on public\.document_snapshots for (insert|update|delete)/.test(CODE));
});

/* ------------------------------------------------------------------------- */
/* 4. Le PDF                                                                  */
/* ------------------------------------------------------------------------- */

test('le fichier est un vrai PDF, complet, à la table xref exacte', () => {
  const bytes = renderInvoicePdf(sample(3), { logo: invoiceLogo() });
  const file = latin1(bytes);

  assert.ok(file.startsWith('%PDF-1.4\n'));
  assert.ok(file.endsWith('%%EOF\n'));

  const xrefAt = Number(/startxref\n(\d+)\n%%EOF/.exec(file)![1]);
  const table = file.slice(xrefAt).split('\n');
  const count = Number(table[1]!.split(' ')[1]);
  for (let id = 1; id < count; id += 1) {
    const offset = Number(table[2 + id]!.slice(0, 10));
    assert.ok(file.startsWith(`${id} 0 obj\n`, offset), `objet ${id} mal référencé`);
  }

  for (const match of file.matchAll(/<< \/Length (\d+)[^>]*>>\nstream\n/g)) {
    const start = match.index! + match[0].length;
    assert.equal(file.slice(start + Number(match[1]), start + Number(match[1]) + 10), '\nendstream');
  }
});

test('le nom de fichier est la référence officielle, et elle seule', () => {
  assert.equal(invoiceFileName('MORA-FACL-A0001'), 'MORA-FACL-A0001.pdf');
});

test('le PDF porte le numéro, le client, la commande, les lignes et les totaux de l’instantané', () => {
  const snapshot = sample(2, {
    totals: { subtotal: 20000, discount: 0, fees: 0, total: 20000, paid: 5000, due: 15000 },
  });
  const [text] = pageTexts(renderInvoicePdf(snapshot, { logo: invoiceLogo() }));

  for (const expected of [
    'FACTURE',
    'N° MORA-FACL-A0001',
    'Date d’émission : 1er octobre 2026',
    'Aïcha Saïd',
    'aicha@exemple.km',
    'Commande : MORA-CMCL-A0001',
    'Devis : MORA-DVCL-A0001',
    'Création de site vitrine — formule « Essentielle »',
    'Prestation n° 2',
    'Réf. MORA-DVCL-A0001',
    'Désignation',
    'Qté',
    'Prix unitaire',
    'Montant',
    '15 000 KMF',
    '2 500 KMF',
    '20 000 KMF',
    'TOTAL',
    'Réglé à la date d’émission',
    '5 000 KMF',
    'Reste à payer',
    'Le Choix Optimal pour votre performance',
    '+269 430 63 06',
    'contact@morashawiri.com',
    'MORA-FACL-A0001 — page 1 / 1',
  ]) {
    assert.ok(text!.includes(expected), `absent du PDF : ${expected}`);
  }
});

test('les caractères français traversent l’encodage', () => {
  const file = latin1(renderInvoicePdf(sample(), { logo: invoiceLogo() }));
  assert.ok(file.includes('Aïcha Saïd'), 'tréma');
  assert.ok(file.includes('Création'), 'accent aigu');
  assert.ok(file.includes('« Essentielle »'), 'guillemets et insécables');
  assert.ok(file.includes('\u0097'), 'tiret cadratin');
  assert.ok(file.includes('\u0092'), 'apostrophe typographique');
});

test('les montants sont en KMF, à la française, sans décimale inutile', () => {
  assert.equal(formatInvoiceAmount(15000, 'KMF'), `15${NB}000${NB}KMF`);
  assert.equal(formatInvoiceAmount(1250.5, 'KMF'), `1${NB}250,50${NB}KMF`);
  assert.equal(formatInvoiceAmount(0, 'KMF'), `0${NB}KMF`);
  assert.equal(formatInvoiceAmount(1234567, 'KMF'), `1${NB}234${NB}567${NB}KMF`);
  assert.equal(formatInvoiceQuantity(2.5), '2,5');
  assert.equal(formatInvoiceQuantity(1), '1');
});

test('la date est celle de Moroni, sans dépendre d’Intl', () => {
  assert.equal(formatInvoiceDate('2026-09-30T22:30:00Z'), '1er octobre 2026');
  assert.equal(formatInvoiceDate('2026-12-31T20:59:59Z'), '31 décembre 2026');
});

test('une facture longue passe sur plusieurs pages, en-tête du tableau répété', () => {
  const bytes = renderInvoicePdf(sample(70), { logo: invoiceLogo() });
  const pages = pageTexts(bytes);
  assert.ok(pages.length >= 3, `${pages.length} page(s)`);

  pages.forEach((text, index) => {
    assert.ok(text.includes('Désignation'), `en-tête de tableau absent page ${index + 1}`);
    assert.ok(text.includes(`page ${index + 1} / ${pages.length}`), `numérotation page ${index + 1}`);
    assert.ok(text.includes('MORA-FACL-A0001'), `référence absente page ${index + 1}`);
  });

  // Chaque ligne apparaît exactement une fois : rien n'est perdu ni doublé au saut de page.
  const all = pages.join('\n');
  for (let index = 2; index <= 70; index += 1) {
    const occurrences = all.split(`Prestation n° ${index}\n`).length - 1;
    assert.equal(occurrences, 1, `ligne ${index} présente ${occurrences} fois`);
  }
  assert.ok(pages.at(-1)!.includes('TOTAL'));
});

test('une désignation longue est découpée dans sa colonne, sans débordement', () => {
  const long = 'Conception complète '.repeat(30) + 'Référence-sans-espace-'.repeat(8);
  const width = 220;
  for (const line of wrapLines(long, 9.2, width)) {
    assert.ok(textWidth(line, 9.2) <= width + 0.01, `ligne trop large : ${line}`);
  }

  const bytes = renderInvoicePdf(sample(1, { lines: [{ ...sample().lines[0]!, designation: long }] }));
  assert.ok(pageTexts(bytes).join('').includes('Référence-sans-espace'));
});

test('le rendu est déterministe : deux rendus, mêmes octets', () => {
  const snapshot = sample(25);
  const a = renderInvoicePdf(snapshot, { logo: invoiceLogo() });
  const b = renderInvoicePdf(structuredClone(snapshot), { logo: invoiceLogo() });
  assert.deepEqual(a, b);
  assert.ok(INVOICE_RENDERER_VERSION.length > 0);
  assert.ok(latin1(a).includes("/CreationDate (D:20261001123000+03'00')"), 'date de la pièce, pas du rendu');
});

test('seules les couleurs officielles sont employées', () => {
  const palette = Object.values(BRAND_COLORS).map((c) => c.map((v) => v.toFixed(4)).join(' '));
  const file = latin1(renderInvoicePdf(sample(4), { logo: invoiceLogo() }));
  for (const match of file.matchAll(/([\d.]+ [\d.]+ [\d.]+) (rg|RG)/g)) {
    assert.ok(palette.includes(match[1]!), `couleur hors palette : ${match[1]}`);
  }
});

test('aucune donnée technique ni secrète dans le fichier', () => {
  const file = latin1(renderInvoicePdf(sample(3), { logo: invoiceLogo() }));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(file), 'UUID');
  for (const word of ['supabase', 'service_role', 'sb_secret', 'sb_publishable', 'eyJ', 'storage', 'localhost']) {
    assert.ok(!file.toLowerCase().includes(word.toLowerCase()), word);
  }
});

test('une facture annulée le dit et n’invite à aucun règlement', () => {
  const [text] = pageTexts(renderInvoicePdf(sample(), { status: 'ANNULE' }));
  assert.ok(text!.includes('Facture annulée'));
  assert.ok(!text!.includes('RÈGLEMENT'));
});

/* ------------------------------------------------------------------------- */
/* 5. L'instantané, et lui seul                                               */
/* ------------------------------------------------------------------------- */

test('un instantané illisible est refusé plutôt que complété', () => {
  assert.equal(parseInvoiceSnapshot(null), null);
  assert.equal(parseInvoiceSnapshot({ ...sample(), schema: 2 }), null);
  assert.equal(parseInvoiceSnapshot({ ...sample(), reference: 'MORA-CMCL-A0001' }), null);
  assert.equal(parseInvoiceSnapshot({ ...sample(), lines: [] }), null);
  assert.equal(parseInvoiceSnapshot({ ...sample(), totals: { total: 1 } }), null);
});

test('les montants numeric de PostgREST, nombre ou chaîne, sont acceptés', () => {
  const raw = JSON.parse(JSON.stringify(sample()));
  raw.lines[0].unit_price = '15000.00';
  raw.totals.total = '15000.00';
  const parsed = parseInvoiceSnapshot(raw);
  assert.ok(parsed);
  assert.equal(parsed!.lines[0]!.unit_price, 15000);
  assert.equal(parsed!.totals.total, 15000);
});

test('le prix d’une facture émise ne suit pas le catalogue', () => {
  // L'instantané figé à 15 000 KMF. Le « catalogue » passe à 20 000 KMF :
  // le gabarit ne le voit pas, il n'en a aucun moyen.
  const frozen = sample();
  const catalogue = { price_amount: 20000 };
  const text = pageTexts(renderInvoicePdf(frozen)).join('\n');
  assert.ok(text.includes('15 000 KMF'));
  assert.ok(!text.includes('20 000 KMF'));
  assert.equal(catalogue.price_amount, 20000);

  const template = readFileSync(resolve(ROOT, 'src', 'lib', 'domain', 'invoice-pdf.ts'), 'utf8');
  assert.ok(!/from ['"]@\/lib\/(supabase|catalogue|commerce)/.test(template), 'le gabarit ne lit aucune donnée courante');
  assert.ok(!/price_amount/.test(template));
});

/* ------------------------------------------------------------------------- */
/* 6. Le logo circulaire officiel                                             */
/* ------------------------------------------------------------------------- */

test('le PDF embarque le logo circulaire officiel, à pleine résolution', async () => {
  const { LOGO_ASSET } = await import('../../src/lib/documents/logo-asset');
  const script = readFileSync(resolve(ROOT, 'scripts', 'build-pdf-logo.mjs'), 'utf8');
  assert.match(script, /'public', 'logo-circle\.png'/);
  assert.ok(!/logo-rect\.png'\)/.test(script), 'le logo horizontal n’est plus la source');
  assert.equal(LOGO_ASSET.width, 512);
  assert.equal(LOGO_ASSET.height, 512, 'logo carré : aucune déformation possible');
});

test('le logo est posé sans étirement : largeur = hauteur pour un logo carré', () => {
  const file = latin1(renderInvoicePdf(sample(), { logo: invoiceLogo() }));
  const placement = /q ([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm \/Logo Do Q/.exec(file);
  assert.ok(placement, 'logo absent');
  assert.equal(placement![1], placement![2]);
  assert.ok(Number(placement![1]) >= 60 && Number(placement![1]) <= 80, `taille ${placement![1]} pt`);
});
