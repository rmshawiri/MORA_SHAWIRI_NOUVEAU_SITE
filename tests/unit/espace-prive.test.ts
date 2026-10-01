import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

/**
 * Contrôles du lot de finition — socle visuel des espaces privés.
 *
 * Trois propriétés qu'aucune capture ne garantit dans la durée :
 *
 *   1. la feuille des espaces privés ne peut atteindre ni le site public ni
 *      l'administration validée ;
 *   2. un écran privé n'emprunte jamais une classe de l'administration, dont
 *      la feuille n'est pas chargée chez lui — l'erreur s'est produite une
 *      fois, sur la fiche commande de l'Espace Client ;
 *   3. les valeurs de densité alignées sur l'administration le restent, ou
 *      cessent de l'être par décision, pas par oubli.
 */

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = resolve(ROOT, 'src');
const COMPTE = resolve(SRC, 'app', '(site)', '(compte)');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sources = walk(SRC).filter((path) => /\.(tsx?|css)$/.test(path));
const espaceCss = readFileSync(resolve(SRC, 'styles', 'espace.css'), 'utf8');
const adminCss = readFileSync(resolve(SRC, 'styles', 'admin.css'), 'utf8');

/** Valeur d'un jeton déclaré dans le premier bloc `selecteur { … }` du fichier. */
function token(css: string, selector: string, name: string): string | undefined {
  const start = css.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `bloc ${selector} introuvable`);
  const block = css.slice(start, css.indexOf('\n}', start));
  return block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim();
}

test('espace.css n’est chargée que par le gabarit du groupe (compte)', () => {
  const importers = sources
    .filter((path) => /@\/styles\/espace\.css|styles\/espace\.css'/.test(readFileSync(path, 'utf8')))
    .map((path) => relative(ROOT, path).replace(/\\/g, '/'));

  assert.deepEqual(importers, ['src/app/(site)/(compte)/layout.tsx']);
});

test('le gabarit (compte) pose la portée .espace autour des écrans privés', () => {
  const layout = readFileSync(resolve(COMPTE, 'layout.tsx'), 'utf8');
  assert.match(layout, /<div className="espace">\{children\}<\/div>/);
});

test('les jetons ne sont redéfinis que dans la portée .espace', () => {
  assert.doesNotMatch(espaceCss, /:root|(^|\n)\s*html\b|(^|\n)\s*body\b/);
  assert.doesNotMatch(espaceCss, /\.admin\b/);

  // Toute règle qui vise un composant du design system public est préfixée.
  const publicComponents = /^\s*\.(page-hero|field|btn|form|form-alert)\b/m;
  assert.doesNotMatch(espaceCss, publicComponents);
});

test('aucun écran privé n’emprunte une classe de l’administration', () => {
  const privateFiles = [
    ...walk(COMPTE),
    ...walk(resolve(SRC, 'components', 'auth')),
    resolve(SRC, 'components', 'interactive', 'PaymentDeclarationForm.tsx'),
  ].filter((path) => path.endsWith('.tsx'));

  for (const file of privateFiles) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /className=\{?[`'"][^`'"]*\badmin-/,
      `${relative(ROOT, file)} utilise une classe admin-*`,
    );
  }
});

test('les classes des écrans privés existent dans les feuilles du groupe', () => {
  const page = readFileSync(
    resolve(COMPTE, 'espace-client', 'commandes', '[reference]', 'page.tsx'),
    'utf8',
  );
  const used = new Set([...page.matchAll(/className="(espace-[a-z_-]+)"/g)].map((m) => m[1]));

  assert.ok(used.size > 0);
  for (const name of used) {
    assert.match(espaceCss, new RegExp(`\\.${name}\\b`), `${name} absente d'espace.css`);
  }
});

test('la densité des espaces privés reste alignée sur l’administration validée', () => {
  // Corps, petit texte, titre de carte, espacements, rayons. Le titre de page
  // diffère volontairement (posé sur le bandeau du site) : il n'est pas comparé.
  const pairs: Array<[string, string]> = [
    ['--text-body', '--text-body'],
    ['--text-small', '--text-small'],
    ['--text-h3', '--text-h2'], // titre de carte : 18px des deux côtés
    ['--sp-4', '--sp-4'],
    ['--sp-5', '--sp-5'],
    ['--sp-6', '--sp-6'],
    ['--sp-8', '--sp-8'],
    ['--sp-10', '--sp-10'],
    ['--sp-12', '--sp-12'],
    ['--sp-16', '--sp-16'],
    ['--r-card', '--r-card'],
    ['--r-btn', '--r-btn'],
  ];

  for (const [espaceName, adminName] of pairs) {
    assert.equal(
      token(espaceCss, '.espace', espaceName),
      token(adminCss, '.admin', adminName),
      `${espaceName} (espace) ≠ ${adminName} (administration)`,
    );
  }
});

test('champs et boutons privés restent des cibles tactiles sûres, sans zoom iOS', () => {
  assert.equal(token(espaceCss, '.espace', '--espace-control'), '44px');
  // 16px : en deçà, Safari iOS agrandit la page à chaque focus.
  assert.match(espaceCss, /\.espace \.field select \{[^}]*font-size: 1rem;/);
});

test('les cases à cocher des espaces privés ont une taille standard', () => {
  const css = readFileSync(resolve(process.cwd(), 'src', 'styles', 'espace.css'), 'utf8');
  const rule = /\.espace \.field input\[type='checkbox'\] \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /width: 18px/);
  assert.match(rule, /height: 18px/);
  assert.match(rule, /min-height: 0/, 'la hauteur minimale des champs ne s’applique pas à la case');
  // La zone d'appui reste confortable : c'est l'étiquette qui la porte.
  assert.match(css, /\.espace \.field label:has\(> input\[type='checkbox'\]\) \{[^}]*min-height: 44px/);
});
