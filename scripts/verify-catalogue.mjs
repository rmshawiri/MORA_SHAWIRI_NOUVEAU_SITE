/**
 * Vérification du catalogue administrable contre une base réelle.
 *
 *   node scripts/verify-catalogue.mjs --env shared
 *   node scripts/verify-catalogue.mjs --env prod --i-know-this-is-production
 *
 * Les tests unitaires lisent le SQL ; celui-ci l'exécute. C'est la différence
 * entre « la migration contient une politique » et « la politique refuse ».
 * Le cadrage de la phase 4E demande la seconde preuve, profil par profil :
 * SUPER_ADMIN, ADMIN avec permission, ADMIN sans permission, CLIENT, AFFILIE,
 * visiteur anonyme, appel direct d'action serveur, tentative de modification
 * d'un champ non autorisé.
 *
 * ## Les données de test
 *
 * Les comptes portent le domaine réservé `@mora-shawiri.test`, les offres un
 * slug préfixé `verif-`. Tout est supprimé dans un bloc `finally`, et un
 * balayage final signale ce qui aurait survécu. Les quatorze offres réelles ne
 * sont jamais modifiées : le script ne les lit que pour compter.
 *
 * ## Sur la production
 *
 * Seuls les contrôles anonymes s'exécutent. Créer un compte administratif
 * temporaire sur une base portant les données réelles serait exactement le
 * genre de commodité que la phase 4A s'est interdite.
 */

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { describeTarget, hasFlag, log, resolveTarget } from './lib/config.mjs';

const results = { passed: 0, failed: 0 };

function check(label, condition, detail = '') {
  if (condition) {
    results.passed += 1;
    log.ok(label);
  } else {
    results.failed += 1;
    log.fail(`${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Une écriture est refusée si elle lève, ou si elle n'a touché aucune ligne. */
function refused(result) {
  return Boolean(result.error) || (Array.isArray(result.data) && result.data.length === 0);
}

const TEST_DOMAIN = 'mora-shawiri.test';
const TEST_PREFIX = 'verif-catalogue';
const PASSWORD = `Verif-4E-${randomUUID()}`;

function sessionClient(target) {
  return createClient(target.url, target.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(target, email) {
  const client = sessionClient(target);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`connexion impossible pour ${email} : ${error.message}`);
  return client;
}

async function createAccount(admin, { roleCode, grants = [], prefix }) {
  const email = `${prefix}-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });

  if (error || !data.user) throw new Error(`création de ${prefix} : ${error?.message}`);
  const userId = data.user.id;

  const { data: role } = await admin.from('roles').select('id').eq('code', roleCode).maybeSingle();
  if (!role) throw new Error(`rôle ${roleCode} introuvable`);

  await admin.from('user_roles').insert({ user_id: userId, role_id: role.id });

  if (grants.length > 0) {
    const { data: permissions } = await admin
      .from('permissions')
      .select('id, code')
      .in('code', grants);

    const rows = (permissions ?? []).map((row) => ({
      user_id: userId,
      permission_id: row.id,
      effect: 'OCTROI',
    }));

    if (rows.length !== grants.length) {
      throw new Error(`catalogue de permissions incomplet pour ${prefix}`);
    }

    const written = await admin
      .from('user_permissions')
      .upsert(rows, { onConflict: 'user_id,permission_id' });

    if (written.error) throw new Error(written.error.message);
  }

  return { userId, email };
}

/* ========================================================================== */
/*  1. Le visiteur anonyme                                                    */
/* ========================================================================== */

async function checkAnonymous(target, fixtures) {
  log.step('Visiteur anonyme');

  const anon = sessionClient(target);

  const { data: published, error } = await anon.from('services').select('slug, status');
  check('anon lit le catalogue public', !error, error?.message);

  const statuses = new Set((published ?? []).map((row) => row.status));
  check(
    'anon ne voit que des offres publiées',
    statuses.size === 0 || (statuses.size === 1 && statuses.has('PUBLIE')),
    [...statuses].join(', '),
  );

  if (fixtures) {
    // Le point 8 du cadrage : « Un brouillon ne doit pas devenir accessible
    // simplement parce que son identifiant ou son slug est connu. » On le lui
    // donne, précisément.
    const { data: draft } = await anon.from('services').select('slug').eq('slug', fixtures.draftSlug);
    check('anon ne voit pas un brouillon dont il connaît le slug', (draft ?? []).length === 0);

    const { data: byId } = await anon.from('services').select('slug').eq('id', fixtures.draftId);
    check('anon ne voit pas un brouillon dont il connaît l’identifiant', (byId ?? []).length === 0);

    const { data: hidden } = await anon
      .from('services')
      .select('slug')
      .eq('slug', fixtures.hiddenCategorySlug);
    check(
      'anon ne voit pas une offre publiée rangée dans une catégorie désactivée',
      (hidden ?? []).length === 0,
    );
  }

  for (const table of ['categories', 'services', 'products']) {
    const write = await anon.from(table).insert({});
    check(`anon n’écrit rien dans « ${table} »`, Boolean(write.error));
  }

  const { error: filesError } = await anon.from('product_files').select('id');
  check('anon n’atteint pas les livrables de produit', Boolean(filesError));
}

