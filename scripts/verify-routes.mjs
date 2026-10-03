/**
 * Vérification des parcours HTTP réels — gardes de route et non-régression.
 *
 *   node scripts/verify-routes.mjs --env shared --base http://localhost:3000
 *   node scripts/verify-routes.mjs --env shared --base https://…vercel.app
 *
 * Ce script interroge le site comme le ferait un navigateur, et surtout comme
 * le ferait quelqu'un qui saisit une adresse d'administration directement. Il
 * répond à la question que le § 8 du cadrage pose sans détour : **peut-on
 * contourner le second facteur par une URL directe ?**
 *
 * ## Comment une session est fabriquée
 *
 * Les parcours de connexion passent par des actions serveur, qu'un script ne
 * peut pas déclencher comme un formulaire. La session est donc obtenue par le
 * client Supabase, puis transcrite dans le cookie que `@supabase/ssr` attend :
 * `base64-` suivi de la session encodée, découpée en tranches de 3 180
 * caractères au-delà de cette taille. Le serveur ne fait aucune différence
 * entre cette session et celle qu'il aurait écrite lui-même — c'est justement
 * ce qui rend le contrôle probant.
 *
 * ## Comptes utilisés
 *
 * Deux comptes temporaires portant le domaine réservé `@mora-shawiri.test` :
 * un client et un administrateur. Ils sont supprimés dans un bloc `finally`,
 * et un balayage final vérifie qu'aucun résidu ne subsiste. Aucun compte réel
 * n'est modifié.
 */

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { describeTarget, log, readFlag, resolveAccessToken, resolveTarget, runSql } from './lib/config.mjs';
import { totpCode, waitForFreshWindow } from './lib/totp.mjs';

const TEST_EMAIL_DOMAIN = '@mora-shawiri.test';
const MAX_CHUNK = 3180;

const results = { passed: 0, failed: 0 };

/** Instant de départ : sert à ne supprimer que les compteurs créés par ce contrôle. */
const startedAt = new Date().toISOString();

function check(label, condition, detail = '') {
  if (condition) {
    results.passed += 1;
    log.ok(label);
  } else {
    results.failed += 1;
    log.fail(`${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/* -------------------------------------------------------------- cookies --- */

function storageKeyFor(url) {
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
}

/**
 * Transcrit une session Supabase dans le ou les cookies attendus par
 * `@supabase/ssr`. La valeur est de l'ASCII (base64url) : sa longueur encodée
 * est donc égale à sa longueur brute, et le découpage se fait simplement.
 */
function sessionCookieHeader(storageKey, session) {
  const value = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;

  if (value.length <= MAX_CHUNK) return `${storageKey}=${value}`;

  const parts = [];
  for (let index = 0; index * MAX_CHUNK < value.length; index += 1) {
    parts.push(`${storageKey}.${index}=${value.slice(index * MAX_CHUNK, (index + 1) * MAX_CHUNK)}`);
  }

  return parts.join('; ');
}

/* ---------------------------------------------------------------- HTTP --- */

async function visit(base, path, cookie) {
  const response = await fetch(`${base}${path}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  });

  return {
    status: response.status,
    location: response.headers.get('location'),
    body: response.status === 200 ? await response.text() : '',
  };
}

/** Compare une destination de redirection, quelle que soit sa forme. */
function redirectsTo(result, expectedPath) {
  if (result.status < 300 || result.status >= 400) return false;
  if (!result.location) return false;

  const path = result.location.startsWith('http')
    ? new URL(result.location).pathname + new URL(result.location).search
    : result.location;

  return path.startsWith(expectedPath);
}

/* ============================================================ 1. anonyme === */

async function anonymousRoutes(base) {
  log.step('1. Visiteur non connecté');

  const publicPages = [
    '/',
    '/services/',
    '/boutique/',
    '/affiliation/',
    '/affiliation/inscription/',
    '/qui-sommes-nous/',
    '/faq/',
    '/contact/',
    '/blog/',
    '/rendez-vous/',
    '/formation-prospection-relation-client/',
    '/mentions-legales/',
    '/politique-de-confidentialite/',
    '/politique-de-cookies/',
    '/conditions-generales/',
  ];

  for (const page of publicPages) {
    const result = await visit(base, page);
    check(`page publique ${page}`, result.status === 200, `HTTP ${result.status}`);
  }

  const authPages = [
    '/connexion/',
    '/inscription/',
    '/mot-de-passe-oublie/',
    '/reinitialiser-mot-de-passe/',
  ];

  for (const page of authPages) {
    const result = await visit(base, page);
    check(`page d’authentification ${page}`, result.status === 200, `HTTP ${result.status}`);
  }

  // Le cœur du contrôle : aucune route privée n'est servie sans session.
  const privatePages = [
    '/espace-client/',
    '/administration/',
    '/changer-mot-de-passe/',
    '/securite/double-facteur/',
    '/connexion/verification/',
    // Phase 4G : la fiche d'une commande et les deux modules commerce.
    '/espace-client/commandes/MORA-CMCL-A0001/',
    '/administration/commandes/',
    '/administration/paiements/',
  ];

  for (const page of privatePages) {
    const result = await visit(base, page);
    check(
      `route privée ${page} refusée sans session`,
      redirectsTo(result, '/connexion/'),
      `HTTP ${result.status} → ${result.location}`,
    );
  }

  /*
   * Le justificatif de paiement — phase 4G.
   *
   * Le bucket est privé ; cette route est la seule porte, et elle ne signe une
   * URL qu'après que la base a autorisé la lecture. Sans session, il n'y a
   * rien à autoriser. Le refus est un 404 et non un 403 : le § 102 demande de
   * ne pas révéler ce qui existe, et un 403 confirmerait à un curieux qu'il a
   * deviné juste.
   */
  const proof = await visit(base, '/api/justificatifs/11111111-2222-3333-4444-555555555555/');
  check(
    'un justificatif est introuvable sans session',
    proof.status === 404,
    `HTTP ${proof.status}`,
  );

  const malformed = await visit(base, '/api/justificatifs/pas-un-identifiant/');
  check(
    'un identifiant de justificatif mal formé est refusé sans interroger la base',
    malformed.status === 404,
    `HTTP ${malformed.status}`,
  );

  const callback = await visit(base, '/auth/callback/');
  check(
    'la route d’échange refuse un appel sans preuve',
    redirectsTo(callback, '/connexion/'),
    `HTTP ${callback.status} → ${callback.location}`,
  );

  const robots = await visit(base, '/robots.txt');
  const disallowed = ['/administration/', '/espace-client/', '/connexion/', '/auth/'];
  check(
    'robots.txt exclut les espaces privés de l’exploration',
    disallowed.every((path) => robots.body.includes(path)),
  );

  const sitemap = await visit(base, '/sitemap.xml');
  check(
    'le plan de site ne référence aucune page de compte',
    // Les pages de compte sont à la racine du site. `/affiliation/inscription/`
    // (phase 4H) est une page publique de candidature, pas une page de compte :
    // la règle vise donc le premier segment du chemin, et lui seul.
    !/<loc>https?:\/\/[^/<]+\/(connexion|inscription|espace-client|administration|securite)\//.test(sitemap.body),
  );
}

/* ================================================ 2. non-régression visuelle */

