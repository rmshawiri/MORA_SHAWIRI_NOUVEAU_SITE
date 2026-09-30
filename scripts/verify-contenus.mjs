/**
 * Vérification des contenus contre la base réelle — phase 4E-2.
 *
 *   node scripts/verify-contenus.mjs --env shared
 *
 * ## Pourquoi ce script existe, et pourquoi il ne peut pas être remplacé
 *
 * Les tests unitaires lisent le SQL ; ils ne l'exécutent pas. Or le défaut le
 * plus grave de la phase 4E-1 — un garde de publication déclaré
 * `SECURITY DEFINER`, donc inopérant — se lisait **correctement** et
 * s'installait sans une erreur. Seule une exécution avec de vraies sessions l'a
 * révélé.
 *
 * Ce script éprouve donc chaque profil du point 24 du cadrage contre la vraie
 * base, avec de vrais comptes et de vraies permissions :
 *
 *   * visiteur anonyme · CLIENT · AFFILIE — ne voient que ce qui est publié ;
 *   * ADMIN `content.view` — voit tout, n'écrit rien ;
 *   * ADMIN `+ content.update` — modifie, **ne publie pas** ;
 *   * ADMIN `+ content.publish` — publie, dépublie, retire une surcharge ;
 *   * ADMIN `+ content.delete` — supprime un brouillon, pas un contenu publié ;
 *   * intégrité — les refus attendus des contraintes ;
 *   * audit — les écritures laissent une trace.
 *
 * ## Données de test
 *
 * Les comptes portent `@mora-shawiri.test`, les contenus un préfixe
 * `verif-contenus`. Tout est supprimé en fin d'exécution, et le script vérifie
 * ensuite que les contenus réels sont au même nombre qu'au départ.
 */

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { describeTarget, log, resolveTarget } from './lib/config.mjs';

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
const PREFIX = 'verif-contenus';
const PASSWORD = `Verif-4E2-${randomUUID()}`;

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

