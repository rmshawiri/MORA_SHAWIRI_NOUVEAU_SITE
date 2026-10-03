/**
 * Le registre des modules et les routes réellement présentes sur le disque
 * décrivent la même administration.
 *
 * Trois divergences sont possibles, et toutes les trois sont des incidents :
 *
 *   * un module déclaré sans page — une entrée de menu qui mène à un 404 ;
 *   * une page sans module déclaré — un écran que le menu ne montre pas, et
 *     surtout dont le contrôle d'accès n'est plus adossé au registre ;
 *   * un module dont la permission n'existe pas au catalogue — une porte que
 *     personne ne pourra jamais ouvrir.
 *
 * Ce test lit l'arborescence plutôt que de faire confiance à une liste tenue à
 * la main. Les phases suivantes ajouteront des modules ; elles échoueront ici
 * si elles oublient l'un des deux côtés.
 */

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { PERMISSIONS } from '../../src/lib/rbac/catalogue';
import { ADMIN_MODULES, ADMIN_ROOT, findModule, visibleModules } from '../../src/lib/rbac/modules';
import { allows } from '../../src/lib/rbac/effective';

/**
 * L'administration vit dans le groupe de routes `(pilotage)`, qui ne porte pas
 * l'habillage du site vitrine — à la différence de `(site)`, où vivent les
 * pages publiques et les écrans de compte. Les parenthèses ne figurent dans
 * aucune URL : `/administration/` reste `/administration/`.
 */
const ADMIN_DIR = resolve(process.cwd(), 'src', 'app', '(pilotage)', 'administration');

/** Segments de route réellement présents, hors segments dynamiques. */
function routeSlugs(): string[] {
  return readdirSync(ADMIN_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('['))
    .map((entry) => entry.name)
    .sort();
}

test('chaque module déclaré possède une page', () => {
  for (const entry of ADMIN_MODULES) {
    const path =
      entry.slug === null
        ? resolve(ADMIN_DIR, 'page.tsx')
        : resolve(ADMIN_DIR, entry.slug, 'page.tsx');

    assert.ok(existsSync(path), `le module « ${entry.label} » n’a pas de page : ${path}`);
  }
});

test('chaque page correspond à un module déclaré', () => {
  const declared = new Set<string>(
    ADMIN_MODULES.flatMap((entry) => (entry.slug === null ? [] : [entry.slug])),
  );

  for (const slug of routeSlugs()) {
    assert.ok(
      declared.has(slug),
      `la route /administration/${slug}/ n’est déclarée dans aucun module du registre`,
    );
  }
});

test('chaque permission de module existe au catalogue', () => {
  const known = new Set<string>(PERMISSIONS);

  for (const entry of ADMIN_MODULES) {
    if (entry.permission === null) continue;
    assert.ok(known.has(entry.permission), `permission inconnue : ${entry.permission}`);
  }
});

test('les adresses sont cohérentes avec la racine et se terminent par un slash', () => {
  for (const entry of ADMIN_MODULES) {
    assert.ok(entry.href.startsWith(ADMIN_ROOT), `${entry.href} sort de l’administration`);
    assert.ok(entry.href.endsWith('/'), `${entry.href} n’a pas de slash final`);

    if (entry.slug !== null) {
      assert.equal(entry.href, `${ADMIN_ROOT}${entry.slug}/`);
    }
  }
});

test('un seul module sert de tableau de bord', () => {
  const roots = ADMIN_MODULES.filter((entry) => entry.slug === null);
  assert.equal(roots.length, 1);
  assert.equal(roots[0]!.permission, null);
});