async function publicIntegrity(base) {
  log.step('2. Non-régression du site public');

  const home = await visit(base, '/');

  check('l’en-tête est présent', home.body.includes('class="site-header"'));
  check('le pied de page est présent', home.body.includes('site-footer'));
  /**
   * L'en-tête portait jusqu'ici l'exigence inverse : « aucun lien de compte ».
   * Elle datait de la phase 4B, où l'authentification venait d'être livrée et
   * où le site public devait rester rigoureusement gelé.
   *
   * Le propriétaire a tranché autrement lors de son contrôle visuel après la
   * phase 4G : l'authentification existait sans qu'aucune porte ne la désigne,
   * et il a demandé un accès explicite — c'est la seule exception accordée au
   * gel de l'en-tête. Le contrôle est donc retourné : ce qui était interdit
   * devient exigé, et rien d'autre ne change dans la barre.
   */
  check(
    'l’en-tête propose la connexion',
    /site-header[\s\S]*?\/connexion\//.test(home.body),
  );
  check(
    'l’en-tête propose la création de compte',
    /site-header[\s\S]*?\/inscription\//.test(home.body),
  );
  check(
    'les deux appels à l’action du site sont intacts',
    home.body.includes('Devis gratuit') && home.body.includes('Prendre rendez-vous'),
  );

  const affiliation = await visit(base, '/affiliation/');
  check('la page Affiliation répond', affiliation.status === 200);
  for (const rate of ['10', '12', '15']) {
    check(`le taux ${rate} % figure toujours sur la page Affiliation`, affiliation.body.includes(`${rate}`));
  }
  // Phase 4H : les trois appels à l'inscription ouvrent la candidature.
  const toInscription = (affiliation.body.match(/href="\/affiliation\/inscription\/"/g) ?? []).length;
  check('les trois CTA d’inscription ouvrent /affiliation/inscription/', toInscription === 3, String(toInscription));
  const inscription = await visit(base, '/affiliation/inscription/');
  check('la page de candidature répond', inscription.status === 200);
  check(
    'la candidature ne propose aucune catégorie interne',
    !/Équipe MORA Shawiri|Recruté MORA Shawiri/.test(inscription.body),
  );

  // La feuille du site public ne doit pas embarquer les styles de compte.
  const styleLinks = [...home.body.matchAll(/href="([^"]*\.css)"/g)].map((match) => match[1]);
  check(
    'l’accueil ne charge qu’une seule feuille de style',
    new Set(styleLinks).size === 1,
    styleLinks.join(', '),
  );

  const connexion = await visit(base, '/connexion/');
  const authStyles = [...connexion.body.matchAll(/href="([^"]*\.css)"/g)].map((match) => match[1]);
  check(
    'la page de connexion charge la feuille dédiée en plus de la feuille commune',
    new Set(authStyles).size === 2,
    authStyles.join(', '),
  );

  const contact = await fetch(`${base}/api/contact/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'devis' }),
  });
  check(
    'la route de contact valide toujours ses champs, sans envoyer d’e-mail',
    contact.status === 400,
    `HTTP ${contact.status}`,
  );
}

/* ============================================ 3. sessions réelles et gardes */

async function sessionRoutes(target, base) {
  log.step('3. Gardes de route avec des sessions réelles');

  const service = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const storageKey = storageKeyFor(target.url);
  const suffix = randomUUID().slice(0, 8);

  const accounts = {
    client: { email: `test.route.client.${suffix}${TEST_EMAIL_DOMAIN}`, id: null },
    admin: { email: `test.route.admin.${suffix}${TEST_EMAIL_DOMAIN}`, id: null },
  };

  const password = `Tst-${randomUUID()}`;

  try {
    const roles = await service.from('roles').select('id, code');
    const byCode = new Map((roles.data ?? []).map((row) => [row.code, row.id]));

    for (const [kind, account] of Object.entries(accounts)) {
      const created = await service.auth.admin.createUser({
        email: account.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: `Compte de test ${kind}` },
      });

      if (created.error) throw new Error(created.error.message);
      account.id = created.data.user.id;

      await service
        .from('user_roles')
        .insert({ user_id: account.id, role_id: byCode.get(kind === 'admin' ? 'ADMIN' : 'CLIENT') });
    }

    /* --- Un client n'apprend même pas que l'administration existe --------- */

    const clientAuth = createClient(target.url, target.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const clientSignIn = await clientAuth.auth.signInWithPassword({
      email: accounts.client.email,
      password,
    });
    if (clientSignIn.error) throw new Error(clientSignIn.error.message);

    const clientCookie = sessionCookieHeader(storageKey, clientSignIn.data.session);

    const clientArea = await visit(base, '/espace-client/', clientCookie);
    check('un client accède à son espace', clientArea.status === 200, `HTTP ${clientArea.status}`);
    check(
      'son espace affiche bien son compte',
      clientArea.body.includes('Compte de test client'),
    );

    const clientOnAdmin = await visit(base, '/administration/', clientCookie);
    check(
      'un client ne découvre pas l’administration : la page est introuvable',
      clientOnAdmin.status === 404,
      `HTTP ${clientOnAdmin.status} → ${clientOnAdmin.location}`,
    );

    /* --- Administrateur sans facteur : l'administration reste fermée ------ */

    const adminAuth = createClient(target.url, target.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const adminSignIn = await adminAuth.auth.signInWithPassword({
      email: accounts.admin.email,
      password,
    });
    if (adminSignIn.error) throw new Error(adminSignIn.error.message);

    let adminCookie = sessionCookieHeader(storageKey, adminSignIn.data.session);

    // Décision du 1er octobre 2026 : identifiant ou e-mail + mot de passe
    // suffisent. Aucun enrôlement ni code n'est imposé.
    const noFactor = await visit(base, '/administration/', adminCookie);
    check(
      'un administrateur sans second facteur entre directement dans l’administration',
      noFactor.status === 200 && noFactor.body.includes('admin__grid'),
      `HTTP ${noFactor.status} → ${noFactor.location}`,
    );

    const enrolPage = await visit(base, '/securite/double-facteur/', adminCookie);
    check(
      'la page d’enrôlement est accessible en AAL1 tant qu’aucun facteur n’existe',
      enrolPage.status === 200,
      `HTTP ${enrolPage.status}`,
    );
    check(
      'elle ne présente plus l’enrôlement comme obligatoire',
      !enrolPage.body.includes('Cette étape est obligatoire'),
    );

    /* --- Enrôlement réel, puis session AAL1 sur un compte protégé --------- */

    const enrol = await adminAuth.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Test route' });
    if (enrol.error) throw new Error(enrol.error.message);

    await waitForFreshWindow();

    const verified = await adminAuth.auth.mfa.challengeAndVerify({
      factorId: enrol.data.id,
      code: totpCode(enrol.data.totp.secret),
    });
    if (verified.error) throw new Error(verified.error.message);

    // Session AAL2 : l'administration doit s'ouvrir.
    const aal2Session = (await adminAuth.auth.getSession()).data.session;
    const aal2Cookie = sessionCookieHeader(storageKey, aal2Session);

    const withAal2 = await visit(base, '/administration/', aal2Cookie);
    check(
      'un administrateur en AAL2 accède à l’administration',
      withAal2.status === 200,
      `HTTP ${withAal2.status} → ${withAal2.location}`,
    );
    check('le tableau de bord confirme le niveau AAL2', withAal2.body.includes('AAL2'));

    /**
     * Séparation du site public et de l'espace de pilotage.
     *
     * Jusqu'au contrôle visuel qui a suivi la phase 4G, l'administration
     * héritait de l'habillage vitrine posé par le gabarit racine : barre de
     * navigation publique, pied de page de huit colonnes, et pastille
     * « Écrire sur WhatsApp » flottant par-dessus les écrans de travail. Pire,
     * l'en-tête public est `position: fixed` et recouvrait le haut de chaque
     * page d'administration.
     *
     * Ces trois contrôles portent sur le HTML réellement servi. Ils sont la
     * garantie qu'aucune phase suivante ne remettra l'habillage public dans le
     * back-office sans s'en apercevoir.
     */
    check(
      'l’administration ne rend pas l’en-tête public',
      !withAal2.body.includes('class="site-header"'),
    );
    check(
      'l’administration ne rend pas le pied de page public',
      !withAal2.body.includes('class="site-footer"'),
    );
    check(
      'l’administration ne rend pas la pastille WhatsApp publique',
      !withAal2.body.includes('class="dock"'),
    );
    // Et rien de tout cela ne voyage non plus dans la charge utile : le refus
    // par `notFound()` est fréquent dans l'administration, et il doit rester
    // dans l'espace de pilotage. Voir `(pilotage)/not-found.tsx`.
    /**
     * Réserve connue, et assumée.
     *
     * La charge utile d'une page d'administration contient encore le balisage
     * de la **404 globale** du site, en-tête et pied de page compris : Next.js
     * embarque cette limite dans chaque route, et elle doit continuer de
     * porter l'habillage public puisqu'elle répond aussi aux adresses
     * inexistantes du site vitrine. Ce balisage n'est jamais rendu — les trois
     * contrôles ci-dessus le vérifient sur le document servi — et un refus
     * survenu dans l'administration affiche désormais sa propre page
     * introuvable, dans la coquille de pilotage.
     */
    check(
      'l’administration rend sa propre coquille',
      withAal2.body.includes('admin__grid') && withAal2.body.includes('admin-topbar'),
    );

    /* ================================================================== */
    /*  Phase 4C — les permissions décident module par module              */
    /* ================================================================== */

    log.step('3 ter. Permissions effectives, par URL directe');

    /** Pose ou retire un ajustement individuel sur le compte administrateur. */
    const adjust = async (code, effect) => {
      const { data: permission } = await service
        .from('permissions')
        .select('id')
        .eq('code', code)
        .maybeSingle();

      if (!permission) throw new Error(`permission ${code} introuvable`);

      if (effect === null) {
        await service
          .from('user_permissions')
          .delete()
          .eq('user_id', accounts.admin.id)
          .eq('permission_id', permission.id);
        return;
      }

      await service
        .from('user_permissions')
        .upsert(
          { user_id: accounts.admin.id, permission_id: permission.id, effect },
          { onConflict: 'user_id,permission_id' },
        );
    };

    // --- Aucun droit : seul le tableau de bord s'ouvre ----------------------

    const closedModules = [
      ['/administration/commandes/', 'Commandes'],
      ['/administration/paiements/', 'Paiements'],
      ['/administration/clients/', 'Clients'],
      ['/administration/parametres/', 'Paramètres'],
      ['/administration/administrateurs/', 'Administrateurs'],
      ['/administration/journal/', 'Journal'],
      ['/administration/catalogue/', 'Catalogue'],
      ['/administration/contenus/', 'Contenus'],
      ['/administration/demandes/', 'Demandes et devis'],
      ['/administration/rendez-vous/', 'Rendez-vous'],
    ];

    for (const [path, label] of closedModules) {
      const response = await visit(base, path, aal2Cookie);
      check(
        `sans permission, ${label} est introuvable par URL directe`,
        response.status === 404,
        `HTTP ${response.status}`,
      );
    }

    /**
     * Le refus de permission est le chemin le plus fréquent de
     * l'administration — le § 102 en fait la réponse normale à un module
     * fermé. Il ne doit pas faire sortir de l'espace de pilotage pour
     * retomber sur la 404 du site vitrine, en-tête, pied de page et bouton
     * WhatsApp compris. Voir `(pilotage)/administration/not-found.tsx`.
     *
     * `visit()` ne lit le corps que d'une réponse 200 : cette page-ci répond
     * 404 par construction, elle est donc relue ici.
     */
    const refus = await fetch(`${base}/administration/commandes/`, {
      redirect: 'manual',
      headers: { cookie: aal2Cookie },
    });
    const corpsRefus = await refus.text();

    check(
      'un refus de permission reste dans l’espace de pilotage',
      corpsRefus.includes('admin-seule') &&
        !corpsRefus.includes('class="site-header"') &&
        !corpsRefus.includes('class="site-footer"') &&
        !corpsRefus.includes('class="dock"'),
    );

    const unknownRoute = await visit(base, '/administration/module-inexistant/', aal2Cookie);
    check(
      'une route d’administration inexistante répond 404',
      unknownRoute.status === 404,
      `HTTP ${unknownRoute.status}`,
    );

    // La barre latérale ne propose rien de ce qui est fermé.
    check(
      'la navigation ne propose aucun module fermé',
      !withAal2.body.includes('/administration/commandes/') &&
        !withAal2.body.includes('/administration/journal/'),
    );

    check(
      'l’administration charge sa feuille de style dédiée',
      [...withAal2.body.matchAll(/href="([^"]*\.css)"/g)].length >= 2,
    );

    // --- Un octroi ouvre son module, et lui seul ---------------------------

    await adjust('orders.view', 'OCTROI');

    const commandes = await visit(base, '/administration/commandes/', aal2Cookie);
    check(
      'un octroi de orders.view ouvre le module Commandes',
      commandes.status === 200,
      `HTTP ${commandes.status}`,
    );
    /*
     * Jusqu'à la phase 4G, ce contrôle vérifiait que le module affichait
     * « Module à construire ». Il le faisait pour une bonne raison — le § 171
     * du tableau de bord interdit de simuler une fonctionnalité absente — mais
     * la fonctionnalité n'est plus absente : 4G l'a livrée.
     *
     * Ce qu'il faut vérifier reste le même au fond : que l'écran dise l'état
     * **réel** de la base. Sans commande enregistrée, il l'annonce au lieu
     * d'afficher un tableau de démonstration.
     */
    check(
      'le module ouvert affiche l’écran des commandes',
      commandes.body.includes('Commandes') && !commandes.body.includes('Module à construire'),
    );
    check(
      'l’écran des commandes n’invente aucune donnée',
      commandes.body.includes('Aucune commande enregistrée') ||
        commandes.body.includes('commande(s) enregistrée(s)'),
    );

    const paiements = await visit(base, '/administration/paiements/', aal2Cookie);
    check(
      'orders.view n’ouvre pas les Paiements',
      paiements.status === 404,
      `HTTP ${paiements.status}`,
    );

    const dashboardWithOrders = await visit(base, '/administration/', aal2Cookie);
    check(
      'la navigation propose désormais les Commandes',
      dashboardWithOrders.body.includes('/administration/commandes/'),
    );
    check(
      'la navigation ne propose toujours pas les Paiements',
      !dashboardWithOrders.body.includes('/administration/paiements/'),
    );

    // --- Un retrait referme le module --------------------------------------

    await adjust('orders.view', 'RETRAIT');

    const afterRevoke = await visit(base, '/administration/commandes/', aal2Cookie);
    check(
      'un retrait individuel referme le module, session inchangée',
      afterRevoke.status === 404,
      `HTTP ${afterRevoke.status}`,
    );

    // --- Relation client : deux modules, deux permissions (phase 4F) -------

    await adjust('orders.view', null);
    await adjust('quotes.view', 'OCTROI');

    const demandes = await visit(base, '/administration/demandes/', aal2Cookie);
    check(
      'quotes.view ouvre le module Demandes et devis',
      demandes.status === 200,
      `HTTP ${demandes.status}`,
    );
    check(
      'le module annonce l’état réel de la base, sans donnée inventée',
      demandes.body.includes('Aucune demande enregistrée') ||
        demandes.body.includes('demande(s) enregistrée(s)'),
    );
    check(
      'sans quotes.manage, le module le dit plutôt que de proposer un bouton',
      demandes.body.includes('quotes.manage'),
    );

    const rendezVousSansDroit = await visit(base, '/administration/rendez-vous/', aal2Cookie);
    check(
      'quotes.view n’ouvre pas les Rendez-vous',
      rendezVousSansDroit.status === 404,
      `HTTP ${rendezVousSansDroit.status}`,
    );

    // Test IDOR : une référence inexistante — ou hors de portée — rend la même
    // réponse qu'une route inconnue. Elle n'apprend pas qu'une fiche existe.
    const fantome = await visit(base, '/administration/demandes/MORA-DMCL-Z9999/', aal2Cookie);
    check(
      'une référence de demande inexistante répond 404',
      fantome.status === 404,
      `HTTP ${fantome.status}`,
    );

    await adjust('quotes.view', null);
    await adjust('appointments.view', 'OCTROI');

    const rendezVous = await visit(base, '/administration/rendez-vous/', aal2Cookie);
    check(
      'appointments.view ouvre le module Rendez-vous',
      rendezVous.status === 200,
      `HTTP ${rendezVous.status}`,
    );
    check(
      'les disponibilités sont annoncées vides tant que rien n’est déclaré',
      rendezVous.body.includes('Aucune disponibilité déclarée') ||
        rendezVous.body.includes('Nature'),
    );
    check(
      'sans appointments.manage, la déclaration de disponibilité n’est pas servie',
      !rendezVous.body.includes('Ajouter la disponibilité'),
      'le formulaire ne doit pas figurer dans le HTML',
    );

    const ficheFantome = await visit(
      base,
      '/administration/rendez-vous/00000000-0000-4000-8000-000000000000/',
      aal2Cookie,
    );
    check(
      'un identifiant de rendez-vous inexistant répond 404',
      ficheFantome.status === 404,
      `HTTP ${ficheFantome.status}`,
    );

    const demandesSansDroit = await visit(base, '/administration/demandes/', aal2Cookie);
    check(
      'appointments.view n’ouvre pas les Demandes',
      demandesSansDroit.status === 404,
      `HTTP ${demandesSansDroit.status}`,
    );

    await adjust('appointments.view', null);

    // --- Les modules système exigent leur propre permission ----------------

    await adjust('admins.view', 'OCTROI');

    const administrateurs = await visit(base, '/administration/administrateurs/', aal2Cookie);
    check(
      'admins.view ouvre le module Administrateurs',
      administrateurs.status === 200,
      `HTTP ${administrateurs.status}`,
    );
    check(
      'la liste des administrateurs est rendue',
      administrateurs.body.includes('Comptes administratifs'),
    );
    check(
      'sans admins.create, le formulaire d’invitation n’est pas servi',
      !administrateurs.body.includes('Envoyer l’invitation'),
      'le formulaire ne doit pas figurer dans le HTML',
    );

    const journalSansDroit = await visit(base, '/administration/journal/', aal2Cookie);
    check(
      'admins.view n’ouvre pas le Journal d’activité',
      journalSansDroit.status === 404,
      `HTTP ${journalSansDroit.status}`,
    );

    await adjust('audit.view', 'OCTROI');

    const journal = await visit(base, '/administration/journal/', aal2Cookie);
    check(
      'audit.view ouvre le Journal d’activité',
      journal.status === 200,
      `HTTP ${journal.status}`,
    );

    // --- Le Catalogue, livré par la phase 4E --------------------------------
    //
    // Le module réunit plusieurs permissions, et c'est ce qui rend le contrôle
    // intéressant : ouvrir la page ne donne pas le droit d'écrire, et le droit
    // d'écrire ne donne pas celui de publier. On vérifie les trois paliers par
    // l'URL, puisque c'est par là qu'on les contournerait.

    await adjust('admins.view', null);
    await adjust('audit.view', null);
    await adjust('services.view', 'OCTROI');

    const catalogue = await visit(base, '/administration/catalogue/', aal2Cookie);
    check(
      'services.view ouvre le module Catalogue',
      catalogue.status === 200,
      `HTTP ${catalogue.status}`,
    );
    check('le catalogue liste les offres réelles', catalogue.body.includes('Offres'));
    check(
      'les quatorze prestations sont servies depuis la base',
      catalogue.body.includes('Création de logo professionnel'),
    );
    check(
      'sans services.create, le formulaire de création n’est pas servi',
      !catalogue.body.includes('Créer le brouillon'),
      'le formulaire ne doit pas figurer dans le HTML',
    );

    const fiche = await visit(base, '/administration/catalogue/logo/', aal2Cookie);
    check(
      'la fiche d’une offre s’ouvre avec services.view',
      fiche.status === 200,
      `HTTP ${fiche.status}`,
    );
    check(
      'sans services.publish, aucun bouton de publication n’est servi',
      !fiche.body.includes('Retirer du site'),
    );
    check(
      'la fiche explique le droit manquant plutôt que de se taire',
      fiche.body.includes('services.publish'),
    );

    const inconnue = await visit(base, '/administration/catalogue/offre-inexistante/', aal2Cookie);
    check(
      'une offre inexistante répond 404',
      inconnue.status === 404,
      `HTTP ${inconnue.status}`,
    );

    await adjust('services.create', 'OCTROI');

    const avecCreation = await visit(base, '/administration/catalogue/', aal2Cookie);
    check(
      'services.create fait apparaître le formulaire de création',
      avecCreation.body.includes('Créer le brouillon'),
    );

    await adjust('services.publish', 'OCTROI');

    const avecPublication = await visit(base, '/administration/catalogue/logo/', aal2Cookie);
    check(
      'services.publish fait apparaître le retrait du site',
      avecPublication.body.includes('Retirer du site'),
    );

    await adjust('services.view', null);
    await adjust('services.create', null);
    await adjust('services.publish', null);

    const catalogueFerme = await visit(base, '/administration/catalogue/', aal2Cookie);
    check(
      'le retrait des octrois referme le Catalogue',
      catalogueFerme.status === 404,
      `HTTP ${catalogueFerme.status}`,
    );

    const ficheFermee = await visit(base, '/administration/catalogue/logo/', aal2Cookie);
    check(
      'la fiche d’offre se referme elle aussi',
      ficheFermee.status === 404,
      `HTTP ${ficheFermee.status}`,
    );

    // --- Les Contenus, livrés par la phase 4E-2 -----------------------------
    //
    // Même logique de paliers que le Catalogue, et le même point d'attention :
    // ouvrir la page ne donne pas le droit d'écrire, écrire ne donne pas le
    // droit de publier. Le contrôle passe par l'URL, puisque c'est par là qu'on
    // contournerait un bouton masqué.

    await adjust('content.view', 'OCTROI');

    const contenus = await visit(base, '/administration/contenus/', aal2Cookie);
    check(
      'content.view ouvre le module Contenus',
      contenus.status === 200,
      `HTTP ${contenus.status}`,
    );
    check(
      'les emplacements de texte sont listés depuis le registre',
      contenus.body.includes('Textes du site'),
    );
    check(
      'la FAQ reprise est servie depuis la base',
      contenus.body.includes('Questions de la page d’accueil'),
    );
    check(
      'les articles repris sont servis depuis la base',
      contenus.body.includes('echec-prospection-client'),
    );
    check(
      'la médiathèque inventoriée est servie depuis la base',
      contenus.body.includes('offre-logo.webp'),
    );

    const bloc = await visit(base, '/administration/contenus/bloc/accueil/hero/', aal2Cookie);
    check(
      'la fiche d’un bloc s’ouvre avec content.view',
      bloc.status === 200,
      `HTTP ${bloc.status}`,
    );
    check(
      'sans content.publish, aucun bouton de publication n’est servi',
      !bloc.body.includes('Rétablir le texte d’origine'),
    );
    check(
      'la fiche de bloc nomme le droit manquant plutôt que de se taire',
      bloc.body.includes('content.publish'),
    );

    const blocInconnu = await visit(
      base,
      '/administration/contenus/bloc/accueil/inexistant/',
      aal2Cookie,
    );
    check(
      'une clé de bloc absente du registre répond 404',
      blocInconnu.status === 404,
      `HTTP ${blocInconnu.status}`,
    );

    const articleInconnu = await visit(
      base,
      '/administration/contenus/article/article-inexistant/',
      aal2Cookie,
    );
    check(
      'un article inexistant répond 404',
      articleInconnu.status === 404,
      `HTTP ${articleInconnu.status}`,
    );

    await adjust('content.publish', 'OCTROI');

    const blocAvecPublication = await visit(
      base,
      '/administration/contenus/bloc/accueil/hero/',
      aal2Cookie,
    );
    // Le contrôle porte sur la **disparition de l'avertissement**, et non sur
    // l'apparition d'un bouton : ce bloc n'a ni surcharge ni brouillon, donc
    // aucune transition n'a lieu d'être proposée. Une première version de ce
    // contrôle cherchait le bouton et échouait pour cette raison — alors que le
    // comportement était correct.
    check(
      'content.publish fait disparaître l’avertissement de publication',
      !blocAvecPublication.body.includes(
        'La mise en ligne et le retrait exigent la permission',
      ),
    );
    check(
      'la fiche continue d’annoncer content.update, toujours manquant',
      blocAvecPublication.body.includes('content.update'),
    );

    await adjust('content.view', null);
    await adjust('content.publish', null);

    const contenusFerme = await visit(base, '/administration/contenus/', aal2Cookie);
    check(
      'le retrait des octrois referme les Contenus',
      contenusFerme.status === 404,
      `HTTP ${contenusFerme.status}`,
    );

    const blocFerme = await visit(base, '/administration/contenus/bloc/accueil/hero/', aal2Cookie);
    check(
      'la fiche de bloc se referme elle aussi',
      blocFerme.status === 404,
      `HTTP ${blocFerme.status}`,
    );

    // --- Remise à zéro : le compte repart sans aucun droit ------------------

    await adjust('admins.view', null);
    await adjust('audit.view', null);

    const closedAgain = await visit(base, '/administration/administrateurs/', aal2Cookie);
    check(
      'le retrait des octrois referme tout, sans reconnexion',
      closedAgain.status === 404,
      `HTTP ${closedAgain.status}`,
    );

    log.step('3. Gardes de route — suite');

    // Nouvelle connexion par mot de passe seul : la session repart en AAL1,
    // alors même que le compte possède un facteur vérifié. Depuis le
    // 1er octobre 2026, cela suffit : le facteur est conservé, jamais demandé.
    const freshAuth = createClient(target.url, target.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const fresh = await freshAuth.auth.signInWithPassword({
      email: accounts.admin.email,
      password,
    });
    if (fresh.error) throw new Error(fresh.error.message);

    adminCookie = sessionCookieHeader(storageKey, fresh.data.session);

    const aal1OnAdmin = await visit(base, '/administration/', adminCookie);
    check(
      'une session AAL1 sur un compte enrôlé ouvre l’administration, sans code',
      aal1OnAdmin.status === 200 && aal1OnAdmin.body.includes('admin__grid'),
      `HTTP ${aal1OnAdmin.status} → ${aal1OnAdmin.location}`,
    );

    for (const path of ['/administration/commandes/', '/administration/commandes/factures/', '/administration/administrateurs/']) {
      const page = await visit(base, path, adminCookie);
      check(
        `navigation sans code : ${path}`,
        page.status === 200 || page.status === 404,
        `HTTP ${page.status} → ${page.location}`,
      );
      check(`aucune redirection vers la vérification : ${path}`, !redirectsTo(page, '/connexion/verification/'));
    }

    const challengePage = await visit(base, '/connexion/verification/', adminCookie);
    check(
      'la page de vérification est présentée',
      challengePage.status === 200,
      `HTTP ${challengePage.status}`,
    );

    const factorsInAal1 = await visit(base, '/securite/double-facteur/', adminCookie);
    check(
      'seule la gestion de ses propres facteurs demande le code (exigence de Supabase)',
      redirectsTo(factorsInAal1, '/connexion/verification/'),
      `HTTP ${factorsInAal1.status} → ${factorsInAal1.location}`,
    );

    /* --- Changement de mot de passe obligatoire --------------------------- */

    await service
      .from('profiles')
      .update({ must_change_password: true })
      .eq('id', accounts.admin.id);

    const mustChange = await visit(base, '/administration/', aal2Cookie);
    check(
      'le changement de mot de passe obligatoire passe avant l’administration',
      redirectsTo(mustChange, '/changer-mot-de-passe/'),
      `HTTP ${mustChange.status} → ${mustChange.location}`,
    );

    const changePage = await visit(base, '/changer-mot-de-passe/', aal2Cookie);
    check(
      'l’écran de changement reste atteignable, sans boucle de redirection',
      changePage.status === 200,
      `HTTP ${changePage.status}`,
    );

    await service
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', accounts.admin.id);

    /* --- Compte suspendu : la session ne vaut plus rien ------------------- */

    await service.from('profiles').update({ status: 'SUSPENDU' }).eq('id', accounts.admin.id);

    const suspended = await visit(base, '/administration/', aal2Cookie);
    check(
      'un compte suspendu perd l’accès, session valide ou non',
      redirectsTo(suspended, '/connexion/'),
      `HTTP ${suspended.status} → ${suspended.location}`,
    );

    const suspendedClientArea = await visit(base, '/espace-client/', aal2Cookie);
    check(
      'un compte suspendu perd aussi son espace privé',
      redirectsTo(suspendedClientArea, '/connexion/'),
      `HTTP ${suspendedClientArea.status} → ${suspendedClientArea.location}`,
    );

    /* --- Redirection ouverte --------------------------------------------- */

    const openRedirect = await visit(
      base,
      '/administration/?suite=https://site-malveillant.test/',
    );
    check(
      'aucune destination externe n’est relayée par la redirection de connexion',
      !String(openRedirect.location ?? '').includes('site-malveillant'),
      String(openRedirect.location),
    );
  } finally {
    for (const account of Object.values(accounts)) {
      if (!account.id) continue;
      await service.from('user_roles').delete().eq('user_id', account.id);
      await service.auth.admin.deleteUser(account.id);
    }
    log.skip('comptes de test supprimés');
  }
}

/* =========================== 3 bis. aucun secret servi au navigateur ====== */

/**
 * Recherche les **valeurs réelles** des secrets dans tout ce que le site
 * envoie au navigateur.
 *
 * C'est la seule forme de contrôle qui prouve quelque chose. Vérifier qu'aucun
 * nom de variable n'apparaît dans le code ne dit rien : une valeur peut fuir
 * sans que son nom l'accompagne. Les valeurs sont donc cherchées telles
 * quelles, dans le HTML de chaque page et dans chaque fichier JavaScript ou
 * CSS que ces pages référencent.
 *
 * Aucune valeur n'est affichée, ni entière ni tronquée : seul le nom de la
 * variable concernée apparaîtrait en cas de fuite.
 */
async function secretLeakChecks(base) {
  log.step('3 bis. Absence de secret servi au navigateur');

  /*
   * `SMTP_USER` est volontairement absent de cette liste.
   *
   * Sa valeur est l'adresse de contact publiée de MORA Shawiri : elle figure
   * dans le pied de page de chaque page, et c'est exactement ce qu'on attend
   * d'une adresse de contact. La chercher comme un secret produirait une alerte
   * sur toutes les pages, à tort — et une alerte qui se déclenche toujours
   * finit par n'être plus lue. Le contrôle ci-dessous vérifie que cette
   * identité est bien celle que l'on croit ; le véritable secret du compte
   * d'envoi, `SMTP_PASSWORD`, reste cherché.
   */
  const publishedAddress = process.env.SMTP_USER?.trim();
  const contactAddress = process.env.CONTACT_EMAIL?.trim();

  check(
    'l’identifiant SMTP est bien l’adresse de contact publiée, non un secret distinct',
    Boolean(publishedAddress) && publishedAddress === contactAddress,
    publishedAddress === contactAddress ? '' : 'SMTP_USER diffère de CONTACT_EMAIL : à vérifier',
  );

  const secrets = [
    'SUPABASE_SECRET_KEY',
    'SUPABASE_ACCESS_TOKEN',
    'GITHUB_TOKEN',
    'VERCEL_TOKEN',
    'SMTP_PASSWORD',
    'ADMIN_SEED_RACHADE_PASSWORD',
  ]
    .map((name) => ({ name, value: process.env[name]?.trim() }))
    .filter((entry) => entry.value && entry.value.length >= 8);

  check('des secrets réels sont disponibles pour la recherche', secrets.length > 0, `${secrets.length}`);

  const pages = [
    '/',
    '/services/',
    '/affiliation/',
    '/affiliation/inscription/',
    '/contact/',
    '/boutique/',
    '/connexion/',
    '/inscription/',
    '/mot-de-passe-oublie/',
    '/reinitialiser-mot-de-passe/',
  ];

  const assets = new Set();
  const documents = [];

  for (const page of pages) {
    const result = await visit(base, page);
    documents.push({ source: page, content: result.body });

    for (const match of result.body.matchAll(/["'](\/_next\/static\/[^"']+\.(?:js|css))["']/g)) {
      assets.add(match[1]);
    }
  }

  for (const asset of assets) {
    const response = await fetch(`${base}${asset}`);
    if (response.ok) documents.push({ source: asset, content: await response.text() });
  }

  const leaks = [];

  for (const { name, value } of secrets) {
    for (const document of documents) {
      if (document.content.includes(value)) leaks.push(`${name} dans ${document.source}`);
    }
  }

  check(
    `aucun secret dans ${pages.length} page(s) et ${assets.size} fichier(s) servis`,
    leaks.length === 0,
    leaks.join(' · '),
  );

  /*
   * Même la clé publiable reste absente du navigateur.
   *
   * Ce n'était pas une exigence — cette clé est conçue pour être exposée, et
   * tout ce qu'elle permet passe de toute façon par RLS. C'est la conséquence
   * d'un choix d'architecture : l'intégralité des parcours d'authentification
   * passe par des actions serveur, et aucun composant navigateur n'ouvre de
   * client Supabase. Le résultat mérite d'être mesuré plutôt qu'affirmé, et
   * surveillé : le jour où un écran privé dialoguera directement avec Supabase,
   * ce contrôle changera d'état et il faudra le constater sciemment.
   */
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  check(
    'le navigateur ne reçoit aucune clé Supabase, pas même la clé publiable',
    Boolean(publishable) &&
      !documents.some((document) => document.content.includes(publishable)),
    publishable ? 'une clé publiable est servie : vérifier quel écran l’utilise' : 'clé absente de l’environnement',
  );

  /* --- En-têtes de sécurité -------------------------------------------- */

  const response = await fetch(`${base}/`, { redirect: 'manual' });
  const expected = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'SAMEORIGIN',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  };

  for (const [header, value] of Object.entries(expected)) {
    check(`en-tête ${header}`, response.headers.get(header) === value, response.headers.get(header) ?? 'absent');
  }

  check(
    'HSTS est posé par l’hébergeur',
    Boolean(response.headers.get('strict-transport-security')),
    response.headers.get('strict-transport-security') ?? 'absent',
  );

  /* --- Les cookies de session ne sont pas lisibles par le script -------- */

  const signIn = await visit(base, '/connexion/');
  check(
    'aucun jeton de session n’est écrit dans le HTML de la page de connexion',
    !/sb-[a-z0-9]+-auth-token/.test(signIn.body),
  );
}

/* ============================================ 4. actions serveur sans JS === */

/**
 * Soumission d'un formulaire par le chemin sans JavaScript.
 *
 * Next.js rend les formulaires d'action serveur exploitables sans script :
 * des champs cachés `$ACTION_*` portent la référence de l'action, et le
 * formulaire est simplement envoyé en `multipart/form-data`. C'est ce chemin
 * qu'emprunte ce contrôle, pour deux raisons.
 *
 * D'abord parce qu'il existe : une personne dont le script est bloqué doit
 * pouvoir se connecter, et le vérifier fait partie du travail. Ensuite parce
 * qu'il permet d'éprouver les actions elles-mêmes — limitation de fréquence,
 * neutralité des messages — et pas seulement les pages qui les contiennent.
 */

function decodeEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Relève les champs cachés du premier formulaire d'action de la page. */
async function readActionFields(base, path, cookie) {
  const page = await visit(base, path, cookie);
  if (page.status !== 200) throw new Error(`${path} a répondu HTTP ${page.status}`);

  const start = page.body.indexOf('<form');
  const end = page.body.indexOf('</form>', start);
  if (start === -1 || end === -1) throw new Error(`Aucun formulaire trouvé sur ${path}`);

  const markup = page.body.slice(start, end);
  const fields = {};

  for (const match of markup.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\s*\/>/g)) {
    fields[decodeEntities(match[1])] = decodeEntities(match[2] ?? '');
  }

  if (!Object.keys(fields).some((name) => name.startsWith('$ACTION'))) {
    throw new Error(`Le formulaire de ${path} n'expose pas de chemin sans JavaScript`);
  }

  return fields;
}