async function createAccount(admin, { roleCode, grants = [], label }) {
  const email = `${PREFIX}-${label}-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });

  if (error || !data.user) throw new Error(`création de ${label} : ${error?.message}`);
  const userId = data.user.id;

  const { data: role } = await admin.from('roles').select('id').eq('code', roleCode).maybeSingle();
  if (!role) throw new Error(`rôle ${roleCode} introuvable`);

  await admin.from('user_roles').insert({ user_id: userId, role_id: role.id });

  if (grants.length > 0) {
    const { data: permissions } = await admin
      .from('permissions')
      .select('id, code')
      .in('code', grants);

    if ((permissions ?? []).length !== grants.length) {
      throw new Error(`catalogue de permissions incomplet pour ${label}`);
    }

    const rows = permissions.map((row) => ({
      user_id: userId,
      permission_id: row.id,
      effect: 'OCTROI',
    }));

    const written = await admin
      .from('user_permissions')
      .upsert(rows, { onConflict: 'user_id,permission_id' });

    if (written.error) throw new Error(written.error.message);
  }

  return { userId, email };
}

/* ========================================================================== */
/*  Jeux d'essai                                                              */
/* ========================================================================== */

/**
 * Construit les contenus de contrôle : une catégorie de FAQ avec une question
 * publiée et une question en brouillon, un article publié et un article en
 * brouillon, un bloc surchargé.
 *
 * La clé du bloc est **réelle** (`accueil.methode`) : une clé inventée serait
 * ignorée par le rendu public, et le contrôle ne prouverait rien de la lecture.
 * Sa valeur d'origine est relue et restituée en fin d'exécution.
 */
async function buildFixtures(admin) {
  const created = { categoryId: null, itemIds: [], postIds: [], blockKey: null, blockBefore: null };

  const slug = `${PREFIX}-${randomUUID().slice(0, 8)}`;

  const { data: category, error: categoryError } = await admin
    .from('faq_categories')
    .insert({ slug, title: 'Catégorie de contrôle', surface: 'FAQ', sort_order: 9000 })
    .select('id')
    .single();

  if (categoryError) throw new Error(`catégorie de contrôle : ${categoryError.message}`);
  created.categoryId = category.id;

  const { data: items, error: itemsError } = await admin
    .from('faq_items')
    .insert([
      {
        category_id: category.id,
        question: `${PREFIX} question publiée`,
        answer: 'Réponse de contrôle.',
        sort_order: 10,
        status: 'PUBLIE',
      },
      {
        category_id: category.id,
        question: `${PREFIX} question en brouillon`,
        answer: 'Réponse de contrôle.',
        sort_order: 20,
        status: 'BROUILLON',
      },
    ])
    .select('id, status');

  if (itemsError) throw new Error(`questions de contrôle : ${itemsError.message}`);
  created.itemIds = items.map((item) => item.id);

  const body = [{ type: 'h2', text: 'Titre de contrôle' }];

  const { data: posts, error: postsError } = await admin
    .from('content_posts')
    .insert([
      {
        slug: `${slug}-publie`,
        category: 'Contrôle',
        title: 'Article publié de contrôle',
        lead: 'Accroche de contrôle.',
        excerpt: 'Résumé de contrôle.',
        published_on: '2026-09-30',
        date_label: '30 septembre 2026',
        reading_time: '1 min de lecture',
        cover_path: '/images/hero-accueil.webp',
        cover_width: 1536,
        cover_height: 1024,
        cta_title: 'Titre',
        cta_text: 'Texte',
        cta_label: 'Bouton',
        cta_href: '/contact/',
        body,
        sort_order: 9000,
        status: 'PUBLIE',
      },
      {
        slug: `${slug}-brouillon`,
        category: 'Contrôle',
        title: 'Article en brouillon de contrôle',
        lead: 'Accroche de contrôle.',
        excerpt: 'Résumé de contrôle.',
        body,
        sort_order: 9010,
        status: 'BROUILLON',
      },
    ])
    .select('id, slug, status');

  if (postsError) throw new Error(`articles de contrôle : ${postsError.message}`);
  created.postIds = posts.map((post) => post.id);
  created.postSlugs = Object.fromEntries(posts.map((post) => [post.status, post.slug]));
  created.postIdsByStatus = Object.fromEntries(posts.map((post) => [post.status, post.id]));

  // Bloc réel, dont on mémorise l'état d'avant pour le restituer.
  created.blockKey = 'accueil.methode';
  const { data: existing } = await admin
    .from('content_blocks')
    .select('id, published_fields, draft_fields')
    .eq('key', created.blockKey)
    .maybeSingle();

  created.blockBefore = existing ?? null;

  return created;
}

/* ========================================================================== */
/*  1. Le visiteur anonyme                                                    */
/* ========================================================================== */

async function checkAnonymous(target, fixtures) {
  log.step('Visiteur anonyme');

  const anon = sessionClient(target);

  const { data: items, error } = await anon.from('faq_items').select('question, status');
  check('la FAQ publiée est lisible sans session', !error && (items ?? []).length > 0, error?.message);
  check(
    'aucune question non publiée ne lui parvient',
    (items ?? []).every((item) => item.status === 'PUBLIE'),
  );

  // Le point 14 du cadrage : connaître l'identifiant d'un brouillon ne donne
  // rien. Ce n'est pas un masquage — la ligne n'existe pas pour cette session.
  const brouillon = fixtures.itemIds[1];
  const { data: direct } = await anon.from('faq_items').select('id').eq('id', brouillon);
  check('une question en brouillon reste invisible même par son identifiant', (direct ?? []).length === 0);

  const { data: posts } = await anon.from('content_posts').select('slug, status');
  check(
    'aucun article non publié ne lui parvient',
    (posts ?? []).every((post) => post.status === 'PUBLIE'),
  );

  const slugBrouillon = fixtures.postSlugs.BROUILLON;
  const { data: postDirect } = await anon
    .from('content_posts')
    .select('slug')
    .eq('slug', slugBrouillon);
  check('un article en brouillon reste invisible même par son slug', (postDirect ?? []).length === 0);

  // La médiathèque ne lui est pas ouverte du tout : ni privilège, ni politique.
  const medias = await anon.from('media_assets').select('path');
  check('la médiathèque est inatteignable sans session', refused(medias));

  const { data: blocks } = await anon.from('content_blocks').select('key, published_fields');
  check(
    'seules les surcharges publiées lui parviennent',
    (blocks ?? []).every((block) => block.published_fields !== null),
  );

  // Écritures : toutes refusées.
  check(
    'il n’écrit pas dans la FAQ',
    refused(await anon.from('faq_items').update({ answer: 'forcé' }).eq('id', fixtures.itemIds[0]).select('id')),
  );
  check(
    'il n’écrit pas dans les articles',
    refused(await anon.from('content_posts').update({ title: 'forcé' }).eq('id', fixtures.postIds[0]).select('id')),
  );
  check(
    'il ne crée aucun bloc',
    refused(
      await anon
        .from('content_blocks')
        .insert({ key: 'accueil.hero', kind: 'HERO', page_slug: 'accueil', draft_fields: {} })
        .select('id'),
    ),
  );
  check(
    'il ne crée aucun média',
    refused(
      await anon
        .from('media_assets')
        .insert({ kind: 'LOCAL', path: '/images/forge.webp', title: 'forge' })
        .select('id'),
    ),
  );
}

/* ========================================================================== */
/*  2. Un compte sans aucun droit sur les contenus                            */
/* ========================================================================== */

async function checkDeniedProfile(target, label, account, fixtures) {
  log.step(label);

  const client = await signIn(target, account.email);

  const { data: items } = await client.from('faq_items').select('status');
  check(
    `${label} — ne voit aucun brouillon`,
    (items ?? []).every((item) => item.status === 'PUBLIE'),
  );

  const { data: posts } = await client.from('content_posts').select('status');
  check(
    `${label} — ne voit aucun article non publié`,
    (posts ?? []).every((post) => post.status === 'PUBLIE'),
  );

  check(
    `${label} — ne modifie aucune question`,
    refused(
      await client.from('faq_items').update({ answer: 'forcé' }).eq('id', fixtures.itemIds[0]).select('id'),
    ),
  );
  check(
    `${label} — ne modifie aucun article`,
    refused(
      await client.from('content_posts').update({ title: 'forcé' }).eq('id', fixtures.postIds[0]).select('id'),
    ),
  );
  check(
    `${label} — ne publie rien`,
    refused(
      await client
        .from('faq_items')
        .update({ status: 'PUBLIE' })
        .eq('id', fixtures.itemIds[1])
        .select('id'),
    ),
  );
  check(
    `${label} — n’atteint pas la médiathèque`,
    refused(await client.from('media_assets').select('path')),
  );

  await client.auth.signOut();
}

/* ========================================================================== */
/*  3. ADMIN content.view — voit tout, n'écrit rien                           */
/* ========================================================================== */

async function checkReadOnlyAdmin(target, account, fixtures) {
  log.step('ADMIN — content.view seul');

  const client = await signIn(target, account.email);

  const { data: items } = await client.from('faq_items').select('id, status');
  check(
    'voit les questions en brouillon',
    (items ?? []).some((item) => item.id === fixtures.itemIds[1]),
  );

  const { data: posts } = await client.from('content_posts').select('id, status');
  check(
    'voit les articles en brouillon',
    (posts ?? []).some((post) => post.id === fixtures.postIdsByStatus.BROUILLON),
  );

  check(
    'ne modifie aucune question',
    refused(
      await client.from('faq_items').update({ answer: 'forcé' }).eq('id', fixtures.itemIds[0]).select('id'),
    ),
  );
  check(
    'ne publie aucune question',
    refused(
      await client.from('faq_items').update({ status: 'PUBLIE' }).eq('id', fixtures.itemIds[1]).select('id'),
    ),
  );
  check(
    'ne crée aucune question',
    refused(
      await client
        .from('faq_items')
        .insert({ category_id: fixtures.categoryId, question: 'forcée', answer: 'forcée' })
        .select('id'),
    ),
  );
  check(
    'voit la médiathèque (content.view suffit à consulter les visuels)',
    !(await client.from('media_assets').select('path')).error,
  );

  await client.auth.signOut();
}

/* ========================================================================== */
/*  4. ADMIN + content.update — modifie, ne publie pas                        */
/* ========================================================================== */

/**
 * C'est le contrôle central du point 13 du cadrage, et celui qui a révélé le
 * défaut `SECURITY DEFINER` en 4E-1. Il ne peut pas être remplacé par une
 * relecture : le garde s'installe sans erreur dans les deux cas.
 */
async function checkEditorAdmin(target, account, fixtures) {
  log.step('ADMIN — content.view + content.update');

  const client = await signIn(target, account.email);

  const modification = await client
    .from('faq_items')
    .update({ answer: 'Réponse corrigée par le contrôle.' })
    .eq('id', fixtures.itemIds[0])
    .select('id');

  check('modifie une réponse', !refused(modification), modification.error?.message);

  const publication = await client
    .from('faq_items')
    .update({ status: 'PUBLIE' })
    .eq('id', fixtures.itemIds[1])
    .select('id');

  check('NE PUBLIE PAS une question en brouillon', refused(publication));

  const depublication = await client
    .from('faq_items')
    .update({ status: 'NON_PUBLIE' })
    .eq('id', fixtures.itemIds[0])
    .select('id');

  check('NE DÉPUBLIE PAS une question publiée', refused(depublication));

  const articlePublication = await client
    .from('content_posts')
    .update({ status: 'PUBLIE' })
    .eq('id', fixtures.postIdsByStatus.BROUILLON)
    .select('id');

  check('NE PUBLIE PAS un article en brouillon', refused(articlePublication));

  // Un bloc : le brouillon passe, la surcharge publiée non.
  const brouillon = await client
    .from('content_blocks')
    .upsert(
      {
        key: fixtures.blockKey,
        kind: 'SECTION',
        page_slug: 'accueil',
        draft_fields: { eyebrow: 'Contrôle', title: 'Titre de contrôle' },
      },
      { onConflict: 'key' },
    )
    .select('id');

  check('enregistre un brouillon de bloc', !refused(brouillon), brouillon.error?.message);

  const miseEnLigne = await client
    .from('content_blocks')
    .update({ published_fields: { eyebrow: 'Contrôle', title: 'Forcé' } })
    .eq('key', fixtures.blockKey)
    .select('id');

  check('NE MET PAS un bloc en ligne', refused(miseEnLigne));

  await client.auth.signOut();
}

/* ========================================================================== */
/*  5. ADMIN + content.publish — publie et retire                             */
/* ========================================================================== */

async function checkPublisherAdmin(target, account, fixtures) {
  log.step('ADMIN — content.view + update + publish');

  const client = await signIn(target, account.email);

  const publication = await client
    .from('faq_items')
    .update({ status: 'PUBLIE' })
    .eq('id', fixtures.itemIds[1])
    .select('id, published_at');

  check('publie une question', !refused(publication), publication.error?.message);
  check(
    'l’horodatage de publication est posé par la base',
    Boolean(publication.data?.[0]?.published_at),
  );

  const retrait = await client
    .from('faq_items')
    .update({ status: 'NON_PUBLIE' })
    .eq('id', fixtures.itemIds[1])
    .select('id');

  check('retire une question du site', !refused(retrait), retrait.error?.message);

  const blocEnLigne = await client
    .from('content_blocks')
    .update({ published_fields: { eyebrow: 'Contrôle', title: 'Titre publié par le contrôle' } })
    .eq('key', fixtures.blockKey)
    .select('id, published_at');

  check('met un bloc en ligne', !refused(blocEnLigne), blocEnLigne.error?.message);
  check('l’horodatage du bloc est posé', Boolean(blocEnLigne.data?.[0]?.published_at));

  // Une question déjà publiée ne se supprime plus : elle s'archive.
  const suppression = await client.from('faq_items').delete().eq('id', fixtures.itemIds[0]).select('id');
  check('ne supprime plus une question déjà publiée', refused(suppression));

  await client.auth.signOut();
}

/* ========================================================================== */
/*  6. Le retrait d'une surcharge est un retrait public                       */
/* ========================================================================== */

/**
 * Le cas que le § 7 bis de la migration existe pour couvrir : revenir à la
 * valeur du code se fait en **supprimant** la ligne, et le garde de publication
 * ne voit pas les DELETE. Sans le second garde, un compte doté de
 * `content.delete` seul pourrait retirer un texte du site.
 */
async function checkRevertGuard(target, deleter, publisher, fixtures) {
  log.step('Retrait d’une surcharge — content.delete ne suffit pas');

  const withDelete = await signIn(target, deleter.email);

  const tentative = await withDelete
    .from('content_blocks')
    .delete()
    .eq('key', fixtures.blockKey)
    .select('id');

  check(
    'un compte sans content.publish ne retire pas une surcharge en ligne',
    refused(tentative),
    tentative.error?.message,
  );

  await withDelete.auth.signOut();

  const withPublish = await signIn(target, publisher.email);

  const retrait = await withPublish
    .from('content_blocks')
    .delete()
    .eq('key', fixtures.blockKey)
    .select('id');

  check('un compte avec content.publish le retire', !refused(retrait), retrait.error?.message);

  await withPublish.auth.signOut();
}

/* ========================================================================== */
/*  7. Intégrité — les refus attendus                                         */
/* ========================================================================== */

async function checkIntegrity(admin, fixtures) {
  log.step('Intégrité des contenus');

  const attempts = [
    [
      'une question publiée sans réponse est refusée',
      () =>
        admin
          .from('faq_items')
          .insert({
            category_id: fixtures.categoryId,
            question: `${PREFIX} sans réponse`,
            answer: '   ',
            status: 'PUBLIE',
          })
          .select('id'),
    ],
    [
      'un article publié sans corps est refusé',
      () =>
        admin
          .from('content_posts')
          .insert({
            slug: `${PREFIX}-sans-corps`,
            category: 'Contrôle',
            title: 'Titre',
            lead: 'Accroche',
            excerpt: 'Résumé',
            published_on: '2026-09-30',
            cover_path: '/images/hero-accueil.webp',
            body: [],
            status: 'PUBLIE',
          })
          .select('id'),
    ],
    [
      'un article publié sans visuel est refusé',
      () =>
        admin
          .from('content_posts')
          .insert({
            slug: `${PREFIX}-sans-visuel`,
            category: 'Contrôle',
            title: 'Titre',
            lead: 'Accroche',
            excerpt: 'Résumé',
            published_on: '2026-09-30',
            body: [{ type: 'h2', text: 'Titre' }],
            status: 'PUBLIE',
          })
          .select('id'),
    ],
    [
      'un slug d’article non normalisé est refusé',
      () =>
        admin
          .from('content_posts')
          .insert({
            slug: 'Slug Invalide',
            category: 'Contrôle',
            title: 'Titre',
            lead: 'Accroche',
            excerpt: 'Résumé',
          })
          .select('id'),
    ],
    [
      'un article qui se suggère lui-même est refusé',
      () =>
        admin
          .from('content_posts')
          .insert({
            slug: `${PREFIX}-boucle`,
            category: 'Contrôle',
            title: 'Titre',
            lead: 'Accroche',
            excerpt: 'Résumé',
            related: [`${PREFIX}-boucle`],
          })
          .select('id'),
    ],
    [
      'un statut hors des quatre prévus est refusé',
      () =>
        admin
          .from('faq_items')
          .insert({
            category_id: fixtures.categoryId,
            question: `${PREFIX} statut`,
            answer: 'Réponse',
            status: 'INVENTE',
          })
          .select('id'),
    ],
    [
      'une clé de bloc non normalisée est refusée',
      () =>
        admin
          .from('content_blocks')
          .insert({ key: 'Accueil Hero', kind: 'SECTION', page_slug: 'accueil', draft_fields: {} })
          .select('id'),
    ],
    [
      'un bloc sans surcharge ni brouillon est refusé',
      () =>
        admin
          .from('content_blocks')
          .insert({ key: `${PREFIX}-vide`, kind: 'SECTION', page_slug: 'accueil' })
          .select('id'),
    ],
    [
      'une liste rangée dans un bloc de texte est refusée',
      () =>
        admin
          .from('content_blocks')
          .insert({
            key: `${PREFIX}-forme`,
            kind: 'SECTION',
            page_slug: 'accueil',
            draft_fields: [1, 2, 3],
          })
          .select('id'),
    ],
    [
      'un média SVG est refusé',
      () =>
        admin
          .from('media_assets')
          .insert({
            kind: 'LOCAL',
            path: '/images/verif.svg',
            title: 'verif.svg',
            mime_type: 'image/svg+xml',
          })
          .select('id'),
    ],
    [
      'un chemin de média remontant l’arborescence est refusé',
      () =>
        admin
          .from('media_assets')
          .insert({ kind: 'STORAGE', bucket: 'contenus-medias', path: '../secret.webp', title: 'x' })
          .select('id'),
    ],
    [
      'un média dépassant 10 Mio est refusé',
      () =>
        admin
          .from('media_assets')
          .insert({
            kind: 'LOCAL',
            path: '/images/verif-lourd.webp',
            title: 'lourd',
            byte_size: 20 * 1024 * 1024,
          })
          .select('id'),
    ],
    [
      'une image décorative portant un texte alternatif est refusée',
      () =>
        admin
          .from('media_assets')
          .insert({
            kind: 'LOCAL',
            path: '/images/verif-deco.webp',
            title: 'deco',
            is_decorative: true,
            alt_text: 'Une description',
          })
          .select('id'),
    ],
    [
      'un média Storage sans bucket est refusé',
      () =>
        admin
          .from('media_assets')
          .insert({ kind: 'STORAGE', path: 'dossier/fichier.webp', title: 'x' })
          .select('id'),
    ],
  ];

  for (const [label, attempt] of attempts) {
    const result = await attempt();
    check(label, refused(result), refused(result) ? '' : 'l’écriture a été acceptée');
  }

  // Désactiver une catégorie portant des questions publiées.
  const desactivation = await admin
    .from('faq_categories')
    .update({ is_active: false })
    .eq('id', fixtures.categoryId)
    .select('id');

  check('désactiver une catégorie aux questions publiées est refusé', refused(desactivation));
}

/* ========================================================================== */
/*  8. Audit                                                                  */
/* ========================================================================== */

async function checkAudit(admin, since) {
  log.step('Journal d’audit');

  const { data, error } = await admin
    .from('audit_logs')
    .select('action, metadata')
    .gte('created_at', since)
    .like('action', 'contenus.%');

  if (error) {
    check('le journal est lisible', false, error.message);
    return;
  }

  const actions = new Set((data ?? []).map((row) => row.action));

  check('les créations de questions sont tracées', actions.has('contenus.faq_items.insert'));
  check('les modifications de questions sont tracées', actions.has('contenus.faq_items.update'));
  check('les écritures de blocs sont tracées', actions.has('contenus.content_blocks.insert') || actions.has('contenus.content_blocks.update'));
  check('les créations d’articles sont tracées', actions.has('contenus.content_posts.insert'));

  const avecStatut = (data ?? []).filter(
    (row) => row.action === 'contenus.faq_items.update' && row.metadata?.statut,
  );
  check('chaque trace de question porte son statut', avecStatut.length > 0);

  // Le journal reste maigre : il ne recopie pas le contenu éditorial.
  const reponsesRecopiees = (data ?? []).filter((row) =>
    JSON.stringify(row.metadata ?? {}).includes('Réponse corrigée par le contrôle.'),
  );
  check('le journal ne recopie pas le texte des réponses', reponsesRecopiees.length === 0);
}

/* ========================================================================== */
/*  Nettoyage                                                                 */
/* ========================================================================== */

async function cleanup(admin, fixtures, accounts) {
  log.step('Nettoyage des données de contrôle');

  // Les questions publiées ne se suppriment pas : on les repasse en brouillon
  // d'abord. La clé de service est privilégiée, donc le garde ne s'y oppose pas ;
  // mais `published_at` reste posé, et c'est lui que lit le garde de suppression.
  for (const id of fixtures.itemIds) {
    await admin.from('faq_items').update({ status: 'BROUILLON', published_at: null }).eq('id', id);
    await admin.from('faq_items').delete().eq('id', id);
  }

  await admin.from('faq_categories').delete().eq('id', fixtures.categoryId);

  for (const id of fixtures.postIds) {
    await admin.from('content_posts').update({ published_at: null }).eq('id', id);
    await admin.from('content_posts').delete().eq('id', id);
  }

  // Le bloc réel retrouve exactement son état d'avant le contrôle.
  await admin.from('content_blocks').delete().eq('key', fixtures.blockKey);
  if (fixtures.blockBefore) {
    await admin.from('content_blocks').insert({
      key: fixtures.blockKey,
      kind: 'SECTION',
      page_slug: 'accueil',
      published_fields: fixtures.blockBefore.published_fields,
      draft_fields: fixtures.blockBefore.draft_fields,
    });
  }

  await admin.from('media_assets').delete().like('path', '%verif-%');

  for (const account of accounts) {
    await admin.from('user_permissions').delete().eq('user_id', account.userId);
    await admin.from('user_roles').delete().eq('user_id', account.userId);
    await admin.auth.admin.deleteUser(account.userId);
  }

  log.ok('comptes et contenus de contrôle supprimés');
}

/* ========================================================================== */
/*  Exécution                                                                 */
/* ========================================================================== */

async function main() {
  const target = resolveTarget();
  log.step(`Vérification des contenus — ${describeTarget(target)}`);

  const admin = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const since = new Date(Date.now() - 60_000).toISOString();

  // Décomptes de départ : le contrôle doit les retrouver à l'identique.
  const before = {
    items: (await admin.from('faq_items').select('id', { count: 'exact', head: true })).count,
    posts: (await admin.from('content_posts').select('id', { count: 'exact', head: true })).count,
    medias: (await admin.from('media_assets').select('id', { count: 'exact', head: true })).count,
  };

  const fixtures = await buildFixtures(admin);
  const accounts = [];

  try {
    const client = await createAccount(admin, { roleCode: 'CLIENT', label: 'client' });
    const affilie = await createAccount(admin, { roleCode: 'AFFILIE', label: 'affilie' });
    const lecteur = await createAccount(admin, {
      roleCode: 'ADMIN',
      grants: ['content.view'],
      label: 'lecteur',
    });
    const redacteur = await createAccount(admin, {
      roleCode: 'ADMIN',
      grants: ['content.view', 'content.update'],
      label: 'redacteur',
    });
    const publieur = await createAccount(admin, {
      roleCode: 'ADMIN',
      grants: ['content.view', 'content.update', 'content.publish'],
      label: 'publieur',
    });
    const suppresseur = await createAccount(admin, {
      roleCode: 'ADMIN',
      grants: ['content.view', 'content.update', 'content.delete'],
      label: 'suppresseur',
    });

    accounts.push(client, affilie, lecteur, redacteur, publieur, suppresseur);

    await checkAnonymous(target, fixtures);
    await checkDeniedProfile(target, 'CLIENT', client, fixtures);
    await checkDeniedProfile(target, 'AFFILIE', affilie, fixtures);
    await checkReadOnlyAdmin(target, lecteur, fixtures);
    await checkEditorAdmin(target, redacteur, fixtures);
    await checkPublisherAdmin(target, publieur, fixtures);
    await checkRevertGuard(target, suppresseur, publieur, fixtures);
    await checkIntegrity(admin, fixtures);
    await checkAudit(admin, since);
  } finally {
    await cleanup(admin, fixtures, accounts);
  }

  const after = {
    items: (await admin.from('faq_items').select('id', { count: 'exact', head: true })).count,
    posts: (await admin.from('content_posts').select('id', { count: 'exact', head: true })).count,
    medias: (await admin.from('media_assets').select('id', { count: 'exact', head: true })).count,
  };

  log.step('Aucun résidu');
  check(`les questions réelles sont au même nombre (${before.items})`, before.items === after.items,
    `avant ${before.items}, après ${after.items}`);
  check(`les articles réels sont au même nombre (${before.posts})`, before.posts === after.posts,
    `avant ${before.posts}, après ${after.posts}`);
  check(`les médias réels sont au même nombre (${before.medias})`, before.medias === after.medias,
    `avant ${before.medias}, après ${after.medias}`);

  report();
}

function report() {
  log.step(`${results.passed} contrôle(s) réussi(s), ${results.failed} échec(s)`);
  if (results.failed > 0) process.exitCode = 1;
}

await main();