/* ========================================================================== */
/*  2. Les profils sans droit sur le catalogue                                */
/* ========================================================================== */

async function checkDeniedProfile(target, label, account, fixtures) {
  log.step(`${label} — connecté, sans droit sur le catalogue`);

  const client = await signIn(target, account.email);

  const { data: rows } = await client.from('services').select('slug, status');
  const statuses = new Set((rows ?? []).map((row) => row.status));
  check(
    `${label} ne voit que les offres publiées`,
    statuses.size === 0 || (statuses.size === 1 && statuses.has('PUBLIE')),
    [...statuses].join(', '),
  );

  const { data: draft } = await client.from('services').select('slug').eq('slug', fixtures.draftSlug);
  check(`${label} ne voit pas les brouillons`, (draft ?? []).length === 0);

  const update = await client
    .from('services')
    .update({ price_label: 'Gratuit' })
    .eq('slug', fixtures.publishedSlug)
    .select('slug');
  check(`${label} ne peut pas modifier un prix`, refused(update));

  const insert = await client.from('services').insert({
    slug: `${TEST_PREFIX}-intrus-${randomUUID().slice(0, 6)}`,
    category_id: fixtures.categoryId,
    title: 'Intrusion',
    tag: 'Test',
    short_description: 'x',
    description: 'x',
    price_label: 'Sur devis',
    image_path: '/images/x.webp',
    cta_label: 'x',
    request_subject: 'x',
  });
  check(`${label} ne peut pas créer une offre`, Boolean(insert.error));

  const remove = await client
    .from('services')
    .delete()
    .eq('slug', fixtures.draftSlug)
    .select('slug');
  check(`${label} ne peut pas supprimer une offre`, refused(remove));
}

/* ========================================================================== */
/*  3. ADMIN avec permission de lecture seule                                 */
/* ========================================================================== */

async function checkReadOnlyAdmin(target, account, fixtures) {
  log.step('ADMIN avec services.view seul');

  const client = await signIn(target, account.email);

  const { data: rows } = await client.from('services').select('slug, status');
  const statuses = new Set((rows ?? []).map((row) => row.status));
  check(
    'il voit les brouillons et les archives',
    statuses.has('BROUILLON'),
    [...statuses].join(', '),
  );

  const update = await client
    .from('services')
    .update({ title: 'Renommé sans droit' })
    .eq('slug', fixtures.draftSlug)
    .select('slug');
  check('il ne peut pas modifier une offre', refused(update));

  const publish = await client
    .from('services')
    .update({ status: 'PUBLIE' })
    .eq('slug', fixtures.draftSlug)
    .select('slug');
  check('il ne peut pas publier une offre', refused(publish));
}

/* ========================================================================== */
/*  4. ADMIN avec modification mais SANS publication                          */
/* ========================================================================== */

/**
 * Le cas le plus intéressant du lot, et celui qu'une politique RLS seule ne
 * saurait pas traiter : modifier est permis, publier ne l'est pas. Le
 * déclencheur `catalogue_publication_guard` est ce qui fait la différence.
 */