function multipartBody(fields) {
  const boundary = `----mora${randomUUID().replace(/-/g, '')}`;
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    );
  }

  parts.push(`--${boundary}--\r\n`);

  return { boundary, body: parts.join('') };
}

async function submitAction(base, path, fields, cookie) {
  const { boundary, body } = multipartBody(fields);

  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      // Next.js compare l'origine déclarée à l'hôte servi pour écarter les
      // soumissions inter-sites. Un navigateur envoie toujours cet en-tête ;
      // l'omettre produirait un avertissement et ne refléterait pas la réalité.
      Origin: base,
      Referer: `${base}${path}`,
      ...(cookie ? { cookie } : {}),
    },
    body,
  });

  const text = await response.text();

  return {
    status: response.status,
    location: response.headers.get('location') ?? response.headers.get('x-action-redirect'),
    body: text,
  };
}

async function serverActionChecks(target, base) {
  log.step('4. Actions serveur, par le chemin sans JavaScript');

  const service = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Les compteurs de limitation utilisés par ce contrôle sont remis à zéro :
  // ce sont des compteurs de test, et les laisser fausserait une exécution
  // ultérieure depuis la même adresse.
  const testedBuckets = [
    'auth.reinitialisation.ip',
    'auth.reinitialisation.identifiant',
    'auth.reinitialisation.identifiant.jour',
  ];
  await service.from('rate_limit_counters').delete().in('bucket', testedBuckets);

  /*
   * Compte jetable, créé pour ce contrôle et supprimé à sa fin (puis, en
   * dernier recours, par le balayage de la section 5).
   *
   * Règle absolue depuis l'audit du 2 octobre 2026 : aucun contrôle ne vise un
   * vrai compte. Ce contrôle soumettait l'identifiant réel d'un administrateur
   * au formulaire « mot de passe oublié » : chaque exécution envoyait un vrai
   * e-mail de réinitialisation à sa boîte. Le compte jetable porte une adresse
   * du domaine réservé `.test` (RFC 2606) : le serveur SMTP la refuse, rien
   * n'est jamais remis à une boîte réelle.
   */
  const disposable = {
    username: `test-reset-${randomUUID().slice(0, 8)}`,
    email: `test.route.reset.${randomUUID().slice(0, 8)}${TEST_EMAIL_DOMAIN}`,
  };
  const createdDisposable = await service.auth.admin.createUser({
    email: disposable.email,
    password: `Tst-${randomUUID()}`,
    email_confirm: true,
    // L'identifiant métier ne se pose que par les métadonnées applicatives
    // (correctif 4C) : c'est ce qui rend ce compte joignable par son nom.
    app_metadata: { username: disposable.username },
    user_metadata: { full_name: 'Compte de test réinitialisation' },
  });
  if (createdDisposable.error) throw new Error(`compte jetable : ${createdDisposable.error.message}`);
  const disposableId = createdDisposable.data.user.id;
  // Comme `provision-admins.mjs` : l'identifiant est écrit explicitement sur
  // le profil, la seule source que lit la connexion par identifiant.
  await service.from('profiles').update({ username: disposable.username }).eq('id', disposableId);
  const { data: disposableProfile } = await service.from('profiles').select('username').eq('id', disposableId).single();
  check(
    'le compte jetable porte son identifiant métier',
    disposableProfile?.username === disposable.username,
    disposableProfile?.username ?? 'aucun',
  );

  /* --- Connexion refusée : message unique ------------------------------- */

  const signInFields = await readActionFields(base, '/connexion/');

  const wrongPassword = await submitAction(base, '/connexion/', {
    ...signInFields,
    identifiant: disposable.username,
    mot_de_passe: `mauvais-${randomUUID()}`,
    site_web: '',
  });

  check(
    'un mot de passe erroné renvoie le message générique',
    wrongPassword.body.includes('Identifiants incorrects'),
    `HTTP ${wrongPassword.status}`,
  );

  const unknownAccount = await submitAction(base, '/connexion/', {
    ...signInFields,
    identifiant: `inconnu${randomUUID().slice(0, 8)}`,
    mot_de_passe: `mauvais-${randomUUID()}`,
    site_web: '',
  });

  check(
    'un identifiant inconnu renvoie exactement le même message',
    unknownAccount.body.includes('Identifiants incorrects'),
    `HTTP ${unknownAccount.status}`,
  );

  check(
    'aucun des deux refus ne nomme le champ en cause',
    !/mot de passe (incorrect|erron)/i.test(wrongPassword.body) &&
      !/(compte|adresse|identifiant) (inconnu|introuvable|n’existe)/i.test(unknownAccount.body),
  );

  const automated = await submitAction(base, '/connexion/', {
    ...signInFields,
    identifiant: disposable.username,
    mot_de_passe: 'peu-importe',
    site_web: 'https://spam.test',
  });

  check(
    'le pot de miel écarte une soumission automatisée',
    automated.body.includes('n’a pas pu être traitée'),
  );

  /* --- Réinitialisation : réponse unique, puis limitation --------------- */

  const resetFields = await readActionFields(base, '/mot-de-passe-oublie/');
  const unknownIdentifier = `inconnu${randomUUID().slice(0, 8)}`;

  const first = await submitAction(base, '/mot-de-passe-oublie/', {
    ...resetFields,
    identifiant: unknownIdentifier,
    site_web: '',
  });

  check(
    'une adresse inconnue reçoit la réponse conditionnelle',
    first.body.includes('Si un compte correspond à cette adresse'),
    `HTTP ${first.status}`,
  );

  const known = await submitAction(base, '/mot-de-passe-oublie/', {
    ...resetFields,
    identifiant: disposable.username,
    site_web: '',
  });

  check(
    'un identifiant existant reçoit exactement la même réponse',
    known.body.includes('Si un compte correspond à cette adresse'),
    `HTTP ${known.status}`,
  );

  /* --- La limitation de fréquence est réellement partagée en base ------- */

  let blockedAt = 0;

  for (let attempt = 3; attempt <= 8; attempt += 1) {
    const result = await submitAction(base, '/mot-de-passe-oublie/', {
      ...resetFields,
      identifiant: unknownIdentifier,
      site_web: '',
    });

    if (result.body.includes('Trop de tentatives')) {
      blockedAt = attempt;
      break;
    }
  }

  check(
    'les demandes répétées finissent par être bloquées',
    blockedAt > 0,
    blockedAt > 0 ? `bloquée à la ${blockedAt}ᵉ tentative` : 'jamais bloquée',
  );

  const counters = await service
    .from('rate_limit_counters')
    .select('bucket, subject_hash, attempts, blocked_until')
    .in('bucket', testedBuckets);

  check(
    'les compteurs sont bien écrits en base, donc partagés entre instances',
    !counters.error && (counters.data ?? []).length > 0,
    counters.error ? counters.error.message : `${(counters.data ?? []).length} compteur(s)`,
  );

  check(
    'un blocage est effectivement enregistré',
    (counters.data ?? []).some((row) => row.blocked_until !== null),
  );

  check(
    'aucun compteur ne stocke l’identifiant ni l’adresse en clair',
    (counters.data ?? []).length > 0 &&
      counters.data.every(
        (row) => !JSON.stringify(row).includes(unknownIdentifier) && /^[0-9a-f]{64}$/.test(row.subject_hash),
      ),
  );

  await service.from('rate_limit_counters').delete().in('bucket', testedBuckets);
  await service.auth.admin.deleteUser(disposableId);

  /* --- Inscription : validation et neutralité --------------------------- */

  // L'inscription doit être ouverte pour que la suite ait un sens. Si la page
  // présente l'écran « création fermée », c'est que le paramètre D-9 est à
  // `false` ou que la base n'a pas répondu — deux situations à nommer plutôt
  // qu'à interpréter comme une panne de formulaire.
  const signUpPage = await visit(base, '/inscription/');
  check(
    'la page d’inscription présente bien le formulaire (paramètre D-9 actif)',
    signUpPage.body.includes('name="conditions"'),
    signUpPage.body.includes('momentanément fermée')
      ? 'la page annonce une création fermée : paramètre D-9 inactif ou base injoignable'
      : `HTTP ${signUpPage.status}`,
  );

  if (!signUpPage.body.includes('name="conditions"')) return;

  const signUpFields = await readActionFields(base, '/inscription/');

  const weak = await submitAction(base, '/inscription/', {
    ...signUpFields,
    nom: 'Essai',
    email: `essai.${randomUUID().slice(0, 8)}@mora-shawiri.test`,
    mot_de_passe: 'court',
    confirmation: 'court',
    conditions: 'oui',
    site_web: '',
  });

  check(
    'un mot de passe faible est refusé avec des motifs explicites',
    weak.body.includes('ne protégerait pas suffisamment') && weak.body.includes('12 caractères'),
  );

  const mismatch = await submitAction(base, '/inscription/', {
    ...signUpFields,
    nom: 'Essai',
    email: `essai.${randomUUID().slice(0, 8)}@mora-shawiri.test`,
    mot_de_passe: 'Le port de Moroni, 1975 !',
    confirmation: 'Autre chose entièrement',
    conditions: 'oui',
    site_web: '',
  });

  check(
    'deux mots de passe différents sont refusés',
    mismatch.body.includes('ne sont pas identiques'),
  );

  const noConsent = await submitAction(base, '/inscription/', {
    ...signUpFields,
    nom: 'Essai',
    email: `essai.${randomUUID().slice(0, 8)}@mora-shawiri.test`,
    mot_de_passe: 'Le port de Moroni, 1975 !',
    confirmation: 'Le port de Moroni, 1975 !',
    site_web: '',
  });

  check(
    'l’inscription exige l’acceptation des conditions',
    noConsent.body.includes('conditions générales'),
  );

  const badEmail = await submitAction(base, '/inscription/', {
    ...signUpFields,
    nom: 'Essai',
    email: 'pas-une-adresse',
    mot_de_passe: 'Le port de Moroni, 1975 !',
    confirmation: 'Le port de Moroni, 1975 !',
    conditions: 'oui',
    site_web: '',
  });

  check('une adresse mal formée est refusée', badEmail.body.includes('semble incomplète'));

  /*
   * Élévation de privilège tentée depuis le formulaire : des champs `role` et
   * `is_admin` sont ajoutés à la soumission. L'action ne les lit pas, et la
   * base interdirait de toute façon l'auto-attribution. La demande doit se
   * comporter exactement comme une inscription ordinaire.
   */
  const elevation = await submitAction(base, '/inscription/', {
    ...signUpFields,
    nom: 'Essai élévation',
    email: `essai.${randomUUID().slice(0, 8)}@mora-shawiri.test`,
    mot_de_passe: 'Le port de Moroni, 1975 !',
    confirmation: 'Le port de Moroni, 1975 !',
    conditions: 'oui',
    role: 'SUPER_ADMIN',
    is_admin: 'true',
    user_roles: 'SUPER_ADMIN',
    site_web: '',
  });

  check(
    'une tentative d’élévation dans le formulaire ne produit aucun traitement particulier',
    elevation.status === 303 || elevation.status === 200,
    `HTTP ${elevation.status}`,
  );

  const forged = await service
    .from('profiles')
    .select('id, username')
    .eq('full_name', 'Essai élévation');

  check(
    'aucun compte privilégié n’a été créé par cette tentative',
    (forged.data ?? []).length === 0,
    `${(forged.data ?? []).length} profil(s) créé(s)`,
  );
}

