/**
 * La page publique `/affiliation/` est gelée — décision du propriétaire, 4H.
 *
 * Seule exception autorisée : la DESTINATION des trois appels à l'inscription
 * (« Devenir partenaire », « M’inscrire au programme », « Obtenir mon code
 * partenaire »), qui ouvrent désormais `/affiliation/inscription/`.
 *
 * ## Comment le test le prouve
 *
 * Il prend les sources actuelles, **défait** exactement ces trois
 * modifications — et elles seules —, puis compare l'empreinte du résultat à
 * celle de la version validée (commit `b791693`, clôture de 4G). Tout autre
 * écart — un mot, un taux, une classe, un style, une carte, l'ordre d'un
 * élément — change l'empreinte, et le test échoue.
 *
 * ## Exception des remarques 02 (3 octobre 2026)
 *
 * Le propriétaire autorise une seconde exception, très limitée : la réduction
 * des DIMENSIONS desktop, commune à toutes les pages publiques. Elle ne passe
 * pas par les sources de la page — elles restent gelées, empreintes
 * inchangées — mais par le bloc « 11. ÉCHELLE DESKTOP » de `globals.css`.
 * Le dernier test ci-dessous vérifie que ce bloc reste ce qui a été autorisé :
 * au-delà de 1080 px seulement, et uniquement des tailles, espacements et
 * hauteurs — ni couleur, ni police, ni animation, ni disposition.
 *
 * Ce contrôle porte sur la source. `scripts/verify-public.mjs` compare en
 * plus le HTML réellement servi, avant et après (rapport 15).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r/g, '');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Empreintes de la version validée, relevées sur `b791693`. */
const FROZEN = {
  page: 'a545d28e75652194afd5061843e01e07b9999602ade5072c16ea1065715139f3',
  calculator: '6004db0be6b009eea1c60e81f26ffd78c92a2358dce73d91d958424a501d71a7',
  ctaBand: '2a59d84ed3ab427335e17e120fae185ad26abf0ee9bf40c44f32d15628e43438',
};

const INSCRIPTION = '/affiliation/inscription/';

function undoPage(source: string): string {
  let text = source;
  const cta = `<Link className="btn btn--gold" href="${INSCRIPTION}">\n              Devenir partenaire <ArrowRight />`;
  assert.equal(text.split(cta).length - 1, 1, '« Devenir partenaire » doit ouvrir l’inscription');
  text = text.replace(cta, '<Link className="btn btn--gold" href="/contact/">\n              Devenir partenaire <ArrowRight />');

  const band = `        primaryHref="${INSCRIPTION}"\n`;
  assert.equal(text.split(band).length - 1, 1, '« M’inscrire au programme » doit ouvrir l’inscription');
  text = text.replace(band, '');
  return text;
}

function undoCalculator(source: string): string {
  let text = source;
  const now =
    "        {/* Phase 4H : seule la destination change — la candidature en ligne\n" +
    "            remplace le message WhatsApp. Libellé, classes et place inchangés. */}\n" +
    `        <Link className="btn btn--gold btn--block" href="${INSCRIPTION}">\n` +
    '          Obtenir mon code partenaire\n' +
    '        </Link>';
  assert.equal(text.split(now).length - 1, 1, '« Obtenir mon code partenaire » doit ouvrir l’inscription');
  text = text.replace(
    now,
    '        <a\n' +
      '          className="btn btn--gold btn--block"\n' +
      '          href={whatsappLink(JOIN_MESSAGE)}\n' +
      '          target="_blank"\n' +
      '          rel="noopener noreferrer"\n' +
      '        >\n' +
      '          Obtenir mon code partenaire\n' +
      '        </a>',
  );
  text = text.replace("import Link from 'next/link';", "import { whatsappLink } from '@/lib/site';");
  text = text.replace(
    "const formatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });\n\n",
    "const formatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });\n\n" +
      "const JOIN_MESSAGE = 'Bonjour MORA Shawiri, je souhaite rejoindre le programme d’affiliation.';\n\n",
  );
  return text;
}

test('/affiliation/ : hors destination des CTA, la page est identique à la version validée', () => {
  const page = read('src/app/(site)/affiliation/page.tsx');
  assert.equal(sha256(undoPage(page)), FROZEN.page, 'la page publique Affiliation a changé au-delà des CTA');
});

test('/affiliation/ : le simulateur n’a changé que sa destination', () => {
  const calculator = read('src/components/interactive/CommissionCalculator.tsx');
  assert.equal(sha256(undoCalculator(calculator)), FROZEN.calculator, 'le simulateur a changé au-delà de son CTA');
});

test('/affiliation/ : le bandeau d’appel à l’action est inchangé', () => {
  assert.equal(sha256(read('src/components/sections/CtaBand.tsx')), FROZEN.ctaBand);
});

test('/affiliation/ : les taux de démonstration restent 10, 12 et 15 %', () => {
  const page = read('src/app/(site)/affiliation/page.tsx');
  const calculator = read('src/components/interactive/CommissionCalculator.tsx');
  for (const rate of ["rate: '10 %'", "rate: '12 %'", "rate: '15 %'"]) assert.ok(page.includes(rate), rate);
  for (const rate of ['value: 10,', 'value: 12,', 'value: 15,']) assert.ok(calculator.includes(rate), rate);
});

test('/affiliation/ : aucun lien vers l’ancien parcours d’inscription par message', () => {
  const page = read('src/app/(site)/affiliation/page.tsx');
  // Les CTA d'inscription n'ouvrent plus /contact/ ; le bandeau garde son
  // bouton WhatsApp « Parler sur WhatsApp », qui n'est pas un CTA d'inscription.
  assert.ok(!page.includes('href="/contact/"'));
});

test('/affiliation/ : l’exception des remarques 02 ne touche que les dimensions desktop', () => {
  const css = read('src/styles/globals.css');
  const start = css.indexOf('11. ÉCHELLE DESKTOP DES PAGES PUBLIQUES');
  assert.ok(start > 0, 'bloc desktop introuvable');
  const block = css.slice(css.indexOf('@media (min-width: 1081px) {', start));
  assert.ok(block.startsWith('@media (min-width: 1081px) {'));
  const allowed = /^(--text-(hero|h1|h2|h3|lead|body|small)|--section-y|font-size|(padding|margin)(-block|-inline|-top|-right|-bottom|-left)?|gap|min-height|min-width|width|height|scroll-padding-top)$/;
  const declarations = [...block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\{([^{}]*)\}/g)].flatMap((match) => match[1]!.split(';'));
  const properties = declarations.map((line) => line.split(':')[0]!.trim()).filter(Boolean);
  assert.ok(properties.length > 40);
  for (const property of properties) assert.match(property, allowed, `propriété non autorisée : ${property}`);
  // Aucune règle propre à la page Affiliation : elle hérite de l'échelle commune.
  assert.doesNotMatch(block, /affiliation/i);
});