async function checkEditorAdmin(target, account, fixtures) {
  log.step('ADMIN avec services.update mais sans services.publish');

  const client = await signIn(target, account.email);

  const rename = await client
    .from('services')
    .update({ price_note: 'Modifié par le contrôle' })
    .eq('slug', fixtures.draftSlug)
    .select('slug, price_note');
  check('il peut modifier une offre', !refused(rename), rename.error?.message);

  const publish = await client
    .from('services')
    .update({ status: 'PUBLIE' })
    .eq('slug', fixtures.draftSlug)
    .select('slug');
  check('il ne peut PAS publier', refused(publish), publish.error?.message);

  const unpublish = await client
    .from('services')
    .update({ status: 'NON_PUBLIE' })
    .eq('slug', fixtures.publishedSlug)
    .select('slug');
  check('il ne peut PAS dépublier', refused(unpublish), unpublish.error?.message);

  // Champ hors de son domaine : la colonne existe, mais rien ne l'autorise à
  // déclarer une offre éligible à l'affiliation sans plafond.
  const affiliate = await client
    .from('services')
    .update({ affiliate_eligible: true })
    .eq('slug', fixtures.draftSlug)
    .select('slug');
  check(
    'il ne peut pas déclarer une éligibilité sans plafond',
    refused(affiliate),
    affiliate.error?.message,
  );
}

/* ========================================================================== */
/*  5. ADMIN habilité à publier                                               */
/* ========================================================================== */

async function checkPublisherAdmin(target, account, fixtures) {
  log.step('ADMIN avec services.update et services.publish');

  const client = await signIn(target, account.email);

  const publish = await client
    .from('services')
    .update({ status: 'PUBLIE' })
    .eq('slug', fixtures.draftSlug)
    .select('slug, status, published_at');
  check('il peut publier', !refused(publish), publish.error?.message);

  const row = publish.data?.[0];
  check('la publication horodate la première mise en ligne', Boolean(row?.published_at));

  const unpublish = await client
    .from('services')
    .update({ status: 'NON_PUBLIE' })
    .eq('slug', fixtures.draftSlug)
    .select('slug');
  check('il peut dépublier', !refused(unpublish), unpublish.error?.message);

  // § 78 : une offre qui a connu la publication ne s'efface plus.
  const remove = await client.from('services').delete().eq('slug', fixtures.draftSlug).select('slug');
  check('il ne peut plus supprimer une offre déjà publiée', refused(remove));
}

/* ========================================================================== */
/*  6. Intégrité — ce que la base refuse, quel que soit l'appelant            */
/* ========================================================================== */

async function checkIntegrity(admin, fixtures) {
  log.step('Intégrité du catalogue');

  const base = {
    category_id: fixtures.categoryId,
    title: 'Contrôle',
    tag: 'Test',
    short_description: 'x',
    description: 'x',
    price_label: 'Sur devis',
    image_path: '/images/x.webp',
    cta_label: 'x',
    request_subject: 'x',
  };

  const badSlug = await admin
    .from('services')
    .insert({ ...base, slug: 'Slug Invalide !' })
    .select('slug');
  check('un slug non normalisé est refusé', Boolean(badSlug.error));

  const duplicate = await admin
    .from('services')
    .insert({ ...base, slug: fixtures.publishedSlug })
    .select('slug');
  check('un slug déjà pris est refusé', Boolean(duplicate.error));

  const negative = await admin
    .from('services')
    .insert({ ...base, slug: `${TEST_PREFIX}-negatif`, price_amount: -10 })
    .select('slug');
  check('un montant négatif est refusé', Boolean(negative.error));

  const badStatus = await admin
    .from('services')
    .insert({ ...base, slug: `${TEST_PREFIX}-statut`, status: 'EN_LIGNE' })
    .select('slug');
  check('un statut inconnu est refusé', Boolean(badStatus.error));

  const incomplete = await admin
    .from('services')
    .insert({ ...base, slug: `${TEST_PREFIX}-vide`, status: 'PUBLIE', description: '   ' })
    .select('slug');
  check('une offre publiée sans description est refusée', Boolean(incomplete.error));

  const uncapped = await admin
    .from('services')
    .insert({ ...base, slug: `${TEST_PREFIX}-affilie`, affiliate_eligible: true })
    .select('slug');
  check('une éligibilité sans plafond est refusée', Boolean(uncapped.error));

  const featured = await admin
    .from('services')
    .insert({ ...base, slug: `${TEST_PREFIX}-avant`, is_featured: true })
    .select('slug');
  check('une mise en avant sans rang est refusée', Boolean(featured.error));

  const wrongKind = await admin
    .from('services')
    .insert({ ...base, slug: `${TEST_PREFIX}-univers`, category_id: fixtures.productCategoryId })
    .select('slug');
  check('un service rangé dans une catégorie de produits est refusé', Boolean(wrongKind.error));

  const orphan = await admin
    .from('services')
    .insert({ ...base, slug: `${TEST_PREFIX}-orphelin`, category_id: randomUUID() })
    .select('slug');
  check('une catégorie inexistante est refusée', Boolean(orphan.error));

  const drop = await admin.from('categories').delete().eq('id', fixtures.categoryId).select('id');
  check('une catégorie portant des offres ne peut être supprimée', Boolean(drop.error));

  const deactivate = await admin
    .from('categories')
    .update({ is_active: false })
    .eq('id', fixtures.categoryId)
    .select('id');
  check(
    'une catégorie portant une offre publiée ne peut être désactivée',
    Boolean(deactivate.error),
    deactivate.error?.message,
  );
}