/* ======================================================= 5. balayage final */

/* ================================================ 4 bis. téléchargement === */

/**
 * Téléchargement d'un document officiel, servi par HTTP.
 *
 * `verify-documents.mjs` prouve que RLS laisse passer le destinataire et
 * refuse un tiers. Ce contrôle-ci prouve que la **route** respecte cette
 * décision au lieu de la contourner — ce qu'une route servie par la clé à
 * privilèges ferait sans que la base s'en aperçoive.
 *
 * Quatre situations, une seule réponse distincte : le destinataire reçoit son
 * PDF, tout le reste reçoit un 404 indistinguable. Un 403 sur une référence
 * existante confirmerait qu'elle existe.
 */
async function documentDownloadChecks(target, base) {
  log.step('4 bis. Téléchargement d’un document officiel');

  const accessToken = resolveAccessToken();
  const service = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const storageKey = storageKeyFor(target.url);
  const suffix = randomUUID().slice(0, 8);
  const password = `Tst-${randomUUID()}`;
  const TYPE = 'ZZROUT';

  const accounts = {
    owner: { email: `test.route.doc.${suffix}${TEST_EMAIL_DOMAIN}`, id: null },
    other: { email: `test.route.tiers.${suffix}${TEST_EMAIL_DOMAIN}`, id: null },
  };

  let documentId = null;

  try {
    await runSql(
      target,
      accessToken,
      `insert into public.document_types (code, label, entity_type, view_permission, issue_permission, sort_order)
       values ('${TYPE}', 'Type de vérification (transitoire)', 'order', 'orders.view', 'orders.update', 9100)
       on conflict (code) do nothing;`,
    );

    const roles = await service.from('roles').select('id, code');
    const clientRole = (roles.data ?? []).find((row) => row.code === 'CLIENT')?.id;

    for (const account of Object.values(accounts)) {
      const created = await service.auth.admin.createUser({
        email: account.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'Mohamed Ali' },
      });
      if (created.error) throw new Error(created.error.message);
      account.id = created.data.user.id;

      await service.from('user_roles').insert({ user_id: account.id, role_id: clientRole });
    }

    const { data: issued, error: issueError } = await service.rpc('issue_document', {
      p_type: TYPE,
      p_entity_type: 'order',
      p_entity_id: null,
      p_owner_id: accounts.owner.id,
      p_subject_name: 'Mohamed Ali',
      p_metadata: { origine: 'verification-routes-4D' },
      p_replaces: null,
    });

    if (issueError || !issued) throw new Error(issueError?.message ?? 'émission impossible');
    documentId = issued.id;

    const path = `/api/documents/${issued.reference}/`;

    /* --- Visiteur anonyme ------------------------------------------------ */

    const anonymous = await fetch(`${base}${path}`, { redirect: 'manual' });
    check(
      'un visiteur anonyme ne télécharge aucun document',
      anonymous.status === 404,
      `HTTP ${anonymous.status}`,
    );

    /* --- Le destinataire ------------------------------------------------- */

    const ownerAuth = createClient(target.url, target.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const ownerSignIn = await ownerAuth.auth.signInWithPassword({
      email: accounts.owner.email,
      password,
    });
    if (ownerSignIn.error) throw new Error(ownerSignIn.error.message);

    const ownerCookie = sessionCookieHeader(storageKey, ownerSignIn.data.session);

    const download = await fetch(`${base}${path}`, {
      redirect: 'manual',
      headers: { cookie: ownerCookie },
    });

    check('le destinataire reçoit sa pièce', download.status === 200, `HTTP ${download.status}`);
    check(
      'la réponse est bien un PDF',
      download.headers.get('content-type') === 'application/pdf',
      download.headers.get('content-type') ?? '',
    );

    const disposition = download.headers.get('content-disposition') ?? '';
    check(
      'le nom de fichier porte l’identifiant officiel',
      disposition.includes(`${issued.reference}`),
      disposition,
    );
    check(
      'le nom de fichier porte le nom normalisé du § 42',
      disposition.includes('Mohamed-Ali'),
      disposition,
    );
    check(
      'aucun caractère interdit dans le nom de fichier',
      !/[/\\:*?"<>|]/.test(disposition.replace(/^attachment; filename="|"; filename\*=.*$/g, '')),
      disposition,
    );
    check(
      'un document privé n’est jamais mis en cache',
      (download.headers.get('cache-control') ?? '').includes('no-store'),
      download.headers.get('cache-control') ?? '',
    );

    const bytes = new Uint8Array(await download.arrayBuffer());
    const header = String.fromCharCode(...bytes.slice(0, 8));
    check('le fichier servi commence par l’en-tête PDF', header === '%PDF-1.4', header);
    check('le fichier servi n’est pas vide', bytes.byteLength > 1000, `${bytes.byteLength} octets`);

    /* --- Un tiers -------------------------------------------------------- */

    const otherAuth = createClient(target.url, target.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const otherSignIn = await otherAuth.auth.signInWithPassword({
      email: accounts.other.email,
      password,
    });
    if (otherSignIn.error) throw new Error(otherSignIn.error.message);

    const otherCookie = sessionCookieHeader(storageKey, otherSignIn.data.session);

    const forbidden = await fetch(`${base}${path}`, {
      redirect: 'manual',
      headers: { cookie: otherCookie },
    });
    check(
      'un autre client reçoit 404, pas 403 — l’existence n’est pas confirmée',
      forbidden.status === 404,
      `HTTP ${forbidden.status}`,
    );

    /* --- Références hors forme ------------------------------------------- */

    for (const [label, value] of [
      ['une référence inexistante', 'MORA-ZZROUT-Z9999'],
      ['une référence mal formée', 'MORA-FACL-A1'],
      ['une convention écartée par D-2', 'CMD-2026-0001'],
      ['une tentative de traversée', '..%2F..%2Fetc%2Fpasswd'],
    ]) {
      const attempt = await fetch(`${base}/api/documents/${value}/`, {
        redirect: 'manual',
        headers: { cookie: ownerCookie },
      });
      check(`${label} donne 404`, attempt.status === 404, `HTTP ${attempt.status}`);
    }

    // La saisie en minuscules reste servie : le § 102 ne demande pas de punir
    // un client de messagerie qui abaisse la casse d'une URL.
    const lowercase = await fetch(`${base}/api/documents/${issued.reference.toLowerCase()}/`, {
      redirect: 'manual',
      headers: { cookie: ownerCookie },
    });
    check(
      'la même référence en minuscules reste servie',
      lowercase.status === 200,
      `HTTP ${lowercase.status}`,
    );
  } finally {
    if (documentId) {
      await runSql(
        target,
        accessToken,
        `update public.documents set status = 'ANNULE' where id = '${documentId}';`,
      ).catch(() => undefined);
    }

    await runSql(target, accessToken, `delete from public.documents where doc_type = '${TYPE}';`)
      .catch(() => undefined);
    await runSql(target, accessToken, `delete from public.document_sequences where doc_type = '${TYPE}';`)
      .catch(() => undefined);
    await runSql(target, accessToken, `delete from public.document_types where code = '${TYPE}';`)
      .catch(() => undefined);

    for (const account of Object.values(accounts)) {
      if (!account.id) continue;

      // Le constructeur de requête PostgREST est « thenable » mais n'expose
      // pas `.catch` : il faut l'attendre pour pouvoir intercepter.
      try {
        await service.from('user_roles').delete().eq('user_id', account.id);
      } catch {
        // Le balayage final ramassera ce qui resterait.
      }

      await service.auth.admin.deleteUser(account.id).catch(() => undefined);
    }

    const residue = await runSql(
      target,
      accessToken,
      `select (select count(*) from public.document_types where code = '${TYPE}')::int as types,
              (select count(*) from public.documents where doc_type = '${TYPE}')::int as documents;`,
    ).catch(() => null);

    check(
      'le décor documentaire du contrôle est démonté',
      residue?.[0]?.types === 0 && residue?.[0]?.documents === 0,
      JSON.stringify(residue?.[0] ?? {}),
    );
  }
}

/* ========================================================================== */

/**
 * Le parcours commercial, par HTTP — phase 4G.
 *
 * `verify-commerce.mjs` éprouve la RLS à travers PostgREST. Ce contrôle-ci
 * éprouve **les pages**, sur le déploiement réel : ce qu'un client reçoit
 * quand il ouvre l'adresse de sa commande, et ce qu'il reçoit quand il ouvre
 * celle d'un autre.
 *
 * C'est le test IDOR au niveau où il se joue vraiment. Une politique correcte
 * n'empêche pas une page de charger ses données par la clé à privilèges ; seul
 * un appel HTTP avec la session d'un tiers le montre.
 *
 * Le décor consomme deux numéros CMCL, restitués à la fin comme le fait
 * `verify-commerce.mjs`. Le point 40 du cadrage l'exige : les contrôles ne
 * percent pas les suites de production.
 */
async function commerceRouteChecks(target, base) {
  log.step('4 ter. Parcours commercial');

  const accessToken = resolveAccessToken();
  const service = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const storageKey = storageKeyFor(target.url);
  const suffix = randomUUID().slice(0, 8);
  const password = `Tst-${randomUUID()}`;

  const accounts = {
    owner: { email: `test.route.cmd.${suffix}${TEST_EMAIL_DOMAIN}`, id: null },
    other: { email: `test.route.cmdb.${suffix}${TEST_EMAIL_DOMAIN}`, id: null },
  };

  const orders = [];

  const sequenceBefore = await runSql(
    target,
    accessToken,
    `select doc_type, series, last_number, allocated_count
       from public.document_sequences where doc_type = 'CMCL';`,
  ).catch(() => null);

  try {
    const roles = await service.from('roles').select('id, code');
    const clientRole = (roles.data ?? []).find((row) => row.code === 'CLIENT')?.id;

    for (const account of Object.values(accounts)) {
      const created = await service.auth.admin.createUser({
        email: account.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'Contrôle Parcours' },
      });
      if (created.error) throw new Error(created.error.message);
      account.id = created.data.user.id;

      await service.from('user_roles').insert({ user_id: account.id, role_id: clientRole });
    }

    for (const account of Object.values(accounts)) {
      const { data, error } = await service.rpc('create_manual_order', {
        p_user_id: account.id,
        p_items: [
          { designation: 'Contrôle de parcours', unit_price: 6000, quantity: 1 },
        ],
        p_fees: 0,
        p_note: 'verif-routes — donnée de contrôle',
      });
      if (error) throw new Error(error.message);
      orders.push(data);
    }

    const [ownerOrder, otherOrder] = orders;

    const signIn = async (email) => {
      const client = createClient(target.url, target.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const result = await client.auth.signInWithPassword({ email, password });
      if (result.error) throw new Error(result.error.message);
      return sessionCookieHeader(storageKey, result.data.session);
    };

    const ownerCookie = await signIn(accounts.owner.email);
    const otherCookie = await signIn(accounts.other.email);

    /* --- Le titulaire voit sa commande ----------------------------------- */

    const own = await visit(base, `/espace-client/commandes/${ownerOrder.reference}/`, ownerCookie);
    check('le client ouvre sa commande', own.status === 200, `HTTP ${own.status}`);
    check('la page porte la référence de la commande', own.body.includes(ownerOrder.reference));
    check(
      'la page annonce le montant réel',
      own.body.includes('6') && own.body.includes('KMF'),
    );
    check(
      'la page propose de déclarer un paiement',
      own.body.includes('Déclarer mon paiement'),
    );
    check(
      'la page dit que déclarer ne vaut pas confirmation',
      own.body.includes('ne vaut pas') || own.body.includes('vérifiée par MORA Shawiri'),
    );
    check(
      'aucun moyen inactif n’est proposé au client',
      !own.body.includes('Wakati') && !own.body.includes('PayPal'),
    );

    const dashboard = await visit(base, '/espace-client/', ownerCookie);
    check(
      'l’espace client liste la commande',
      dashboard.body.includes(ownerOrder.reference),
      `HTTP ${dashboard.status}`,
    );

    /* --- Le test IDOR ----------------------------------------------------- */

    const foreign = await visit(
      base,
      `/espace-client/commandes/${otherOrder.reference}/`,
      ownerCookie,
    );
    check(
      'la commande d’un autre client donne 404, pas 403',
      foreign.status === 404,
      `HTTP ${foreign.status}`,
    );

    const reverse = await visit(
      base,
      `/espace-client/commandes/${ownerOrder.reference}/`,
      otherCookie,
    );
    check('le contrôle vaut dans les deux sens', reverse.status === 404, `HTTP ${reverse.status}`);

    for (const [label, value] of [
      ['une référence inexistante', 'MORA-CMCL-Z9999'],
      ['une référence mal formée', 'MORA-CMCL-A1'],
      ['une convention écartée par D-2', 'CMD-2026-0001'],
      ['une tentative de traversée', '..%2F..%2Fetc%2Fpasswd'],
    ]) {
      const attempt = await visit(base, `/espace-client/commandes/${value}/`, ownerCookie);
      check(`${label} donne 404 sur une commande`, attempt.status === 404, `HTTP ${attempt.status}`);
    }

    /* --- L'administration reste fermée à un client ------------------------ */

    const adminOrders = await visit(base, '/administration/commandes/', ownerCookie);
    check(
      'un client n’ouvre pas le module Commandes',
      adminOrders.status === 404 || redirectsTo(adminOrders, '/connexion/'),
      `HTTP ${adminOrders.status}`,
    );

    const adminOrder = await visit(
      base,
      `/administration/commandes/${ownerOrder.reference}/`,
      ownerCookie,
    );
    check(
      'un client n’ouvre pas la fiche administrative de sa propre commande',
      adminOrder.status === 404 || redirectsTo(adminOrder, '/connexion/'),
      `HTTP ${adminOrder.status}`,
    );
  } finally {
    /* --- Démontage --------------------------------------------------------- */

    /*
     * Les commandes d'abord, les pièces ensuite.
     *
     * L'ordre inverse échoue, et pour une bonne raison : `orders.document_id`
     * est déclaré `on delete set null`, si bien qu'effacer la pièce tente de
     * modifier la commande — ce que `tg_orders_identity_immutable` refuse,
     * l'identité d'une commande étant gelée après création (§ 5, § 91).
     *
     * Ce n'est pas un défaut : en exploitation, un document émis ne se
     * supprime jamais. Seul un démontage de contrôle rencontre le cas, et il
     * lui suffit de procéder dans le bon sens.
     */
    for (const order of orders) {
      try {
        await service.from('order_events').delete().eq('order_id', order.id);
        await service.from('order_status_history').delete().eq('order_id', order.id);
        await service.from('order_items').delete().eq('order_id', order.id);
        await service.from('orders').delete().eq('id', order.id);
      } catch {
        // Le balayage final ramassera ce qui resterait.
      }

      await runSql(
        target,
        accessToken,
        `update public.documents set status = 'ANNULE'
          where entity_type = 'order' and entity_id = '${order.id}';`,
      ).catch(() => undefined);
      await runSql(
        target,
        accessToken,
        `delete from public.documents where entity_type = 'order' and entity_id = '${order.id}';`,
      ).catch(() => undefined);
    }

    // La suite CMCL est rendue telle qu'elle a été trouvée.
    const previous = sequenceBefore?.[0] ?? null;
    await runSql(
      target,
      accessToken,
      previous === null
        ? `delete from public.document_sequences where doc_type = 'CMCL';`
        : `update public.document_sequences
              set series = '${previous.series}',
                  last_number = ${previous.last_number},
                  allocated_count = ${previous.allocated_count}
            where doc_type = 'CMCL';`,
    ).catch(() => undefined);

    for (const account of Object.values(accounts)) {
      if (!account.id) continue;
      try {
        await service.from('user_roles').delete().eq('user_id', account.id);
      } catch {
        // Idem.
      }
      await service.auth.admin.deleteUser(account.id).catch(() => undefined);
    }

    const after = await runSql(
      target,
      accessToken,
      `select doc_type, series, last_number, allocated_count
         from public.document_sequences where doc_type = 'CMCL';`,
    ).catch(() => null);

    check(
      'la suite CMCL est rendue telle qu’elle a été trouvée',
      JSON.stringify(after?.[0] ?? null) === JSON.stringify(previous),
      `avant ${JSON.stringify(previous)} — après ${JSON.stringify(after?.[0] ?? null)}`,
    );

    const residue = await runSql(
      target,
      accessToken,
      // Depuis le 2026-10-03, des commandes réelles existent : seules
      // comptent celles nées pendant ce contrôle.
      `select (select count(*) from public.orders where created_at >= '${startedAt}')::int as commandes,
              (select count(*) from public.documents where doc_type = 'CMCL' and issued_at >= '${startedAt}')::int as pieces;`,
    ).catch(() => null);

    check(
      'le décor commercial du contrôle est démonté',
      residue?.[0]?.commandes === 0 && residue?.[0]?.pieces === 0,
      JSON.stringify(residue?.[0] ?? {}),
    );
  }
}

/* ========================================================================== */

async function assertNoLeftovers(target) {
  log.step('5. Absence de résidu');

  const service = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) {
    check('les comptes sont lisibles pour le balayage', false, error.message);
    return;
  }

  const leftovers = data.users.filter((user) => user.email?.endsWith(TEST_EMAIL_DOMAIN));

  for (const user of leftovers) {
    await service.from('user_roles').delete().eq('user_id', user.id);
    await service.auth.admin.deleteUser(user.id);
    log.warn('compte de test résiduel supprimé');
  }

  check('aucun compte de test ne subsiste', leftovers.length === 0, `${leftovers.length} trouvé(s)`);

  /*
   * Compteurs de limitation créés par ce contrôle.
   *
   * Les tentatives de connexion échouées volontairement rapprochent le compte
   * visé d'un blocage temporaire. Les laisser reviendrait à handicaper une
   * vraie connexion pour une raison de test. Seules les lignes touchées
   * pendant l'exécution sont supprimées : les compteurs antérieurs, qui
   * pourraient correspondre à une activité réelle, sont conservés.
   */
  const { data: cleared } = await service
    .from('rate_limit_counters')
    .delete()
    .like('bucket', 'auth.%')
    .gte('updated_at', startedAt)
    .select('bucket');

  check(
    'les compteurs de limitation créés par le test sont effacés',
    true,
    `${(cleared ?? []).length} compteur(s)`,
  );
}

/* ========================================================================== */

async function main() {
  const target = resolveTarget();
  const base = (readFlag('base') ?? 'http://localhost:3000').replace(/\/$/, '');

  log.step(`Parcours HTTP — ${describeTarget(target)} — cible ${base}`);

  await anonymousRoutes(base);
  await publicIntegrity(base);
  await secretLeakChecks(base);

  try {
    await sessionRoutes(target, base);
    await serverActionChecks(target, base);
    await documentDownloadChecks(target, base);
    await commerceRouteChecks(target, base);
  } finally {
    await assertNoLeftovers(target);
  }

  log.step(`Résultat : ${results.passed} contrôle(s) réussi(s), ${results.failed} échec(s).`);

  if (results.failed > 0) process.exit(1);
}

main().catch((error) => {
  log.fail(error.message);
  process.exit(1);
});
