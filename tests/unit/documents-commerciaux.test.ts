/**
 * Devis (DVCL), document de commande (CMCL), lignes de devis, e-mail
 * « devis disponible », « Terminée » — corrections post-4I (remarques 01).
 *
 * Contrôles statiques et rendus purs : aucune base, aucun envoi.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { invoiceLogo } from '../../src/lib/documents/logo';
import {
  orderFileName,
  parseOrderSnapshot,
  parseQuoteSnapshot,
  quoteFileName,
  renderOrderPdf,
  renderQuotePdf,
} from '../../src/lib/domain/commercial-pdf';
import { renderQuoteAvailable } from '../../src/lib/emails/quote';
import { checkLines, previewLineTotal, readLineDrafts } from '../../src/lib/relation/quote-lines';
import { site } from '../../src/lib/site';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const SQL = read('supabase/migrations/20261003120000_documents_commerciaux.sql').replace(/--[^\n]*/g, '');
const fn = (name: string) => {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  assert.ok(start !== -1, `fonction ${name} absente`);
  const end = Math.min(...['$fn$;', '$$;'].map((mark) => SQL.indexOf(mark, start)).filter((index) => index > 0));
  return SQL.slice(start, end);
};
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const pages = (bytes: Uint8Array) => (Buffer.from(bytes).toString('latin1').match(/\/Type \/Page /g) ?? []).length;

const issuer = { name: site.name, slogan: site.slogan, address: site.addressLabel, phone: site.phone, email: site.email };
const line = (designation: string, quantity: number, unit: number, discount = 0) => ({
  designation, description: null, quantity, unit_price: unit, discount, total: quantity * unit - discount,
});
const quote = (patch: Record<string, unknown> = {}) => ({
  schema: 1, type: 'DVCL', preview: false, reference: 'MORA-DVCL-A0001', issued_at: '2026-10-03T08:00:00Z', issuer,
  customer: { name: 'Client Témoin', organisation: null, email: 'client@exemple.km', phone: null },
  references: { request: 'MORA-DMCL-A0001', replaces: null },
  subject: 'Site vitrine', service: null, currency: 'KMF',
  lines: [line('Site vitrine', 1, 150000)], totals: { subtotal: 150000, discount: 0, total: 150000 },
  valid_until: null, notes: null, ...patch,
});
const order = (patch: Record<string, unknown> = {}) => ({
  schema: 1, type: 'CMCL', reference: 'MORA-CMCL-A0001', issued_at: '2026-10-03T09:00:00Z', ordered_at: '2026-10-02T09:00:00Z', issuer,
  customer: { name: 'Client Témoin', email: 'client@exemple.km', phone: null },
  references: { quote: 'MORA-DVCL-A0001', request: 'MORA-DMCL-A0001' }, status: 'CONFIRMEE', currency: 'KMF',
  lines: [{ designation: 'Site vitrine', reference: 'MORA-DVCL-A0001', unit: null, quantity: 1, unit_price: 150000, discount: 0, total: 150000 }],
  totals: { subtotal: 150000, discount: 0, fees: 0, total: 150000, paid: 0, due: 150000 }, ...patch,
});

/* ------------------------------------------------------------------ lignes */