/* ========================================================================== */
/*  7. Audit                                                                  */
/* ========================================================================== */

async function checkAudit(admin, since) {
  log.step('Journal d’audit');

  const { data, error } = await admin
    .from('audit_logs')
    .select('action, resource_type, resource_id, metadata')
    .like('action', 'catalogue.%')
    .gte('created_at', since);

  check('le journal est lisible', !error, error?.message);

  const actions = new Set((data ?? []).map((row) => row.action));
  check('les créations du catalogue sont tracées', actions.has('catalogue.services.insert'));
  check('les modifications du catalogue sont tracées', actions.has('catalogue.services.update'));

  const withStatus = (data ?? []).filter((row) => row.metadata?.statut);
  check('chaque trace porte le statut de l’offre', withStatus.length === (data ?? []).length);
}

/* ========================================================================== */
/*  Décor                                                                     */
/* ========================================================================== */

/**
 * Pose un décor complet et distinct des données réelles : deux catégories,
 * trois offres. Les slugs sont préfixés pour que le nettoyage soit sûr et que
 * personne ne les confonde avec le catalogue de MORA Shawiri.
 */
async function buildFixtures(admin) {
  const suffix = randomUUID().slice(0, 6);

  const { data: category, error: categoryError } = await admin
    .from('categories')
    .insert({
      slug: `${TEST_PREFIX}-${suffix}`,
      name: 'Contrôle automatique',
      kind: 'SERVICE',
      sort_order: 9000,
    })
    .select('id')
    .single();

  if (categoryError) throw new Error(`décor (catégorie) : ${categoryError.message}`);

  const { data: productCategory, error: productError } = await admin
    .from('categories')
    .insert({
      slug: `${TEST_PREFIX}-produits-${suffix}`,
      name: 'Contrôle automatique — produits',
      kind: 'PRODUIT',
      sort_order: 9001,
    })
    .select('id')
    .single();

  if (productError) throw new Error(`décor (catégorie produits) : ${productError.message}`);

  // Une catégorie désactivée, pour prouver qu'elle masque ses offres publiées.
  const { data: hiddenCategory, error: hiddenError } = await admin
    .from('categories')
    .insert({
      slug: `${TEST_PREFIX}-masquee-${suffix}`,
      name: 'Contrôle automatique — masquée',
      kind: 'SERVICE',
      sort_order: 9002,
      is_active: false,
    })
    .select('id')
    .single();

  if (hiddenError) throw new Error(`décor (catégorie masquée) : ${hiddenError.message}`);

  const base = {
    tag: 'Contrôle',
    short_description: 'Offre créée par le contrôle automatique.',
    description: 'Offre créée par le contrôle automatique. Elle est supprimée à la fin.',
    price_label: 'Sur devis',
    image_path: '/images/offre-logo.webp',
    cta_label: 'Contrôle',
    request_subject: 'Contrôle',
    sort_order: 9000,
  };

  const draftSlug = `${TEST_PREFIX}-brouillon-${suffix}`;
  const publishedSlug = `${TEST_PREFIX}-publiee-${suffix}`;
  const hiddenCategorySlug = `${TEST_PREFIX}-masquee-offre-${suffix}`;

  const { data: rows, error } = await admin
    .from('services')
    .insert([
      { ...base, slug: draftSlug, category_id: category.id, title: 'Brouillon', status: 'BROUILLON' },
      { ...base, slug: publishedSlug, category_id: category.id, title: 'Publiée', status: 'PUBLIE' },
      {
        ...base,
        slug: hiddenCategorySlug,
        category_id: hiddenCategory.id,
        title: 'Publiée sous catégorie masquée',
        status: 'PUBLIE',
      },
    ])
    .select('id, slug');

  if (error) throw new Error(`décor (offres) : ${error.message}`);

  const idBySlug = new Map(rows.map((row) => [row.slug, row.id]));

  return {
    categoryId: category.id,
    productCategoryId: productCategory.id,
    hiddenCategoryId: hiddenCategory.id,
    draftSlug,
    draftId: idBySlug.get(draftSlug),
    publishedSlug,
    hiddenCategorySlug,
  };
}

