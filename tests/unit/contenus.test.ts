import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  ALL_BLOCK_KEYS,
  CONTENT_PAGES,
  LIST_BLOCKS,
  TEXT_BLOCKS,
  isKnownBlockKey,
} from '../../src/content/blocks';
import { CONTENUS_REVALIDATE_SECONDS } from '../../src/lib/contenus/revalidation';
import { renderTitre, titreEnTexte } from '../../src/lib/contenus/titre';
import {
  isSafeInternalHref,
  validateArticleBody,
  validateListItems,
  validateTextFields,
} from '../../src/lib/contenus/validation';

/**
 * Contrôles de la phase 4E-2 — gestion des contenus.
 *
 * Ce fichier vérifie ce qu'une exécution ne montre pas : les invariants du
 * registre, la fermeture des validations, et l'accord entre deux réglages qui
 * doivent impérativement rester égaux.
 */

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const APP_DIR = resolve(PROJECT_ROOT, 'src', 'app');
const MIGRATIONS_DIR = resolve(PROJECT_ROOT, 'supabase', 'migrations');

function readAllSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8'))
    .join('\n');
}

const contenusSql = readFileSync(
  resolve(MIGRATIONS_DIR, '20260930140000_gestion_des_contenus.sql'),
  'utf8',
);

/* ======================================================== registre de blocs === */

test('chaque bloc du registre est rattaché à une page déclarée', () => {
  const slugs = new Set(CONTENT_PAGES.map((page) => page.slug));

  for (const [key, definition] of Object.entries(TEXT_BLOCKS)) {
    assert.ok(slugs.has(definition.page), `${key} pointe une page inconnue`);
  }

  for (const [key, definition] of Object.entries(LIST_BLOCKS)) {
    assert.ok(slugs.has(definition.page), `${key} pointe une page inconnue`);
  }
});

/**
 * La clé d'un bloc est une adresse : elle est écrite dans le code, affichée en
 * administration et journalisée dans l'audit. La contrainte
 * `content_blocks_key_format` la vérifie en base ; ce test la vérifie à la
 * source, pour qu'une clé mal formée soit refusée avant même d'atteindre la
 * base — où le message d'erreur serait beaucoup moins clair.
 */
test('les clés de bloc respectent le format accepté par la base', () => {
  for (const key of ALL_BLOCK_KEYS) {
    assert.match(key, /^[a-z0-9]+([.-][a-z0-9]+)*$/, `clé invalide : ${key}`);
  }
});

test('aucune clé de bloc n\'est déclarée deux fois', () => {
  assert.equal(new Set(ALL_BLOCK_KEYS).size, ALL_BLOCK_KEYS.length);
});

test('une clé absente du registre est reconnue comme inconnue', () => {
  assert.equal(isKnownBlockKey('accueil.hero'), true);
  assert.equal(isKnownBlockKey('accueil.inexistant'), false);
});

/**
 * Le registre porte la valeur réellement publiée : c'est ce qui rend le repli
 * gratuit et la non-régression démontrable. Une valeur par défaut invalide
 * ferait rendre au site un texte que la validation refuserait ensuite pour une
 * surcharge identique — incohérence difficile à diagnostiquer.
 */
test('toutes les valeurs par défaut du registre passent leur propre validation', () => {
  for (const [key, definition] of Object.entries(TEXT_BLOCKS)) {
    const validated = validateTextFields(definition.kind, definition.defaults);
    assert.notEqual(validated, null, `valeurs par défaut invalides pour ${key}`);
  }

  for (const [key, definition] of Object.entries(LIST_BLOCKS)) {
    const validated = validateListItems(definition.shape, definition.defaults);
    assert.notEqual(validated, null, `liste par défaut invalide pour ${key}`);
  }
});

/**
 * Les pages légales restent en code — décision D-21 = A. Aucun bloc ne doit les
 * viser, sans quoi la décision serait contournée par un ajout distrait.
 */
test('aucun bloc administrable ne vise une page légale ni l\'affiliation', () => {
  const interdits = [
    'mentions-legales',
    'conditions-generales',
    'politique-de-confidentialite',
    'politique-de-cookies',
    'affiliation',
  ];

  for (const key of ALL_BLOCK_KEYS) {
    for (const interdit of interdits) {
      assert.ok(
        !key.startsWith(`${interdit}.`),
        `${key} rend administrable une page qui doit rester en code`,
      );
    }
  }

  assert.ok(!CONTENT_PAGES.some((page) => interdits.includes(page.slug)));
});