test('les lignes d’un devis : totaux en centimes, remise bornée, décimales lues sur le texte', () => {
  const ok = checkLines([
    { designation: 'Conception', description: '', quantity: '1', unitPrice: '75 000', discount: '' },
    { designation: 'Visuels', description: 'Retouche', quantity: '30', unitPrice: '250', discount: '500' },
    { designation: 'Option', description: '', quantity: '1,5', unitPrice: '0,10', discount: '' },
  ]);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.subtotal, 82500.15);
    assert.equal(ok.discount, 500);
    assert.equal(ok.total, 82000.15);
  }
  assert.equal(previewLineTotal({ designation: 'x', description: '', quantity: '1.005', unitPrice: '100', discount: '' }), 100.5);

  const refuse = (patch: Record<string, string>) =>
    checkLines([{ designation: 'Ligne', description: '', quantity: '1', unitPrice: '100', discount: '', ...patch }]);
  assert.equal(refuse({ designation: '  ' }).ok, false);
  assert.equal(refuse({ quantity: '0' }).ok, false);
  assert.equal(refuse({ quantity: '1,0001' }).ok, false);
  assert.equal(refuse({ unitPrice: '-5' }).ok, false);
  assert.equal(refuse({ unitPrice: '10,001' }).ok, false);
  assert.equal(refuse({ discount: '101' }).ok, false, 'remise supérieure à la ligne');
  assert.equal(refuse({ unitPrice: '0' }).ok, false, 'total nul');
  assert.equal(checkLines([]).ok, false);
  assert.equal(checkLines(Array.from({ length: 51 }, () => ({ designation: 'L', description: '', quantity: '1', unitPrice: '1', discount: '' }))).ok, false);
  assert.equal(readLineDrafts('pas du json'), null);
  assert.equal(readLineDrafts('{"designation":"x"}'), null);
});

test('le total d’un devis est recalculé par la base, jamais reçu du navigateur', () => {
  const save = fn('save_quote_draft');
  assert.match(save, /select coalesce\(sum\(line_total\), 0\) into v_total from public\.quote_items/);
  assert.match(save, /set amount\s+= v_total/);
  assert.doesNotMatch(save, /p_amount|p_total/);
  assert.match(SQL, /line_total\s+numeric\(12, 2\) generated always as \(round\(quantity \* unit_price, 2\) - discount_amount\) stored/);
  // Aucune écriture directe des lignes par une session.
  assert.match(SQL, /revoke all on public\.quote_items from anon, authenticated;\s*grant select on public\.quote_items to authenticated;/);
  assert.match(fn('send_quote'), /Le total du devis ne correspond plus à ses lignes/);
});

test('un devis émis est figé, ses lignes aussi', () => {
  const frozen = fn('tg_quotes_content_frozen');
  for (const column of ['amount', 'summary', 'notes', 'valid_until', 'currency']) {
    assert.match(frozen, new RegExp(`new\\.${column}\\s+is distinct from old\\.${column}`));
  }
  assert.match(fn('tg_quote_items_draft_only'), /v_status <> 'BROUILLON'/);
});

/* ---------------------------------------------------------------- émission */

