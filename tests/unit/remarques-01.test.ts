/**
 * Corrections post-4I (remarques 01) — tableau de bord, parcours boutique,
 * adresse officielle, déconnexion. Contrôles statiques : aucune base, aucun
 * envoi.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { site } from '../../src/lib/site';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8').replace(/\r\n/g, '\n');

/* ---------------------------------------------------------- tableau de bord */

test('chaque indicateur du tableau de bord exige la permission de son module', () => {
  const lib = read('src/lib/admin/dashboard.ts');
  // Table interrogée → permission qui doit précéder, dans le même bloc.
  const expected: [string, string][] = [
    ['quote_requests', "context.can('quotes.view')"],
    ['orders', "context.can('orders.view')"],
    ['payments', "context.can('payments.view')"],
    ['appointments', "context.can('appointments.view')"],
    ['clients', "context.can('users.view')"],
    ['affiliates', "context.can('affiliates.view')"],
    ['affiliate_applications', "context.can('affiliate_applications.view')"],
    ['affiliate_commissions', "context.can('commissions.view')"],
    ['affiliate_payouts', "context.can('payouts.view')"],
  ];
  for (const [table, guard] of expected) {
    const use = lib.indexOf(`from('${table}')`);
    assert.ok(use > 0, `${table} non compté`);
    const before = lib.slice(0, use);
    const block = before.slice(before.lastIndexOf('if (context.can('));
    assert.ok(block.startsWith(guard.slice(0, -1)) || block.includes(guard), `${table} : ${guard} attendu`);
  }
  // Lecture sous la session, jamais avec la clé serveur.
  assert.doesNotMatch(lib, /getAdminSupabaseClient|SUPABASE_SECRET_KEY/);
  assert.match(lib, /getServerSupabaseClient/);
  // Un compte sans permission ne reçoit pas de zéro : l'indicateur est absent.
  assert.match(lib, /value: number \| null/);
});

test('le tableau de bord affiche « — » quand un compteur est illisible', () => {
  const page = read('src/app/(pilotage)/administration/page.tsx');
  assert.match(page, /indicator\.value === null \? '—' : indicator\.value/);
  assert.match(page, /loadDashboardIndicators\(context\)/);
});

/* ----------------------------------------------------------- boutique */

test('offre à prix défini : prix relu dans le catalogue, récapitulatif réservé au serveur', () => {
  const route = read('src/app/api/contact/route.ts');
  const priced = route.slice(route.indexOf('async function pricedSummary'));
  assert.match(priced, /await getPublicCatalogue\(\)/);
  assert.match(priced, /offer\?\.priceAmount/);
  // Remarques 02 : la quantité hors bornes est refusée, plus ramenée à 1.
  assert.match(priced, /const quantity = parseQuantity\(rawQuantity\);\n  if \(quantity === null\) return 'invalid_quantity';/);
  assert.match(route, /readDetails\(raw\.details\)\.filter\(\(row\) => !PRICED_LABELS\.has\(row\.label\)\)/);
  assert.match(route, /return priced \? 'boutique-prix' : 'boutique'/);
  // Un seul workflow : la même fonction de base que la demande de devis.
  assert.doesNotMatch(route, /create_manual_order|place_order|payments/);
});

test('le formulaire distingue prix défini et devis sans rien encaisser', () => {
  const form = read('src/components/interactive/ContactForm.tsx');
  assert.match(form, /const pricedOffer = offer\?\.priceAmount \? offer : null;/);
  assert.match(form, /'Commander cette offre'/);
  assert.match(form, /'Envoyer ma demande'/);
  assert.match(form, /Aucun paiement n’a été demandé/);
  assert.match(form, /\{!pricedOffer && \(\s*<div className="field">\s*<label htmlFor="budget">/);
  // Le prix n'est jamais transmis par le navigateur.
  const payload = form.slice(form.indexOf('const payload = {'), form.indexOf('try {', form.indexOf('const payload = {')));
  const code = payload.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /priceAmount|estimate|unit_price/);
  const heading = read('src/components/interactive/ContactHeading.tsx');
  assert.match(heading, /Demander un devis gratuit/);
  assert.match(heading, /Commander cette offre/);
});

/* ---------------------------------------------------------- adresse */

test('l’adresse officielle est celle du site, de la page Contact et des données structurées', () => {
  assert.equal(site.addressLabel, 'Moroni Oasis, route les puffins');
  assert.match(read('src/app/(site)/contact/page.tsx'), /title=\{site\.addressLabel\}/);
  assert.match(read('src/lib/seo.ts'), /streetAddress: site\.streetAddress/);
  assert.match(read('src/components/layout/Footer.tsx'), /site\.addressLabel/);
  assert.match(read('src/app/(site)/(compte)/espace-client/(espace)/(accueil)/page.tsx'), /site\.addressLabel/);
  assert.match(read('src/lib/emails/layout.ts'), /site\.addressLabel/);
  // Plus aucune adresse « Moroni — Union des Comores » dans le code du site.
  for (const file of ['src/lib/site.ts', 'src/lib/documents/service.ts', 'src/app/(site)/contact/page.tsx']) {
    assert.doesNotMatch(read(file), /Moroni\s*[—–-]\s*Union des Comores|title="Moroni, Union des Comores"/, file);
  }
});

/* -------------------------------------------------------- déconnexion */

test('« Me déconnecter » : un seul mécanisme, toute la session, partout', () => {
  const action = read('src/lib/auth/actions.ts');
  const signOut = action.slice(action.indexOf('export async function signOutAction'));
  assert.match(signOut, /signOut\(\{ scope: 'global' \}\)/);
  assert.match(signOut, /formData\?\.get\('destination'\) === 'accueil' \? '\/' : AUTH_ROUTES\.signIn/);
  const header = read('src/components/layout/HeaderAccount.tsx');
  assert.equal((header.match(/<SignOutButton /g) ?? []).length, 2, 'bureau et tiroir mobile');
  assert.ok(header.indexOf('Mon espace') < header.indexOf('<SignOutButton '), 'sous « Mon espace »');
  assert.match(read('src/components/admin/AdminShell.tsx'), /<SignOutButton label="Me déconnecter" variant="admin" \/>/);
  // Aucun second système de session.
  for (const file of ['src/components/auth/SignOutButton.tsx', 'src/components/layout/HeaderAccount.tsx', 'src/components/admin/AdminShell.tsx']) {
    assert.doesNotMatch(read(file), /localStorage|document\.cookie\s*=|auth\.signOut/, file);
  }
  assert.match(read('src/components/auth/ReloadOnRestore.tsx'), /event\.persisted/);
});