test('aucun slug n’est déclaré deux fois', () => {
  const slugs: (string | null)[] = ADMIN_MODULES.map((entry) => entry.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test('findModule retrouve chaque module, et rien d’autre', () => {
  for (const entry of ADMIN_MODULES) {
    assert.equal(findModule(entry.slug)?.href, entry.href);
  }

  assert.equal(findModule('module-inexistant'), undefined);
});

/* -------------------------------------------------------------------------- */
/*  La navigation reflète les droits, sans jamais les créer                    */
/* -------------------------------------------------------------------------- */

test('sans aucune permission, seul le tableau de bord est proposé', () => {
  const visible = visibleModules([], allows);

  assert.equal(visible.length, 1);
  assert.equal(visible[0]!.slug, null);
});

test('admin.full_access ouvre tous les modules', () => {
  assert.equal(visibleModules(['admin.full_access'], allows).length, ADMIN_MODULES.length);
});

test('une permission n’ouvre que les modules qui l’exigent', () => {
  const visible = visibleModules(['orders.view'], allows);
  const slugs: (string | null)[] = visible.map((entry) => entry.slug);

  assert.ok(slugs.includes(null), 'le tableau de bord reste accessible');
  assert.ok(slugs.includes('commandes'), 'orders.view doit ouvrir les Commandes');
  assert.ok(!slugs.includes('paiements'), 'orders.view ne doit pas ouvrir les Paiements');
  assert.ok(!slugs.includes('administrateurs'), 'orders.view ne doit pas ouvrir les Administrateurs');
  assert.ok(!slugs.includes('journal'), 'orders.view ne doit pas ouvrir le Journal');
});

test('chaque module est ouvert par sa permission, et par elle seule', () => {
  for (const entry of ADMIN_MODULES) {
    if (entry.permission === null) continue;

    const visible: (string | null)[] = visibleModules([entry.permission], allows).map(
      (other) => other.slug,
    );
    assert.ok(visible.includes(entry.slug), `${entry.permission} n’ouvre pas ${entry.label}`);

    // Les modules qui partagent la même permission sont légitimement ouverts
    // ensemble ; tout autre module doit rester fermé.
    for (const other of ADMIN_MODULES) {
      if (other.slug === null || other.permission === entry.permission) continue;

      assert.ok(
        !visible.includes(other.slug),
        `${entry.permission} ouvre indûment ${other.label}`,
      );
    }
  }
});

/* -------------------------------------------------------------------------- */
/*  L'état affiché suit l'état réel des modules                                */
/* -------------------------------------------------------------------------- */

/**
 * Affiliation, livrée en 4H, est restée marquée « à venir » jusqu'après 4I.
 * Les états sont épinglés ici : un module livré qui reste annoncé, ou un
 * module futur annoncé comme disponible, échoue.
 */
test('les états des modules correspondent à ce qui est livré', () => {
  const expected: Record<string, 'DISPONIBLE' | 'A_VENIR'> = {
    commandes: 'DISPONIBLE',
    demandes: 'DISPONIBLE',
    'rendez-vous': 'DISPONIBLE',
    clients: 'DISPONIBLE',
    affiliation: 'DISPONIBLE',
    paiements: 'DISPONIBLE',
    catalogue: 'DISPONIBLE',
    contenus: 'DISPONIBLE',
    administrateurs: 'DISPONIBLE',
    journal: 'DISPONIBLE',
    notifications: 'A_VENIR',
    marketing: 'A_VENIR',
    popups: 'A_VENIR',
    statistiques: 'A_VENIR',
    parametres: 'A_VENIR',
  };

  for (const entry of ADMIN_MODULES) {
    if (entry.slug === null) continue;
    assert.equal(entry.status, expected[entry.slug], `état inattendu pour ${entry.label}`);
  }
});

test('Affiliation reste fermée sans affiliates.view, et chacune de ses pages a son garde', () => {
  const affiliation = findModule('affiliation');
  assert.equal(affiliation?.permission, 'affiliates.view');
  assert.equal(affiliation?.href, '/administration/affiliation/');

  for (const permission of ['commissions.view', 'payouts.view', 'affiliate_applications.view', 'users.view']) {
    const slugs: (string | null)[] = visibleModules([permission], allows).map((entry) => entry.slug);
    assert.ok(!slugs.includes('affiliation'), `${permission} ne doit pas ouvrir Affiliation`);
  }

  const dir = resolve(ADMIN_DIR, 'affiliation');
  const pages = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((path) =>
    path.endsWith('page.tsx'),
  );
  assert.ok(pages.length >= 12, 'les pages du module Affiliation sont introuvables');

  for (const page of pages) {
    const source = readFileSync(resolve(dir, page), 'utf8');
    assert.match(
      source,
      /requireModule\('affiliation'\)|requirePermission\('affiliates\./,
      `${page} n’est adossée à aucun garde du module`,
    );
  }
});
