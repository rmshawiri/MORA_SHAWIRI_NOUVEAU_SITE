/**
 * Contrôles du catalogue administrable (phase 4E).
 *
 * Ces tests ne parlent pas à la base : ils vérifient ce qu'un test hors ligne
 * peut réellement établir — la cohérence entre le fichier statique, la
 * migration et les pages. Les politiques RLS, les permissions et les
 * contraintes se vérifient contre une vraie base, et c'est le rôle de
 * `scripts/verify-catalogue.mjs`.
 *
 * La séparation est délibérée : un test unitaire qui simulerait Postgres
 * prouverait seulement que la simulation est d'accord avec elle-même.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { offerGroups, offers } from '../../src/content/offers';
import { CATALOGUE_REVALIDATE_SECONDS } from '../../src/lib/catalogue/revalidation';

const ROOT = resolve(import.meta.dirname, '..', '..');

function read(relative: string): string {
  return readFileSync(resolve(ROOT, relative), 'utf8');
}

const MIGRATION = read('supabase/migrations/20260930130000_catalogue_administrable.sql');

/**
 * Les trois pages publiques dont le catalogue alimente le rendu.
 *
 * `(site)` est le groupe de routes qui porte l'habillage du site vitrine.
 * Les parenthèses ne figurent dans aucune URL : `/boutique/` reste
 * `/boutique/`.
 */
const CATALOGUE_PAGES = [
  'src/app/(site)/page.tsx',
  'src/app/(site)/boutique/page.tsx',
  'src/app/(site)/contact/page.tsx',
];

/* ------------------------------------------------------- revalidation --- */

/**
 * Next.js exige un littéral pour `revalidate` : la valeur est lue par analyse
 * statique, et une constante importée est refusée au build. La duplication est
 * donc imposée — ce test est ce qui l'empêche de dériver.
 */
test('chaque page du catalogue revalide à la période déclarée', () => {
  for (const page of CATALOGUE_PAGES) {
    const source = read(page);
    const match = source.match(/export const revalidate = (\d+);/);

    assert.ok(match, `${page} ne déclare pas de période de revalidation`);
    assert.equal(
      Number(match![1]),
      CATALOGUE_REVALIDATE_SECONDS,
      `${page} revalide à ${match![1]} s alors que la constante partagée annonce ${CATALOGUE_REVALIDATE_SECONDS} s`,
    );
  }
});

/**
 * Une page publique qui lirait le catalogue avec le client de session
 * ouvrirait les cookies, et cesserait d'être pré-rendue. Le contrôle est
 * textuel faute de pouvoir l'être autrement, mais il vise la seule erreur
 * plausible : réutiliser par habitude le client de l'administration.
 */
test('aucune page publique n’ouvre la session pour lire le catalogue', () => {
  for (const page of CATALOGUE_PAGES) {
    const source = read(page);
    assert.ok(
      !source.includes('getServerSupabaseClient'),
      `${page} utilise le client de session, ce qui rendrait la page dynamique`,
    );
  }
});

/* ------------------------------------------------------------- reprise --- */

test('le repli statique couvre exactement les offres du fichier source', () => {
  const services = offers.filter((offer) => offer.family === 'service');

  assert.equal(services.length, 14, 'le catalogue de repli ne contient plus quatorze prestations');
  assert.equal(
    new Set(services.map((offer) => offer.id)).size,
    services.length,
    'deux offres partagent le même identifiant',
  );
});

test('chaque offre du repli se rattache à un groupe déclaré', () => {
  const known = new Set(offerGroups.map((group) => group.id));

  for (const offer of offers) {
    assert.ok(known.has(offer.group), `l’offre ${offer.id} vise un groupe inconnu : ${offer.group}`);
  }
});

/**
 * Les identifiants deviennent des slugs en base, et la contrainte
 * `services_slug_format` les refuse s'ils ne sont pas normalisés. Le vérifier
 * ici évite de découvrir le problème pendant une reprise.
 */
test('les identifiants du repli sont des slugs valides', () => {
  for (const offer of offers) {
    assert.match(
      offer.id,
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      `l’identifiant ${offer.id} ne respecte pas le format exigé par la base`,
    );
  }
});

/**
 * Six prestations ont un prix public validé ; les autres sont sur devis. Une
 * offre qui afficherait « Sur devis » tout en déclarant un montant publierait
 * un prix dans les données structurées sans le montrer au visiteur.
 */
test('un montant exploitable n’accompagne jamais un prix « sur devis »', () => {
  for (const offer of offers) {
    if (offer.priceAmount === undefined) continue;

    assert.ok(
      !/sur devis/i.test(offer.price),
      `l’offre ${offer.id} déclare un montant tout en s’affichant « sur devis »`,
    );
    assert.ok(offer.priceAmount > 0, `l’offre ${offer.id} déclare un montant nul ou négatif`);
  }
});

/* ----------------------------------------------------------- migration --- */

test('la migration du catalogue crée les quatre tables du domaine', () => {
  for (const table of ['categories', 'services', 'products', 'product_files']) {
    assert.match(
      MIGRATION,
      new RegExp(`create table if not exists public\\.${table}\\b`),
      `table ${table} absente de la migration`,
    );
  }
});

/**
 * Le cœur de la règle de publication : une ligne PUBLIE incomplète ne doit pas
 * pouvoir exister, quel que soit le chemin d'écriture.
 */
test('la publication est conditionnée en base, pas seulement dans le formulaire', () => {
  assert.match(MIGRATION, /constraint services_publiable check/);
  assert.match(MIGRATION, /constraint products_publiable check/);
});

test('la mise en ligne exige une permission distincte de la modification', () => {
  assert.match(MIGRATION, /services\.publish/);
  assert.match(MIGRATION, /products\.publish/);
  assert.match(MIGRATION, /create trigger services_publication_guard/);
});

/**
 * Sans plafond, l'affiliation d'une offre n'existe pas — c'est la correction
 * que le plan § 8 qualifie de plus importante du modèle.
 */
test('une offre éligible à l’affiliation porte obligatoirement un plafond', () => {
  assert.match(MIGRATION, /constraint services_affiliate_capped/);
  assert.match(MIGRATION, /constraint products_affiliate_capped/);
});

test('le catalogue est journalisé par la base, et non par l’interface', () => {
  assert.match(MIGRATION, /create trigger services_audit/);
  assert.match(MIGRATION, /create trigger products_audit/);
  assert.match(MIGRATION, /public\.record_audit_event/);
});

/** Le § 78 : ce qui a été publié s'archive, ne s'efface pas. */
test('une offre déjà publiée ne peut plus être supprimée', () => {
  assert.match(MIGRATION, /create trigger services_no_delete_when_published/);
  assert.match(MIGRATION, /published_at is not null/);
});

/**
 * La lecture publique ne doit jamais dépendre du seul filtre applicatif. Si la
 * politique cessait de restreindre au statut PUBLIE, un brouillon deviendrait
 * lisible par tout visiteur connaissant son slug.
 */
test('la politique publique ne laisse passer que les offres publiées', () => {
  const policy = MIGRATION.match(
    /create policy services_select_public[\s\S]*?using \(([\s\S]*?)\);/,
  );

  assert.ok(policy, 'politique de lecture publique introuvable');
  assert.match(policy![1]!, /status = 'PUBLIE'/);
  assert.match(policy![1]!, /is_active = true/);
});