/* ============================================================ revalidation === */

/**
 * Next.js n'accepte pour `export const revalidate` qu'un littéral : la valeur
 * est lue par analyse statique du fichier, pas à l'exécution. Les pages
 * écrivent donc `300` en clair, et ce test interdit que la duplication dérive.
 *
 * Le contrôle a été ajouté après avoir commis l'erreur : la première version de
 * la phase exportait la constante importée, et le build a échoué sur
 * « Invalid segment configuration export detected ».
 */
test('le revalidate littéral des pages s\'accorde avec la constante partagée', () => {
  const pages = [
    'page.tsx',
    'services/page.tsx',
    'boutique/page.tsx',
    'contact/page.tsx',
    'faq/page.tsx',
    'blog/page.tsx',
    'rendez-vous/page.tsx',
    'qui-sommes-nous/page.tsx',
    'formation-prospection-relation-client/page.tsx',
  ];

  let checked = 0;

  for (const relative of pages) {
    const source = readFileSync(resolve(APP_DIR, relative), 'utf8');
    const match = source.match(/export const revalidate = (\d+);/);
    assert.ok(match, `${relative} ne déclare pas de revalidate`);

    assert.equal(
      Number(match[1]),
      CONTENUS_REVALIDATE_SECONDS,
      `${relative} diverge de CONTENUS_REVALIDATE_SECONDS`,
    );
    checked += 1;
  }

  assert.equal(checked, pages.length);
});

/**
 * Le point 19 du cadrage interdit de dégrader les pages publiques. Ouvrir
 * `cookies()` dans une page publique la rendrait dynamique : Next.js en
 * déduirait — à juste titre — qu'elle dépend de la requête, et elle serait
 * recalculée à chaque visite. La lecture publique passe donc par un client sans
 * cookie.
 */
test('aucune lecture publique de contenu n\'ouvre la session', () => {
  const modules = ['public.ts', 'faq.ts', 'blog.ts'];

  for (const name of modules) {
    const source = readFileSync(
      resolve(PROJECT_ROOT, 'src', 'lib', 'contenus', name),
      'utf8',
    );

    assert.ok(
      !/getServerSupabaseClient/.test(source),
      `contenus/${name} utilise le client de session : la page deviendrait dynamique`,
    );
    assert.ok(
      /getPublicSupabaseClient/.test(source),
      `contenus/${name} devrait lire par le client public`,
    );
  }
});

/* ================================================================= titres === */

test('un titre sans marqueur ressort inchangé', () => {
  const titre = 'Vos questions, nos réponses';
  assert.equal(renderTitre(titre), titre);
  assert.equal(titreEnTexte(titre), titre);
});

test('le marqueur de mise en valeur est retiré du titre en texte', () => {
  assert.equal(
    titreEnTexte('Le Choix Optimal pour votre [[Performance]]'),
    'Le Choix Optimal pour votre Performance',
  );
  assert.equal(
    titreEnTexte('Maîtriser la [[Prospection]] et la Relation Client'),
    'Maîtriser la Prospection et la Relation Client',
  );
});

/**
 * `lastIndex` est porté par l'expression régulière globale : sans
 * réinitialisation, un second appel reprendrait où le premier s'est arrêté et
 * rendrait un titre tronqué. Le défaut ne se voit qu'au deuxième appel — donc
 * jamais dans un test naïf.
 */
test('deux appels successifs rendent le même titre', () => {
  const titre = 'Le Choix Optimal pour votre [[Performance]]';
  assert.equal(titreEnTexte(titre), titreEnTexte(titre));
  assert.deepEqual(renderTitre(titre), renderTitre(titre));
});

/* ============================================================= validation === */

test('un lien non interne est refusé', () => {
  for (const safe of ['/services/', '/services/#web', '/', '#web']) {
    assert.equal(isSafeInternalHref(safe), true, `${safe} devrait être accepté`);
  }

  const dangereux = [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox',
    // Protocole-relatif : mène vers un autre domaine tout en « commençant par
    // une barre ». C'est le cas que les contrôles naïfs laissent passer.
    '//evil.example.com',
    'https://evil.example.com',
    '/../etc/passwd',
    '',
  ];

  for (const href of dangereux) {
    assert.equal(isSafeInternalHref(href), false, `${href} devrait être refusé`);
  }
});

