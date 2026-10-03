/**
 * Rend des devis et des documents de commande d'exemple pour le contrôle
 * visuel.
 *
 *   npx tsx scripts/render-commercial-samples.ts <dossier de sortie>
 *
 * Aucune base, aucun numéro : les instantanés sont construits ici, avec la
 * série `ZZ`, et un client nommé « Exemple ». Ces fichiers ne sont pas des
 * pièces officielles et ne consomment rien.
 *
 *   DVCL-A — une ligne, sans validité ;
 *   DVCL-B — plusieurs lignes, remises, validité, observations, remplacement ;
 *   DVCL-C — assez de lignes longues pour plusieurs pages ;
 *   DVCL-D — aperçu d'un brouillon ;
 *   DVCL-E — devis remplacé (bandeau) ;
 *   CMCL-A — commande confirmée, non réglée ;
 *   CMCL-B — commande terminée, réglée, frais et remise.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { invoiceLogo } from '../src/lib/documents/logo';
import {
  type OrderSnapshot,
  type QuoteSnapshot,
  renderOrderPdf,
  renderQuotePdf,
} from '../src/lib/domain/commercial-pdf';
import { site } from '../src/lib/site';

const out = resolve(process.argv[2] ?? 'commercial-samples');
mkdirSync(out, { recursive: true });

const issuer = {
  name: site.name,
  slogan: site.slogan,
  address: site.addressLabel,
  phone: site.phone,
  email: site.email,
};

const line = (designation: string, quantity: number, unit: number, discount = 0, detail: string | null = null) => ({
  designation,
  detail,
  unit: null,
  quantity,
  unit_price: unit,
  discount,
  total: Math.round(quantity * unit * 100) / 100 - discount,
});

function quote(partial: Partial<QuoteSnapshot>): QuoteSnapshot {
  const lines = partial.lines ?? [line('Création de site vitrine', 1, 150000)];
  const subtotal = lines.reduce((sum, row) => sum + row.quantity * row.unit_price, 0);
  const discount = lines.reduce((sum, row) => sum + row.discount, 0);
  return {
    type: 'DVCL',
    preview: false,
    reference: 'MORA-DVCL-ZZ0001',
    issued_at: '2026-10-03T08:30:00+00:00',
    issuer,
    customer: { name: 'Exemple Client', organisation: null, email: 'client@mora-shawiri.test', phone: '+269 000 00 00' },
    references: { request: 'MORA-DMCL-ZZ0001', replaces: null },
    subject: 'Site vitrine de présentation de l’activité, cinq pages.',
    service: 'Création de site e-commerce',
    currency: 'KMF',
    lines,
    totals: { subtotal, discount, total: subtotal - discount },
    valid_until: null,
    notes: null,
    ...partial,
  };
}

const samples: [string, Uint8Array][] = [
  ['DVCL-A-une-ligne.pdf', renderQuotePdf(quote({}), { logo: invoiceLogo() })],
  [
    'DVCL-B-plusieurs-lignes.pdf',
    renderQuotePdf(
      quote({
        reference: 'MORA-DVCL-ZZ0002',
        customer: { name: 'Exemple Client', organisation: 'Papa Shop SARL', email: 'client@mora-shawiri.test', phone: null },
        references: { request: 'MORA-DMCL-ZZ0001', replaces: 'MORA-DVCL-ZZ0001' },
        lines: [
          line('Conception graphique', 1, 75000, 0, 'Maquettes des pages principales, deux allers-retours.'),
          line('Intégration et mise en ligne', 1, 120000, 20000, 'Hébergement de la première année compris.'),
          line('Visuels produits', 30, 250, 0, 'Retouche et détourage.'),
          line('Formation à la prise en main', 2, 5000),
        ],
        valid_until: '2026-10-31',
        notes: 'Acompte de démarrage à convenir. Les contenus (textes, photos) sont fournis par le client.',
      }),
      { logo: invoiceLogo() },
    ),
  ],
  [
    'DVCL-C-multipage.pdf',
    renderQuotePdf(
      quote({
        reference: 'MORA-DVCL-ZZ0003',
        lines: Array.from({ length: 34 }, (_, index) =>
          line(
            `Prestation détaillée numéro ${index + 1} — intitulé volontairement long pour vérifier le retour à la ligne dans la colonne de désignation`,
            (index % 3) + 1,
            12500 + index * 1000,
            index % 5 === 0 ? 1000 : 0,
            index % 2 === 0 ? 'Description courte qui précise le contenu exact de la ligne, sans rien inventer.' : null,
          ),
        ),
        valid_until: '2026-11-15',
        notes: 'Observation longue. '.repeat(40).trim(),
      }),
      { logo: invoiceLogo() },
    ),
  ],
  ['DVCL-D-apercu.pdf', renderQuotePdf(quote({ preview: true, reference: null }), { logo: invoiceLogo() })],
  ['DVCL-E-remplace.pdf', renderQuotePdf(quote({}), { logo: invoiceLogo(), status: 'REMPLACE' })],
];

function order(partial: Partial<OrderSnapshot>): OrderSnapshot {
  const lines = partial.lines ?? [line('Création de site vitrine', 1, 150000, 0, 'MORA-DVCL-ZZ0001')];
  const subtotal = lines.reduce((sum, row) => sum + row.quantity * row.unit_price, 0);
  return {
    type: 'CMCL',
    reference: 'MORA-CMCL-ZZ0001',
    issued_at: '2026-10-03T09:00:00+00:00',
    ordered_at: '2026-10-02T15:00:00+00:00',
    issuer,
    customer: { name: 'Exemple Client', email: 'client@mora-shawiri.test', phone: '+269 000 00 00' },
    references: { quote: 'MORA-DVCL-ZZ0001', request: 'MORA-DMCL-ZZ0001' },
    status: 'CONFIRMEE',
    currency: 'KMF',
    lines,
    totals: { subtotal, discount: 0, fees: 0, total: subtotal, paid: 0, due: subtotal },
    ...partial,
  };
}

samples.push(
  ['CMCL-A-confirmee.pdf', renderOrderPdf(order({}), { logo: invoiceLogo() })],
  [
    'CMCL-B-terminee-reglee.pdf',
    renderOrderPdf(
      order({
        reference: 'MORA-CMCL-ZZ0002',
        status: 'TERMINEE',
        lines: [
          line('Conception graphique — Maquettes des pages principales', 1, 75000, 5000, 'MORA-DVCL-ZZ0002'),
          line('Visuels produits', 30, 250, 0, 'MORA-DVCL-ZZ0002'),
        ],
        totals: { subtotal: 82500, discount: 5000, fees: 2500, total: 80000, paid: 80000, due: 0 },
      }),
      { logo: invoiceLogo() },
    ),
  ],
);

for (const [name, bytes] of samples) {
  writeFileSync(resolve(out, name), bytes);
  console.log(`${name} — ${bytes.byteLength} octets`);
}