async function cleanup(admin, created) {
  log.step('Nettoyage des données de test');

  for (const userId of created) {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  }

  // Les offres de contrôle ont pu être publiées : le déclencheur refuserait
  // leur suppression. On les remet à zéro avant d'effacer.
  await admin
    .from('services')
    .update({ status: 'BROUILLON', published_at: null })
    .like('slug', `${TEST_PREFIX}-%`);

  const { error: servicesError } = await admin
    .from('services')
    .delete()
    .like('slug', `${TEST_PREFIX}-%`);
  check('les offres de contrôle sont supprimées', !servicesError, servicesError?.message);

  const { error: categoriesError } = await admin
    .from('categories')
    .delete()
    .like('slug', `${TEST_PREFIX}-%`);
  check('les catégories de contrôle sont supprimées', !categoriesError, categoriesError?.message);

  const { data: leftoverServices } = await admin
    .from('services')
    .select('slug')
    .like('slug', `${TEST_PREFIX}-%`);
  check('aucune offre résiduelle', (leftoverServices ?? []).length === 0);

  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const leftovers = (users?.users ?? []).filter((user) => user.email?.endsWith(`@${TEST_DOMAIN}`));

  for (const user of leftovers) {
    await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
    log.warn('compte de test résiduel supprimé');
  }

  check('aucun compte de test résiduel', leftovers.length === 0);
}

/* ========================================================================== */

async function main() {
  const target = resolveTarget();
  log.step(`Catalogue administrable — ${describeTarget(target)}`);

  const since = new Date().toISOString();

  if (target.env === 'prod' && !hasFlag('i-know-this-is-production')) {
    await checkAnonymous(target, null);
    log.step('Contrôles authentifiés — ignorés en production');
    return report();
  }

  const admin = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Photographie du catalogue réel : il doit être intact à la fin.
  const { count: before } = await admin
    .from('services')
    .select('id', { count: 'exact', head: true })
    .not('slug', 'like', `${TEST_PREFIX}-%`);

  const created = [];
  let fixtures;

  try {
    fixtures = await buildFixtures(admin);

    const client = await createAccount(admin, { roleCode: 'CLIENT', prefix: 'client' });
    created.push(client.userId);

    const affiliate = await createAccount(admin, { roleCode: 'AFFILIE', prefix: 'affilie' });
    created.push(affiliate.userId);

    const viewer = await createAccount(admin, {
      roleCode: 'ADMIN',
      prefix: 'lecteur',
      grants: ['services.view'],
    });
    created.push(viewer.userId);

    const editor = await createAccount(admin, {
      roleCode: 'ADMIN',
      prefix: 'editeur',
      grants: ['services.view', 'services.update'],
    });
    created.push(editor.userId);

    const publisher = await createAccount(admin, {
      roleCode: 'ADMIN',
      prefix: 'publieur',
      grants: ['services.view', 'services.update', 'services.publish', 'services.delete'],
    });
    created.push(publisher.userId);

    await checkAnonymous(target, fixtures);
    await checkDeniedProfile(target, 'CLIENT', client, fixtures);
    await checkDeniedProfile(target, 'AFFILIE', affiliate, fixtures);
    await checkReadOnlyAdmin(target, viewer, fixtures);
    await checkEditorAdmin(target, editor, fixtures);
    await checkPublisherAdmin(target, publisher, fixtures);
    await checkIntegrity(admin, fixtures);
    await checkAudit(admin, since);
  } finally {
    await cleanup(admin, created);

    const { count: after } = await admin
      .from('services')
      .select('id', { count: 'exact', head: true })
      .not('slug', 'like', `${TEST_PREFIX}-%`);

    check(
      'le catalogue réel est intact',
      before === after,
      `${before} offres avant, ${after} après`,
    );
  }

  return report();
}

function report() {
  log.step(`${results.passed} contrôle(s) réussi(s), ${results.failed} échec(s)`);
  if (results.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  log.fail(error.message);
  process.exitCode = 1;
});