test('l’émission du devis : moteur 4D, instantané dans la transaction, remplacement, audit', () => {
  const send = fn('send_quote');
  assert.match(send, /public\.issue_document\(\s*'DVCL',[\s\S]*?v_old_doc\s*\)/);
  assert.match(send, /insert into public\.document_snapshots[\s\S]*?'DVCL', 1,[\s\S]*?quote_document_content\(p_quote_id, v_document\.reference, v_document\.issued_at, false\)/);
  assert.match(send, /update public\.quotes set status = 'ANNULE' where id = v_replaced\.id/);
  assert.match(send, /record_audit_event\(\s*'relation\.devis\.emission'/);
  assert.match(send, /has_permission\('quotes\.manage'\)/);
  // L'aperçu n'alloue rien, n'écrit rien.
  const preview = fn('quote_preview');
  assert.doesNotMatch(preview, /issue_document|allocate_document_number|insert into/);
  assert.match(preview, /quote_document_content\(p_quote_id, null, now\(\), true\)/);
  assert.match(SQL, /revoke execute on function public\.quote_document_content\(uuid, text, timestamptz, boolean\) from public, anon, authenticated;/);
});

test('le document de commande réutilise la pièce CMCL : aucun numéro consommé', () => {
  const issue = fn('issue_order_document');
  assert.doesNotMatch(issue, /issue_document\(|allocate_document_number/);
  assert.match(issue, /select \* into v_document from public\.documents where id = v_order\.document_id/);
  assert.match(issue, /v_order\.status in \('NOUVELLE', 'ANNULEE'\)/);
  assert.match(issue, /record_audit_event\(\s*'commerce\.commande\.document'/);
  assert.match(issue, /where t\.code = 'CMCL'/);
  // Pas de nouveau type documentaire dans ce lot.
  assert.doesNotMatch(SQL, /insert into public\.document_types/);
});

test('la commande issue d’un devis reprend ses lignes, et rejouer ne consomme rien', () => {
  const place = fn('place_order_from_quote');
  const idempotence = place.indexOf('select * into v_existing from public.orders where quote_id = p_quote_id');
  assert.ok(idempotence > 0 && idempotence < place.indexOf("public.issue_document("));
  assert.match(place, /from public\.quote_items i\s+where i\.quote_id = v_quote\.id/);
});

/* --------------------------------------------------------------- terminée */

test('« Terminée » : la demande suit le devis accepté et la commande terminée', () => {
  assert.match(fn('tg_quotes_request_follows'), /set status = 'ACCEPTEE'[\s\S]*?status = 'DEVIS_ENVOYE'/);
  const orders = fn('tg_orders_request_follows');
  assert.match(orders, /new\.status <> 'TERMINEE'/);
  assert.match(orders, /set status = 'TERMINEE'/);
  assert.match(fn('tg_quote_requests_termination_guard'), /o\.status not in \('TERMINEE', 'ANNULEE'\)/);
});

/* -------------------------------------------------------------------- PDF */

test('un devis et un bon de commande rendus deux fois sont identiques', () => {
  const q = parseQuoteSnapshot(quote())!;
  assert.equal(sha(renderQuotePdf(q, { logo: invoiceLogo() })), sha(renderQuotePdf(q, { logo: invoiceLogo() })));
  const o = parseOrderSnapshot(order())!;
  assert.equal(sha(renderOrderPdf(o, { logo: invoiceLogo() })), sha(renderOrderPdf(o, { logo: invoiceLogo() })));
});

test('aperçu et émission ne se confondent pas', () => {
  assert.equal(parseQuoteSnapshot(quote({ reference: null })), null, 'un devis émis a toujours son numéro');
  const preview = parseQuoteSnapshot(quote({ preview: true, reference: 'MORA-DVCL-A0009' }));
  assert.ok(preview?.preview);
  assert.equal(preview!.reference, null, 'un aperçu ne porte jamais de numéro');
  assert.equal(quoteFileName(preview!), 'Apercu-devis-MORA-Shawiri.pdf');
  assert.equal(quoteFileName(parseQuoteSnapshot(quote())!), 'MORA-DVCL-A0001.pdf');
  assert.equal(orderFileName('MORA-CMCL-A0001'), 'MORA-CMCL-A0001.pdf');
  assert.notEqual(sha(renderQuotePdf(preview!)), sha(renderQuotePdf(parseQuoteSnapshot(quote())!)));
});

test('un instantané illisible est refusé plutôt que deviné', () => {
  assert.equal(parseQuoteSnapshot(quote({ lines: [] })), null);
  assert.equal(parseQuoteSnapshot(quote({ reference: 'MORA-FACL-A0001' })), null);
  assert.equal(parseQuoteSnapshot(quote({ subject: '' })), null);
  assert.equal(parseOrderSnapshot(order({ reference: 'MORA-DVCL-A0001' })), null);
  assert.equal(parseOrderSnapshot(order({ lines: [{ designation: 'x' }] })), null);
});

test('un long devis passe sur plusieurs pages', () => {
  const lines = Array.from({ length: 40 }, (_, i) => line(`Prestation ${i} — désignation longue pour tester le retour à la ligne`, 1 + i, 1000));
  const total = lines.reduce((sum, row) => sum + row.total, 0);
  const many = renderQuotePdf(parseQuoteSnapshot(quote({ lines, totals: { subtotal: total, discount: 0, total } }))!);
  assert.equal(pages(renderQuotePdf(parseQuoteSnapshot(quote())!)), 1);
  assert.ok(pages(many) >= 3, String(pages(many)));
});

/* ------------------------------------------------------------- e-mail */

test('l’e-mail de devis : référence, CTA vers l’espace client, aucun lien vers le PDF', () => {
  const email = renderQuoteAvailable({
    name: 'Client Témoin', reference: 'MORA-DVCL-A0001', subject: 'Site vitrine '.repeat(30), total: '150 000 KMF',
    validUntil: null, replaces: null, hasAccount: true, siteUrl: 'https://exemple.org',
  });
  assert.match(email.subject, /MORA-DVCL-A0001/);
  assert.ok(email.rendered.html.includes('https://exemple.org/espace-client/devis/MORA-DVCL-A0001/'));
  assert.ok(email.rendered.text.includes('https://exemple.org/espace-client/devis/MORA-DVCL-A0001/'));
  for (const body of [email.rendered.html, email.rendered.text]) {
    assert.doesNotMatch(body, /\/api\/documents|\/api\/devis|\.pdf|storage\/v1|token=/i);
  }
  assert.ok(email.rendered.html.includes(site.addressLabel), 'adresse officielle en signature');
  const guest = renderQuoteAvailable({
    name: 'Prospect', reference: 'MORA-DVCL-A0002', subject: 'Logo', total: '15 000 KMF',
    validUntil: 'samedi 31 octobre 2026', replaces: 'MORA-DVCL-A0001', hasAccount: false, siteUrl: 'https://exemple.org',
  });
  assert.ok(guest.rendered.html.includes('https://exemple.org/inscription/'));
  assert.match(guest.rendered.text, /remplace le devis MORA-DVCL-A0001/i);
});

test('l’e-mail part après l’émission, depuis l’instantané, journalisé et renvoyable', () => {
  const actions = read('src/lib/relation/actions.ts');
  const send = actions.slice(actions.indexOf('export async function sendQuote'), actions.indexOf('async function notifyQuoteIssued'));
  assert.ok(send.indexOf("rpc('send_quote'") < send.indexOf('notifyQuoteIssued('), 'base d’abord, e-mail ensuite');
  const notify = actions.slice(actions.indexOf('async function notifyQuoteIssued'), actions.indexOf('export async function retryQuoteEmail'));
  assert.match(notify, /parseQuoteSnapshot\(snapshotRow\.content\)/);
  assert.match(notify, /sendLoggedEmail\(/);
  assert.match(notify, /entityType: 'quote'/);
  assert.match(actions, /retryLoggedEmail\(id\)/);
  // Aucun autre changement de statut ne déclenche d'e-mail.
  const respond = actions.slice(actions.indexOf('export async function respondToQuote'), actions.indexOf('export async function confirmAppointment'));
  assert.doesNotMatch(respond, /sendLoggedEmail|renderQuoteAvailable/);
  assert.match(SQL, /p_entity_type = 'quote' and public\.has_permission\('quotes\.view'\)/);
});

/* ----------------------------------------------------- accès client */

test('Mes documents : titulaire seulement, route authentifiée, jamais un lien public', () => {
  const page = read('src/app/(site)/(compte)/espace-client/(espace)/documents/page.tsx');
  assert.match(page, /ownerOnly/);
  const lib = read('src/lib/client/commerce.ts');
  const docs = lib.slice(lib.indexOf('export async function myOfficialDocuments'));
  assert.match(docs, /\.eq\('owner_id', space\.context\.userId\)/);
  assert.match(docs, /\.in\('doc_type', \['DVCL', 'CMCL', 'FACL'\]\)/);
  const route = read('src/app/api/documents/[reference]/route.ts');
  assert.match(route, /getCommercialDocumentPdf\(reference\)/);
  const service = read('src/lib/documents/commercial-documents.ts');
  assert.match(service, /readVerifiedArchive/);
  assert.doesNotMatch(service, /getPublicUrl|createSignedUrl/);
  const preview = service.slice(service.indexOf('export async function getQuotePreviewPdf'));
  assert.doesNotMatch(preview.slice(0, preview.indexOf('\n}\n')), /archiveOfficialPdf/);
});