test('une icône inconnue fait écarter toute la liste', () => {
  const valide = [{ icon: 'shield', title: 'Titre', text: 'Texte' }];
  assert.notEqual(validateListItems('ENGAGEMENT', valide), null);

  const invalide = [{ icon: 'inexistante', title: 'Titre', text: 'Texte' }];
  assert.equal(validateListItems('ENGAGEMENT', invalide), null);
});

/**
 * La validation d'une liste est **globale** : un seul élément fautif écarte
 * tout. Rendre une liste amputée serait plus trompeur qu'un repli complet —
 * l'administrateur croirait avoir publié six cartes quand le site en montre
 * cinq.
 */
test('un seul élément fautif écarte la liste entière', () => {
  const items = [
    { icon: 'shield', title: 'Un', text: 'Texte' },
    { icon: 'shield', title: '', text: 'Texte' },
  ];

  assert.equal(validateListItems('ENGAGEMENT', items), null);
});

test('un champ inconnu n\'est pas transmis au composant', () => {
  const validated = validateTextFields('CTA', {
    title: 'Titre',
    text: 'Texte',
    primaryLabel: 'Bouton',
    whatsappMessage: 'Message',
    className: 'injecte',
    style: 'color:red',
  });

  assert.notEqual(validated, null);
  assert.deepEqual(Object.keys(validated!).sort(), [
    'primaryLabel',
    'text',
    'title',
    'whatsappMessage',
  ]);
});

test('un bandeau d\'ouverture exige exactement trois preuves', () => {
  const base = { eyebrow: 'Sur-titre', title: 'Titre', lead: 'Chapô' };

  assert.notEqual(validateTextFields('HERO', { ...base, proof: ['a', 'b', 'c'] }), null);
  assert.equal(validateTextFields('HERO', { ...base, proof: ['a', 'b'] }), null);
  assert.equal(validateTextFields('HERO', { ...base, proof: ['a', 'b', 'c', 'd'] }), null);
  assert.equal(validateTextFields('HERO', base), null);
});

test('le chapô d\'une section reste facultatif, celui d\'un bandeau non', () => {
  assert.notEqual(validateTextFields('SECTION', { eyebrow: 'A', title: 'B' }), null);
  assert.equal(validateTextFields('PAGE_HERO', { eyebrow: 'A', title: 'B' }), null);
});

/**
 * Le corps d'un article n'accepte **aucune** balise : le rendu construit
 * lui-même `<h2>`, `<p>` et `<strong>` à partir de types connus. Un bloc de type
 * inconnu est donc écarté, ce qui est la seule façon d'empêcher du HTML
 * d'atteindre la page.
 */
test('un bloc d\'article de type inconnu est refusé', () => {
  assert.notEqual(validateArticleBody([{ type: 'h2', text: 'Titre' }]), null);
  assert.equal(validateArticleBody([{ type: 'html', text: '<script>x</script>' }]), null);
  assert.equal(validateArticleBody([{ type: 'script', text: 'x' }]), null);
  assert.equal(validateArticleBody([]), null);
  assert.equal(validateArticleBody('<p>texte</p>'), null);
});

test('les segments d\'un paragraphe n\'acceptent que texte, gras et italique', () => {
  assert.notEqual(
    validateArticleBody([{ type: 'p', content: ['texte ', { b: 'gras' }, { i: 'italique' }] }]),
    null,
  );

  assert.equal(validateArticleBody([{ type: 'p', content: [{ u: 'souligné' }] }]), null);
  assert.equal(validateArticleBody([{ type: 'p', content: [] }]), null);
});

/**
 * Le corps réellement publié doit passer la validation : sinon le repli
 * s'appliquerait en permanence et la bascule vers la base serait fictive.
 */
test('les corps des articles existants passent la validation', async () => {
  const { articleBodies } = await import('../../src/content/article-bodies');

  for (const [slug, blocks] of Object.entries(articleBodies)) {
    assert.notEqual(validateArticleBody(blocks), null, `corps invalide pour ${slug}`);
  }
});

/* ============================================================== migration === */

test('les cinq tables de contenus activent RLS', () => {
  for (const table of [
    'content_blocks',
    'faq_categories',
    'faq_items',
    'content_posts',
    'media_assets',
  ]) {
    assert.match(
      contenusSql,
      new RegExp(`alter table public\\.${table}\\s+enable row level security`),
      `RLS absente sur ${table}`,
    );
  }
});

