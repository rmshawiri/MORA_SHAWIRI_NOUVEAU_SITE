/**
 * Pièces officielles d'affiliation — phase 4H-7 : FIAF et RVAF sur le moteur
 * partagé, rendu déterministe, multi-page, aperçu distinct de l'émission,
 * facture inchangée au bit près.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { invoiceLogo } from '../../src/lib/documents/logo';
import {
  parseSheetSnapshot,
  parseStatementSnapshot,
  renderSheetPdf,
  renderStatementPdf,
  sheetFileName,
} from '../../src/lib/domain/affiliate-pdf';
import { parseInvoiceSnapshot, renderInvoicePdf } from '../../src/lib/domain/invoice-pdf';

const SQL = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261001200000_affiliation_documents.sql'), 'utf8');
const ROUTE = readFileSync(resolve(process.cwd(), 'src/app/api/documents/[reference]/route.ts'), 'utf8');
const SERVICE = readFileSync(resolve(process.cwd(), 'src/lib/documents/affiliate-documents.ts'), 'utf8');
const OFFICIAL = readFileSync(resolve(process.cwd(), 'src/lib/domain/official-pdf.ts'), 'utf8');

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const pages = (bytes: Uint8Array) => (Buffer.from(bytes).toString('latin1').match(/\/Type \/Page /g) ?? []).length;
const issuer = { name: 'MORA Shawiri', slogan: 'Le Choix Optimal pour votre performance', address: 'Moroni — Union des Comores', phone: '+269 430 63 06', email: 'contact@morashawiri.com' };

const sheet = (over: Record<string, unknown> = {}) => ({
  schema: 1, type: 'FIAF', preview: false, reference: 'MORA-FIAF-A0001', issued_at: '2026-10-02T08:30:00Z', version: 1, issuer,
  affiliate: { reference: 'MORA-AFIL-A0001', name: 'Amina Ahmed', partyType: 'PERSONNE', status: 'ACTIF', startedOn: '2026-10-01', slug: 'amina-ahmed' },
  category: { code: 'STANDARD', label: 'Partenaire standard' },
  terms: { attributionWindowDays: 90, protectionMode: 'DUREE', protectionMonths: 6, payoutFrequency: 'FIN_DE_MOIS', acquisitionTrigger: 'PAIEMENT_INTEGRAL' },
  rules: [{ owner: 'CATEGORY', target: 'Toutes les offres éligibles', kind: 'PERCENT', rate: 10, tiers: [], validFrom: '2026-10-01T00:00:00Z', version: 1 }],
  codes: [], payout: null, ...over,
});
const statement = (lines: unknown[]) => ({
  schema: 1, type: 'RVAF', reference: 'MORA-RVAF-A0001', issued_at: '2026-10-31T10:00:00Z', issuer,
  affiliate: { reference: 'MORA-AFIL-A0001', name: 'Amina Ahmed' },
  payout: { period: 'Octobre 2026', paidOn: '2026-10-31', method: { code: 'MVOLA', label: 'Paiement via Mvola', details: { numero: '•••• 0 00' } }, transaction: 'MV-1' },
  currency: 'KMF', lines, total: (lines as { amount: number }[]).reduce((s, l) => s + l.amount, 0),
});
const commission = (i: number) => ({ type: 'COMMISSION', reference: `MORA-COMAF-A${String(i).padStart(4, '0')}`, order: 'MORA-CMCL-A0001', orderDate: '2026-10-05T10:00:00Z', base: 240000, amount: 24000 });

test('la facture garde son empreinte de référence (gabarit facl-1.2)', () => {
  // L'extraction de la mise en page commune (4H-7) a été prouvée identique au
  // bit près. L'empreinte a été relevée de nouveau après une seule correction
  // volontaire : les métadonnées non ASCII en UTF-16BE (« — » devenait « Š »),
  // avec le passage du gabarit en facl-1.2. Aucune facture n'était émise.
  const snapshot = parseInvoiceSnapshot({
    schema: 1, type: 'FACL', reference: 'MORA-FACL-A0001', issued_at: '2026-10-01T09:00:00Z', issuer,
    customer: { name: 'Client Témoin', email: 'client@exemple.km', phone: '+269 000 00 00' },
    references: { order: 'MORA-CMCL-A0001', quote: 'MORA-DVCL-A0001', request: 'MORA-DMCL-A0001' },
    currency: 'KMF',
    lines: Array.from({ length: 40 }, (_, i) => ({ designation: `Prestation ${i} — désignation longue pour tester le retour à la ligne dans la colonne principale du tableau`, reference: `R-${i}`, unit: 'forfait', quantity: 1 + i, unit_price: 15000, discount: i % 3 ? 0 : 500, total: 15000 * (1 + i) - (i % 3 ? 0 : 500) })),
    totals: { subtotal: 100000, discount: 5000, fees: 1000, total: 96000, paid: 50000, due: 46000 },
  });
  assert.ok(snapshot);
  assert.equal(sha(renderInvoicePdf(snapshot, { logo: invoiceLogo(), status: 'EMIS' })), 'f21e90cef4a3f9c7bac3b6a4d42f9d6ac356845cd12ba854acd2fec8ee060c5a');
  assert.equal(sha(renderInvoicePdf(snapshot, { logo: null, status: 'ANNULE' })), 'c403e9118e1543ba2ff38885641bcfb9d030f8e087727930485cd1879aa6f5a4');
});

test('les métadonnées non ASCII sont écrites en UTF-16BE', () => {
  const bytes = Buffer.from(renderStatementPdf(parseStatementSnapshot(statement([commission(1)]))!)).toString('latin1');
  assert.match(bytes, /\/Creator <FEFF[0-9A-F]+>/);
  assert.doesNotMatch(bytes, /\/Creator \(MORA Shawiri /);
});

test('l’espace insécable des montants est écrite en échappement', () => {
  assert.match(OFFICIAL, /const NBSP = '\\u00a0';/);
});

test('une fiche et un relevé rendus deux fois sont identiques', () => {
  const s = parseSheetSnapshot(sheet())!;
  assert.equal(sha(renderSheetPdf(s, { logo: invoiceLogo() })), sha(renderSheetPdf(s, { logo: invoiceLogo() })));
  const r = parseStatementSnapshot(statement([commission(1)]))!;
  assert.equal(sha(renderStatementPdf(r, { logo: invoiceLogo() })), sha(renderStatementPdf(r, { logo: invoiceLogo() })));
});

test('aperçu et émission ne se confondent pas', () => {
  assert.equal(parseSheetSnapshot(sheet({ reference: null })), null, 'une fiche émise a toujours son numéro');
  const preview = parseSheetSnapshot(sheet({ preview: true, reference: null }));
  assert.ok(preview?.preview);
  assert.equal(sheetFileName(preview!), 'Apercu-fiche-affilie-amina-ahmed.pdf');
  assert.equal(sheetFileName(parseSheetSnapshot(sheet())!), 'MORA-FIAF-A0001.pdf');
  // Rendus, ils diffèrent : l'aperçu porte son bandeau et n'a pas de numéro.
  assert.notEqual(sha(renderSheetPdf(preview!)), sha(renderSheetPdf(parseSheetSnapshot(sheet())!)));
});

test('un relevé sans ligne, ou une ligne inconnue, est refusé plutôt que deviné', () => {
  assert.equal(parseStatementSnapshot(statement([])), null);
  assert.equal(parseStatementSnapshot(statement([{ type: 'AUTRE', amount: 1 }])), null);
  assert.equal(parseStatementSnapshot({ ...statement([commission(1)]), reference: 'MORA-FACL-A0001' }), null);
});

test('les longues listes passent sur plusieurs pages', () => {
  const one = renderStatementPdf(parseStatementSnapshot(statement([commission(1)]))!);
  const many = renderStatementPdf(parseStatementSnapshot(statement(Array.from({ length: 60 }, (_, i) => commission(i + 1))))!);
  assert.equal(pages(one), 1);
  assert.ok(pages(many) >= 3, String(pages(many)));
  const rules = Array.from({ length: 40 }, (_, i) => ({ owner: 'AFFILIATE', target: `Offre ${i} — désignation longue d’une offre du catalogue`, kind: 'PERCENT', rate: 10, tiers: [], validFrom: '2026-10-01T00:00:00Z', version: 1 }));
  assert.ok(pages(renderSheetPdf(parseSheetSnapshot(sheet({ rules }))!)) >= 2);
});

test('la fiche s’émet par le moteur de 4D, remplace la précédente, et l’aperçu n’alloue rien', () => {
  const issue = SQL.slice(SQL.indexOf('create or replace function public.issue_affiliate_sheet'));
  assert.match(issue, /public\.issue_document\(\s*'FIAF', 'affiliate', p_affiliate_id, v_aff\.user_id, v_aff\.display_name,[\s\S]*?v_previous\)/);
  assert.match(issue, /insert into public\.document_snapshots/);
  assert.match(issue, /affiliate_is_caller\(p_affiliate_id\)/);
  const preview = SQL.slice(SQL.indexOf('create or replace function public.affiliate_sheet_preview'), SQL.indexOf('create or replace function public.issue_affiliate_sheet'));
  assert.doesNotMatch(preview, /issue_document|allocate_document_number|document_snapshots/);
  assert.match(SQL, /revoke execute on function public\.affiliate_sheet_content\(uuid\) from public, anon, authenticated;/);
});

test('les pièces passent par la route authentifiée, l’archive vérifiée, jamais un lien public', () => {
  assert.match(ROUTE, /getAffiliateDocumentPdf\(reference\)/);
  assert.match(SERVICE, /readVerifiedArchive/);
  const preview = SERVICE.slice(SERVICE.indexOf('export async function getSheetPreviewPdf'));
  assert.doesNotMatch(preview, /archiveOfficialPdf/);
  assert.doesNotMatch(SERVICE, /getPublicUrl|createSignedUrl/);
});
