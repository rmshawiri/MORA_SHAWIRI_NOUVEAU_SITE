/**
 * Rend quatre factures d'exemple pour le contrôle visuel.
 *
 *   npx tsx scripts/render-invoice-samples.ts <dossier de sortie>
 *
 * Aucune base, aucun numéro : les instantanés sont construits ici, avec la
 * série `ZZ` — une série que la suite réelle n'atteindra qu'après 6 760 000
 * factures — et un client nommé « Exemple ». Ces fichiers ne sont pas des
 * pièces officielles et ne consomment rien.
 *
 *   A — une ligne ;
 *   B — plusieurs lignes, remise, frais, règlement partiel ;
 *   C — désignations longues, réglée intégralement ;
 *   D — assez de lignes pour trois pages.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { invoiceLogo } from '../src/lib/documents/logo';
import { type InvoiceSnapshot, renderInvoicePdf } from '../src/lib/domain/invoice-pdf';

const out = resolve(process.argv[2] ?? 'invoice-samples');
mkdirSync(out, { recursive: true });

const issuer = {
  name: 'MORA Shawiri',
  slogan: 'Le Choix Optimal pour votre performance',
  address: 'Moroni Oasis, route les puffins',
  phone: '+269 430 63 06',
  email: 'contact@morashawiri.com',
};

function snapshot(reference: string, partial: Partial<InvoiceSnapshot>): InvoiceSnapshot {
  return {
    schema: 1,
    type: 'FACL',
    reference,
    issued_at: '2026-10-01T09:30:00+00:00',
    issuer,
    customer: { name: 'Société Exemple SARL', email: 'exemple@exemple.km', phone: '+269 000 00 00' },
    references: { order: 'MORA-CMCL-ZZ0001', quote: 'MORA-DVCL-ZZ0001', request: 'MORA-DMCL-ZZ0001' },
    currency: 'KMF',
    lines: [],
    totals: { subtotal: 0, discount: 0, fees: 0, total: 0, paid: 0, due: 0 },
    ...partial,
  };
}

const line = (designation: string, quantity: number, unitPrice: number, discount = 0, reference: string | null = null, unit: string | null = null) => ({
  designation,
  reference,
  unit,
  quantity,
  unit_price: unitPrice,
  discount,
  total: Math.round(unitPrice * quantity * 100) / 100 - discount,
});

function totalsOf(lines: ReturnType<typeof line>[], fees = 0, paid = 0) {
  const subtotal = lines.reduce((sum, l) => sum + Math.round(l.unit_price * l.quantity * 100) / 100, 0);
  const discount = lines.reduce((sum, l) => sum + l.discount, 0);
  const total = subtotal - discount + fees;
  return { subtotal, discount, fees, total, paid, due: Math.max(total - paid, 0) };
}

const cases: Record<string, InvoiceSnapshot> = {};

{
  const lines = [line('Création de site vitrine — formule essentielle', 1, 150000, 0, 'MORA-DVCL-ZZ0001')];
  cases['A - une ligne'] = snapshot('MORA-FACL-ZZ0001', {
    lines,
    totals: totalsOf(lines),
    references: { order: 'MORA-CMCL-ZZ0001', quote: 'MORA-DVCL-ZZ0001', request: 'MORA-DMCL-ZZ0001' },
  });
}

{
  const lines = [
    line('Identité visuelle — logo et charte', 1, 85000),
    line('Cartes de visite (impression comprise)', 200, 150, 0, null, 'unités'),
    line('Gestion des réseaux sociaux', 3, 45000, 15000, null, 'mois'),
    line('Formation prospection et relation client', 2, 25000, 0, null, 'jours'),
    line('Hébergement et nom de domaine', 1, 30000.5),
  ];
  cases['B - plusieurs lignes'] = snapshot('MORA-FACL-ZZ0002', {
    lines,
    totals: totalsOf(lines, 5000, 100000),
    references: { order: 'MORA-CMCL-ZZ0002', quote: null, request: null },
    customer: { name: 'Aïcha Saïd', email: 'aicha.said@exemple.km', phone: null },
  });
}

{
  const long =
    'Conception et réalisation complète d’une boutique en ligne « Clé en main » : arborescence, maquettes, ' +
    'intégration du catalogue (jusqu’à cinquante produits), passerelle de commande sur devis, formation de ' +
    'l’équipe à l’administration, optimisation du référencement naturel et accompagnement pendant trente jours.';
  const lines = [
    line(long, 1, 650000, 0, 'MORA-DVCL-ZZ0003'),
    line('Rédaction des contenus — pages « Qui sommes-nous », « Services », « Contact » et mentions d’usage, ' +
      'relecture orthographique et typographique comprise, dans le respect de la charte éditoriale.', 4, 12500, 0, null, 'pages'),
    line('Référence-très-longue-sans-espace-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ', 1, 1000),
  ];
  const totals = totalsOf(lines);
  cases['C - designations longues'] = snapshot('MORA-FACL-ZZ0003', {
    lines,
    totals: { ...totals, paid: totals.total, due: 0 },
    customer: {
      name: 'Coopérative des Producteurs de Vanille et d’Ylang-Ylang de Ngazidja — Section de Mitsamiouli',
      email: 'contact@cooperative-exemple.km',
      phone: '+269 000 00 01',
    },
  });
}

{
  const lines = Array.from({ length: 58 }, (_, index) =>
    line(
      index % 5 === 0
        ? `Prestation n° ${index + 1} — accompagnement numérique détaillé, suivi hebdomadaire et compte rendu écrit remis au client`
        : `Prestation n° ${index + 1}`,
      (index % 4) + 1,
      2500 * ((index % 7) + 1),
      index % 9 === 0 ? 500 : 0,
      index % 3 === 0 ? `REF-${String(index + 1).padStart(3, '0')}` : null,
    ),
  );
  cases['D - multi-pages'] = snapshot('MORA-FACL-ZZ0004', {
    lines,
    totals: totalsOf(lines, 0, 50000),
  });
}

for (const [name, data] of Object.entries(cases)) {
  const bytes = renderInvoicePdf(data, { logo: invoiceLogo() });
  const again = renderInvoicePdf(data, { logo: invoiceLogo() });
  const identical = Buffer.compare(Buffer.from(bytes), Buffer.from(again)) === 0;
  writeFileSync(resolve(out, `${name} - ${data.reference}.pdf`), bytes);
  console.log(`${name} : ${bytes.length} octets, rendu déterministe : ${identical ? 'oui' : 'NON'}`);
}

writeFileSync(
  resolve(out, 'Annulee - MORA-FACL-ZZ0001.pdf'),
  renderInvoicePdf(cases['A - une ligne']!, { logo: invoiceLogo(), status: 'ANNULE' }),
);