test('la médiathèque n\'est jamais ouverte au rôle anonyme', () => {
  const allSql = readAllSql();

  assert.ok(
    !/grant[^;]*on public\.media_assets[^;]*\banon\b/i.test(allSql),
    'media_assets ne doit recevoir aucun privilège du rôle anonyme',
  );
  assert.ok(
    !/create policy[^;]*on public\.media_assets[^;]*to[^;]*\banon\b/i.test(allSql),
    'aucune politique de media_assets ne doit cibler le rôle anonyme',
  );
});

/**
 * Le § 40 du document Stockage traite le SVG comme du contenu actif : il peut
 * porter un script. Il ne figure ni dans la contrainte de la table, ni dans les
 * types acceptés par le bucket — et ce test interdit qu'il y entre par
 * inadvertance.
 */
test('le SVG n\'est accepté ni par la table ni par le bucket', () => {
  assert.ok(!/image\/svg/i.test(contenusSql), 'le SVG ne doit pas être accepté');
});

test('le bucket de médias porte ses propres limites de taille et de type', () => {
  assert.match(contenusSql, /file_size_limit/);
  assert.match(contenusSql, /allowed_mime_types/);

  // Le contrôle doit exister côté Storage, pas seulement dans l'interface
  // (§ 35 du document Stockage).
  assert.match(
    contenusSql,
    /create policy contenus_medias_insert[\s\S]{0,300}has_permission\('media\.upload'\)/,
  );
});

/**
 * Le point 13 du cadrage : un compte qui peut modifier ne doit pas pouvoir
 * publier. Le garde s'applique aux trois tables dont la publication est
 * visible, **et** à la suppression d'une surcharge en ligne — qui est un retrait
 * public, invisible pour une politique RLS.
 */
test('la publication et le retrait exigent content.publish, par déclencheur', () => {
  assert.match(
    contenusSql,
    /tg_contenus_publication_guard[\s\S]*?has_permission\('content\.publish'\)/,
  );

  for (const table of ['content_blocks', 'faq_items', 'content_posts']) {
    assert.match(
      contenusSql,
      new RegExp(`create trigger ${table}_publication_guard`),
      `garde de publication absent sur ${table}`,
    );
  }

  assert.match(
    contenusSql,
    /tg_content_blocks_delete_guard[\s\S]*?has_permission\('content\.publish'\)/,
    'la suppression d\'une surcharge en ligne doit exiger content.publish',
  );
});

test('un contenu déjà publié ne peut plus être supprimé', () => {
  assert.match(contenusSql, /tg_contenus_no_delete_when_published/);

  for (const table of ['faq_items', 'content_posts']) {
    assert.match(
      contenusSql,
      new RegExp(`create trigger ${table}_no_delete_when_published`),
      `garde de suppression absent sur ${table}`,
    );
  }
});

test('la phase ne crée aucune permission : elles existent depuis 4A', () => {
  assert.ok(
    !/insert into public\.permissions/i.test(contenusSql),
    'aucune permission ne doit être créée par cette migration',
  );
});

test('aucun second journal d\'audit n\'est créé', () => {
  // Le journal de 4A/4C est réutilisé via record_audit_event, et rien d'autre.
  assert.match(contenusSql, /record_audit_event/);

  // Le contrôle porte sur le **nom** des tables créées, et non sur la présence
  // du mot « audit » quelque part dans une définition : une première version de
  // ce test cherchait `create table[^;]*audit` et se déclenchait sur un
  // commentaire situé dans le corps d'une table sans rapport.
  const created = [...contenusSql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)]
    .map((match) => match[1]!);

  assert.deepEqual(created.sort(), [
    'content_blocks',
    'content_posts',
    'faq_categories',
    'faq_items',
    'media_assets',
  ]);

  for (const name of created) {
    assert.ok(
      !/audit|journal|log/.test(name),
      `${name} ressemble à un second journal : le journal de 4A/4C doit être réutilisé`,
    );
  }
});

/**
 * Les cinq tables sont journalisées par déclencheur, et non par les actions
 * serveur. Une action peut oublier de journaliser ; une phase suivante peut
 * ajouter un second chemin d'écriture. Le déclencheur voit passer toute
 * écriture, d'où qu'elle vienne.
 */
test('les cinq tables de contenus sont journalisées par déclencheur', () => {
  for (const table of [
    'content_blocks',
    'faq_categories',
    'faq_items',
    'content_posts',
    'media_assets',
  ]) {
    assert.match(
      contenusSql,
      new RegExp(`create trigger ${table}_audit`),
      `journalisation absente sur ${table}`,
    );
  }
});
