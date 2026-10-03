/**
 * Corrections post-4I (remarques 02) — compteur de quantité d'une offre à prix
 * défini, et échelle desktop des pages publiques.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { QUANTITY_MAX, QUANTITY_MIN, clampQuantity, parseQuantity } from '../../src/lib/catalogue/quantity';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8').replace(/\r\n/g, '\n');

/* ----------------------------------------------------------- quantité */

test('les bornes de quantité restent celles du lot précédent : 1 à 99', () => {
  assert.equal(QUANTITY_MIN, 1);
  assert.equal(QUANTITY_MAX, 99);
});

test('le compteur ne descend pas sous 1 et ne dépasse pas 99', () => {
  let quantity = QUANTITY_MIN;
  quantity = clampQuantity(quantity + 1);
  assert.equal(quantity, 2);
  quantity = clampQuantity(quantity + 1);
  assert.equal(quantity, 3);
  quantity = clampQuantity(quantity - 1);
  assert.equal(quantity, 2);
  quantity = clampQuantity(quantity - 1);
  assert.equal(quantity, 1);
  assert.equal(clampQuantity(quantity - 1), 1);
  assert.equal(clampQuantity(QUANTITY_MAX + 1), 99);
});

test('le serveur accepte 1 à 99 en chiffres et refuse tout le reste', () => {
  assert.equal(parseQuantity(undefined), 1);
  assert.equal(parseQuantity(''), 1);
  assert.equal(parseQuantity('1'), 1);
  assert.equal(parseQuantity('3'), 3);
  assert.equal(parseQuantity(' 42 '), 42);
  assert.equal(parseQuantity('99'), 99);
  assert.equal(parseQuantity(7), 7);
  for (const forged of ['0', '100', '-1', '2.5', '1e1', '2abc', 'abc', '07a', 0, 100, 2.5, -3, true, {}, []]) {
    assert.equal(parseQuantity(forged), null, `quantité ${JSON.stringify(forged)} refusée`);
  }
});

test('la route refuse une quantité invalide avant tout enregistrement', () => {
  const route = read('src/app/api/contact/route.ts');
  const refuse = route.indexOf("if (pricedResult === 'invalid_quantity')");
  assert.ok(refuse > 0);
  assert.match(route.slice(refuse, refuse + 200), /error: 'invalid_quantity' \}, \{ status: 400 \}/);
  // Le refus précède l'enregistrement de la demande.
  assert.ok(refuse < route.indexOf('persistQuoteRequest('));
  // Le prix vient toujours du catalogue publié, jamais de la requête.
  const priced = route.slice(route.indexOf('async function pricedSummary'), route.indexOf('/** Empreinte'));
  assert.match(priced, /offer\.priceAmount \* quantity/);
  assert.doesNotMatch(priced, /raw\.|payload/);
});

test('le formulaire porte un compteur − / + accessible, sans liste déroulante', () => {
  const form = read('src/components/interactive/ContactForm.tsx');
  assert.doesNotMatch(form, /<select id="quantite"/);
  assert.doesNotMatch(form, /QUANTITIES/);
  assert.match(form, /<div className="qty" role="group" aria-labelledby="quantite-label">/);
  assert.match(form, /aria-label="Diminuer la quantité"/);
  assert.match(form, /aria-label="Augmenter la quantité"/);
  assert.match(form, /aria-disabled=\{quantity <= QUANTITY_MIN\}/);
  assert.match(form, /aria-disabled=\{quantity >= QUANTITY_MAX\}/);
  assert.equal(form.match(/<button\n\s+type="button"\n\s+className="qty__btn"/g)?.length, 2);
  assert.match(form, /<output id="quantite" className="qty__value" aria-live="polite"/);
  // Montant indicatif : prix catalogue × quantité, toujours annoncé.
  assert.match(form, /const estimate = pricedOffer \? pricedOffer\.priceAmount! \* quantity : null;/);
  assert.match(form, /<output id="montant-indicatif" htmlFor="quantite" className="form__estimate" aria-live="polite">/);
});
