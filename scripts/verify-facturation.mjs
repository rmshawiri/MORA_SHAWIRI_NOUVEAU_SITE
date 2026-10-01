/**
 * Vérification de la facturation officielle contre la base réelle —
 * finalisation 4G.
 *
 *   node --import tsx scripts/verify-facturation.mjs --env shared [--base https://…]
 *
 * ## Ce que ce script éprouve
 *
 *   * la permission `invoices.issue`, avec de vraies sessions AAL2 :
 *     SUPER_ADMIN émet, ADMIN + invoices.issue émet, ADMIN avec orders.update
 *     et payments.verify n'émet pas, ADMIN sans droit, CLIENT et anonyme non
 *     plus — et aucun appel direct (`issue_document('FACL')`) ne contourne ;
 *   * le numéro FACL vient du Moteur de Documents, une seule fois par
 *     commande, y compris sous six appels simultanés ;
 *   * l'instantané : fidèle aux lignes à l'émission, immuable, insensible à
 *     une modification ultérieure de la commande ;
 *   * le PDF rendu depuis l'instantané ;
 *   * la lecture : le titulaire lit sa facture, un autre client non ;
 *   * avec `--base`, la route servie en production : PDF réel, nom de fichier,
 *     archive privée posée au premier téléchargement et empreinte conforme,
 *     404 uniforme pour qui n'a pas le droit, et les écrans d'administration.
 *
 * ## Les suites documentaires
 *
 * Les contrôles émettent de vraies pièces CMCL et FACL. La règle apprise en
 * 4F s'applique : relever les compteurs au départ, annuler puis supprimer les
 * pièces de contrôle, restituer les compteurs, et le **prouver**. À la sortie,
 * aucune suite réelle n'a avancé d'un numéro.
 *
 * Comptes en `@mora-shawiri.test`, tous supprimés ; objets Storage de
 * contrôle supprimés ; résidu compté table par table.
 */

import { createHash, randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { describeTarget, log, readFlag, resolveAccessToken, resolveTarget, runSql } from './lib/config.mjs';
import { totpCode, waitForFreshWindow } from './lib/totp.mjs';
import { parseInvoiceSnapshot, renderInvoicePdf } from '../src/lib/domain/invoice-pdf.ts';
import { invoiceLogo } from '../src/lib/documents/logo.ts';

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

const TEST_DOMAIN = 'mora-shawiri.test';
const PREFIX = 'verif-facl';
const PASSWORD = `Verif-FACL-${randomUUID()}`;
const SEQUENCES = ['CMCL', 'FACL'];
const BUCKET = 'documents-officiels';
const MAX_CHUNK = 3180;
const ISSUER = {
  name: 'MORA Shawiri',
  slogan: 'Le Choix Optimal pour votre performance',
  address: 'Moroni — Union des Comores',
  phone: '+269 430 63 06',
  email: 'contact@morashawiri.com',
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

/* ------------------------------------------------------------- comptes --- */

function sessionClient(target) {
  return createClient(target.url, target.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function createAccount(admin, { roleCode, grants = [], label, fullName }) {
  const email = `${PREFIX}-${label}-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName ?? `Contrôle ${label}` },
  });
  if (error || !data.user) throw new Error(`création de ${label} : ${error?.message}`);

  const { data: role } = await admin.from('roles').select('id').eq('code', roleCode).maybeSingle();
  await admin.from('user_roles').upsert({ user_id: data.user.id, role_id: role.id }, { onConflict: 'user_id,role_id' });

  if (grants.length > 0) {
    const { data: permissions } = await admin.from('permissions').select('id, code').in('code', grants);
    if ((permissions ?? []).length !== grants.length) throw new Error(`permissions manquantes pour ${label}`);
    const written = await admin.from('user_permissions').upsert(
      permissions.map((row) => ({ user_id: data.user.id, permission_id: row.id, effect: 'OCTROI' })),
      { onConflict: 'user_id,permission_id' },
    );
    if (written.error) throw new Error(written.error.message);
  }

  return { id: data.user.id, email };
}

async function signIn(target, email) {
  const client = sessionClient(target);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`connexion ${email} : ${error.message}`);
  return client;
}

/** Session AAL2 réelle : enrôlement TOTP puis vérification d'un vrai code. */
async function signInAal2(target, email) {
  const client = await signIn(target, email);
  const enrol = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: `${PREFIX}` });
  if (enrol.error) throw new Error(`enrôlement ${email} : ${enrol.error.message}`);
  await waitForFreshWindow(30, 5);
  const verified = await client.auth.mfa.challengeAndVerify({
    factorId: enrol.data.id,
    code: totpCode(enrol.data.totp.secret),
  });
  if (verified.error) throw new Error(`second facteur ${email} : ${verified.error.message}`);
  return client;
}

function cookieFor(target, session) {
  const key = `sb-${new URL(target.url).hostname.split('.')[0]}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
  if (value.length <= MAX_CHUNK) return `${key}=${value}`;
  const parts = [];
  for (let index = 0; index * MAX_CHUNK < value.length; index += 1) {
    parts.push(`${key}.${index}=${value.slice(index * MAX_CHUNK, (index + 1) * MAX_CHUNK)}`);
  }
  return parts.join('; ');
}

async function makeOrder(admin, userId, items) {
  const { data, error } = await admin.rpc('create_manual_order', {
    p_user_id: userId,
    p_items: items,
    p_fees: 0,
    p_note: `${PREFIX} — donnée de contrôle, à supprimer`,
  });
  if (error) throw new Error(`commande de contrôle : ${error.message}`);
  return data;
}

async function sequence(state, docType) {
  const rows = await runSql(
    state.target,
    state.accessToken,
    `select series, last_number, allocated_count from public.document_sequences where doc_type = '${docType}';`,
  );
  return rows?.[0] ?? null;
}

const refusedRpc = (result) => Boolean(result.error) && !result.data;

/* ======================================================= 1. permissions === */

async function checkPermissions(state) {
  log.step('1. Qui peut émettre une facture');
  const { s, orders } = state;
  const before = await sequence(state, 'FACL');

  const anon = await sessionClient(state.target).rpc('issue_order_invoice', { p_order_id: orders.a.id });
  check('un visiteur anonyme n’émet pas', refusedRpc(anon));

  const client = await s.clientA.rpc('issue_order_invoice', { p_order_id: orders.a.id });
  check('un CLIENT n’émet pas, même pour sa propre commande', refusedRpc(client));

  const none = await s.adminNone.rpc('issue_order_invoice', { p_order_id: orders.a.id });
  check('un ADMIN sans permission n’émet pas', refusedRpc(none));

  const reader = await s.adminReader.rpc('issue_order_invoice', { p_order_id: orders.a.id });
  check('un ADMIN orders.view n’émet pas', refusedRpc(reader));

  const updater = await s.adminUpdater.rpc('issue_order_invoice', { p_order_id: orders.a.id });
  check(
    'orders.update (et même payments.verify) ne permettent pas d’émettre',
    refusedRpc(updater) && updater.error?.code === '42501',
    updater.error?.message ?? 'émission acceptée',
  );

  const bypass = await s.adminUpdater.rpc('issue_document', {
    p_type: 'FACL',
    p_entity_type: 'order',
    p_entity_id: orders.a.id,
    p_owner_id: state.accounts.clientA.id,
    p_subject_name: 'Contournement',
    p_metadata: {},
    p_replaces: null,
  });
  check('aucun contournement par issue_document(\'FACL\') direct', refusedRpc(bypass));

  const aal1 = await (await signIn(state.target, state.accounts.adminIssuer.email)).rpc('issue_order_invoice', {
    p_order_id: orders.a.id,
  });
  check('invoices.issue sans second facteur (AAL1) n’émet pas', refusedRpc(aal1));

  const after = await sequence(state, 'FACL');
  check(
    'aucun refus n’a consommé de numéro FACL',
    JSON.stringify(before) === JSON.stringify(after),
    `${JSON.stringify(before)} → ${JSON.stringify(after)}`,
  );

  const issued = await s.adminIssuer.rpc('issue_order_invoice', { p_order_id: orders.a.id });
  check('un ADMIN avec invoices.issue (AAL2) émet', !issued.error && !!issued.data, issued.error?.message);
  check(
    'le numéro suit la nomenclature MORA-FACL-[SÉRIE][NUMÉRO]',
    /^MORA-FACL-[A-Z]+\d{4}$/.test(issued.data?.reference ?? ''),
    issued.data?.reference,
  );
  state.invoiceA = issued.data;

  const afterIssue = await sequence(state, 'FACL');
  check(
    'le Moteur de Documents a alloué exactement un numéro',
    Number(afterIssue?.allocated_count ?? 0) === Number(before?.allocated_count ?? 0) + 1,
  );

  const superAdmin = await s.superAdmin.rpc('issue_order_invoice', { p_order_id: orders.b.id });
  check('SUPER_ADMIN (AAL2) émet', !superAdmin.error && !!superAdmin.data, superAdmin.error?.message);
  state.invoiceB = superAdmin.data;

  const archive = await s.adminIssuer.rpc('record_document_archive', {
    p_document_id: state.invoiceA?.id,
    p_path: `FACL/${state.invoiceA?.id}.pdf`,
    p_sha256: '0'.repeat(64),
    p_size: 1,
    p_renderer: 'forge',
  });
  check('aucune session ne déclare une archive (service_role seul)', refusedRpc(archive));
}

/* ======================================================= 2. idempotence === */

async function checkIdempotence(state) {
  log.step('2. Idempotence et concurrence');
  const { s, orders } = state;

  const before = await sequence(state, 'FACL');
  const again = await s.adminIssuer.rpc('issue_order_invoice', { p_order_id: orders.a.id });
  check('émettre de nouveau rend la même facture', again.data?.reference === state.invoiceA?.reference);
  const afterRepeat = await sequence(state, 'FACL');
  check('le rejeu ne consomme aucun numéro', JSON.stringify(before) === JSON.stringify(afterRepeat));

  const calls = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      (index % 2 === 0 ? s.adminIssuer : s.superAdmin).rpc('issue_order_invoice', { p_order_id: orders.d.id }),
    ),
  );
  const references = new Set(calls.map((call) => call.data?.reference).filter(Boolean));
  check(
    'six émissions simultanées pour une commande : une seule facture',
    references.size === 1 && calls.every((call) => !call.error),
    `${references.size} référence(s), erreurs : ${calls.filter((call) => call.error).map((c) => c.error.message).join(' | ')}`,
  );
  state.invoiceD = calls.find((call) => call.data)?.data;

  const afterRace = await sequence(state, 'FACL');
  check(
    'six appels simultanés n’ont alloué qu’un numéro',
    Number(afterRace.allocated_count) === Number(afterRepeat.allocated_count) + 1,
  );

  const active = await runSql(
    state.target,
    state.accessToken,
    `select count(*)::int as n from public.documents where doc_type = 'FACL' and status = 'EMIS' and entity_id = '${orders.d.id}';`,
  );
  check('une seule facture active en base pour cette commande', active?.[0]?.n === 1);

  // Le garde-fou de dernier recours : même un chemin privilégié qui oublierait
  // de regarder avant d'allouer échoue, et son allocation est annulée.
  const beforeForce = await sequence(state, 'FACL');
  const forced = await runSql(
    state.target,
    state.accessToken,
    `select public.issue_document('FACL', 'order', '${orders.a.id}'::uuid, null, 'Doublon', '{}'::jsonb, null);`,
  ).then(
    () => null,
    (error) => error,
  );
  check('l’index refuse une seconde facture active, même par la voie privilégiée', forced !== null);
  const afterForce = await sequence(state, 'FACL');
  check('et le numéro tenté n’est pas consommé', JSON.stringify(beforeForce) === JSON.stringify(afterForce));

  const cancelled = await s.adminIssuer.rpc('issue_order_invoice', { p_order_id: orders.cancelled.id });
  check('une commande annulée ne se facture pas', refusedRpc(cancelled));
}

/* ========================================================= 3. instantané === */

async function checkSnapshot(state) {
  log.step('3. Instantané figé à l’émission');
  const { orders } = state;

  const rows = await runSql(
    state.target,
    state.accessToken,
    `select content, content_sha256,
            encode(sha256(convert_to(content::text, 'UTF8')), 'hex') as recomputed,
            pdf_path
       from public.document_snapshots where document_id = '${state.invoiceA.id}';`,
  );
  const row = rows?.[0];
  check('l’instantané existe, écrit avec la facture', !!row);

  const snapshot = parseInvoiceSnapshot(row?.content);
  check('l’instantané se lit comme une facture', !!snapshot);
  state.snapshotA = snapshot;

  check('son empreinte est celle calculée par la base', row?.content_sha256 === row?.recomputed);
  check('il porte la référence de la facture', snapshot?.reference === state.invoiceA.reference);
  check('il porte la référence de la commande', snapshot?.references.order === orders.a.reference);
  check('il porte le client de la commande', snapshot?.customer.name === orders.a.customer_name);
  check('il porte l’identité publique de MORA Shawiri', JSON.stringify(snapshot?.issuer) === JSON.stringify(ISSUER));
  check(
    'les lignes, quantités et prix sont ceux de la commande',
    snapshot?.lines.length === 2 &&
      snapshot.lines[0].designation === `${PREFIX} création de site — formule « Essentielle »` &&
      snapshot.lines[0].unit_price === 15000 &&
      snapshot.lines[1].quantity === 2 &&
      snapshot.lines[1].unit_price === 2500,
    JSON.stringify(snapshot?.lines),
  );
  check('les totaux sont ceux de la commande', snapshot?.totals.total === 20000 && snapshot?.totals.subtotal === 20000);
  check('aucune taxe n’y figure', !/tva|tax/i.test(JSON.stringify(row?.content)));

  /* --- Le prix change après émission : la facture ne bouge pas ----------- */

  await state.admin.from('order_items').update({ unit_price: 20000 }).eq('order_id', orders.a.id).eq('position', 0);
  const { data: order } = await state.admin.from('orders').select('total_amount').eq('id', orders.a.id).single();
  check('la commande, elle, a bien changé de total', Number(order?.total_amount) === 25000, order?.total_amount);

  const later = await runSql(
    state.target,
    state.accessToken,
    `select content_sha256 from public.document_snapshots where document_id = '${state.invoiceA.id}';`,
  );
  check('l’instantané est inchangé', later?.[0]?.content_sha256 === row?.content_sha256);

  const reparsed = parseInvoiceSnapshot(
    (await runSql(state.target, state.accessToken, `select content from public.document_snapshots where document_id = '${state.invoiceA.id}';`))?.[0]?.content,
  );
  const pdf = latin1(renderInvoicePdf(reparsed, { logo: invoiceLogo() }));
  check('le PDF rendu après coup affiche toujours 15 000 KMF', pdf.includes('15 000 KMF'));
  check('et jamais le nouveau total de commande, 25 000 KMF', !pdf.includes('25 000 KMF'));

  /* --- Immutabilité, même pour la voie privilégiée ----------------------- */

  const rewrite = await runSql(
    state.target,
    state.accessToken,
    `update public.document_snapshots set content = jsonb_set(content, '{totals,total}', '1') where document_id = '${state.invoiceA.id}';`,
  ).then(() => null, (error) => error);
  check('réécrire le contenu est refusé, même avec la voie privilégiée', rewrite !== null);

  const erase = await runSql(
    state.target,
    state.accessToken,
    `delete from public.document_snapshots where document_id = '${state.invoiceA.id}';`,
  ).then(() => null, (error) => error);
  check('effacer l’instantané d’une facture émise est refusé', erase !== null);

  const sessionWrite = await state.s.adminIssuer
    .from('document_snapshots')
    .update({ schema_version: 2 })
    .eq('document_id', state.invoiceA.id)
    .select('document_id');
  check('aucune session n’écrit un instantané', Boolean(sessionWrite.error) || (sessionWrite.data ?? []).length === 0);

  /* --- Le PDF de l'instantané --------------------------------------------- */

  const bytes = renderInvoicePdf(snapshot, { logo: invoiceLogo() });
  const file = latin1(bytes);
  check('le rendu est un PDF', file.startsWith('%PDF-1.4') && file.endsWith('%%EOF\n'));
  check('il porte le numéro officiel', file.includes(state.invoiceA.reference));
  check('il porte la commande', file.includes(orders.a.reference));
  check('il porte le client', file.includes('Contrôle Client A'));
  check('il est déterministe', sha256(bytes) === sha256(renderInvoicePdf(snapshot, { logo: invoiceLogo() })));
}

/* =========================================================== 4. lecture === */

async function checkReading(state) {
  log.step('4. Qui lit une facture');
  const { s } = state;
  const reference = state.invoiceA.reference;
  const read = async (session) => {
    const doc = await session.from('documents').select('id').eq('reference', reference);
    const snap = await session.from('document_snapshots').select('document_id').eq('document_id', state.invoiceA.id);
    return { doc: (doc.data ?? []).length, snap: (snap.data ?? []).length };
  };

  const own = await read(s.clientA);
  check('le titulaire lit sa facture et son instantané', own.doc === 1 && own.snap === 1);
  const other = await read(s.clientB);
  check('un autre client ne lit ni la facture ni l’instantané', other.doc === 0 && other.snap === 0);
  const reader = await read(s.adminReader);
  check('un ADMIN orders.view lit la facture', reader.doc === 1 && reader.snap === 1);
  const none = await read(s.adminNone);
  check('un ADMIN sans permission ne lit rien', none.doc === 0 && none.snap === 0);
  const anon = await read(sessionClient(state.target));
  check('un anonyme ne lit rien', anon.doc === 0 && anon.snap === 0);

  const audit = await runSql(
    state.target,
    state.accessToken,
    `select actor_id, result, metadata from public.audit_logs
      where action = 'commerce.facture.emission' and resource_id = '${reference}'
        -- Le journal est en ajout seul, et les numéros de contrôle sont
        -- restitués à chaque exécution : seules les entrées de celle-ci comptent.
        and created_at >= '${state.startedAt}'::timestamptz;`,
  );
  check(
    'l’émission est journalisée : qui, quelle facture, quelle commande, résultat',
    audit?.length === 1 &&
      audit[0].actor_id === state.accounts.adminIssuer.id &&
      audit[0].result === 'SUCCES' &&
      audit[0].metadata?.commande === state.orders.a.reference,
    JSON.stringify(audit),
  );
}

/* ============================================================ 5. HTTP === */

async function checkHttp(state, base) {
  log.step(`5. Route servie — ${base}`);
  const { s } = state;
  const reference = state.invoiceA.reference;
  const path = `/api/documents/${reference}/`;
  const cookie = async (client) => cookieFor(state.target, (await client.auth.getSession()).data.session);

  const fetchAs = async (cookieHeader, suffix = '') =>
    fetch(`${base}${path}${suffix}`, { redirect: 'manual', headers: cookieHeader ? { cookie: cookieHeader } : {} });

  const ownerCookie = await cookie(s.clientA);
  const first = await fetchAs(ownerCookie);
  const firstBytes = new Uint8Array(await first.arrayBuffer());
  check('le titulaire télécharge sa facture', first.status === 200, `HTTP ${first.status}`);
  check('c’est un PDF', first.headers.get('content-type') === 'application/pdf' && latin1(firstBytes).startsWith('%PDF-'));
  check(
    'nom de fichier : la référence officielle',
    (first.headers.get('content-disposition') ?? '').includes(`filename="${reference}.pdf"`),
    first.headers.get('content-disposition'),
  );
  check('jamais en cache partagé', (first.headers.get('cache-control') ?? '').includes('no-store'));
  check('le fichier servi porte le numéro et la commande', latin1(firstBytes).includes(reference) && latin1(firstBytes).includes(state.orders.a.reference));
  check('le fichier servi ignore le prix modifié après émission', !latin1(firstBytes).includes('25 000 KMF'));

  const archived = await runSql(
    state.target,
    state.accessToken,
    `select pdf_path, pdf_sha256, pdf_size from public.document_snapshots where document_id = '${state.invoiceA.id}';`,
  );
  const archive = archived?.[0];
  check('l’archive privée est posée', archive?.pdf_path === `FACL/${state.invoiceA.id}.pdf`, archive?.pdf_path);
  check('son empreinte est celle du fichier servi', archive?.pdf_sha256 === sha256(firstBytes));

  const second = await fetchAs(ownerCookie);
  const secondBytes = new Uint8Array(await second.arrayBuffer());
  check('un second téléchargement rend exactement les mêmes octets', sha256(secondBytes) === sha256(firstBytes));

  const inline = await fetchAs(ownerCookie, '?affichage=1');
  check('la consultation s’ouvre dans le navigateur', (inline.headers.get('content-disposition') ?? '').startsWith('inline;'));

  const foreign = await fetchAs(await cookie(s.clientB));
  check('un autre client reçoit 404', foreign.status === 404, `HTTP ${foreign.status}`);
  const anonymous = await fetchAs(null);
  check('un anonyme reçoit 404', anonymous.status === 404, `HTTP ${anonymous.status}`);
  const noPerm = await fetchAs(await cookie(s.adminNone));
  check('un ADMIN sans orders.view reçoit 404', noPerm.status === 404, `HTTP ${noPerm.status}`);
  const readerCookie = await cookie(s.adminReader);
  const reader = await fetchAs(readerCookie);
  check('un ADMIN orders.view télécharge', reader.status === 200);

  /* --- Le bucket lui-même ------------------------------------------------- */

  const publicUrl = `${state.target.url}/storage/v1/object/public/${BUCKET}/FACL/${state.invoiceA.id}.pdf`;
  const exposed = await fetch(publicUrl);
  check('aucune URL publique ne sert l’archive', exposed.status !== 200, `HTTP ${exposed.status}`);
  const stolen = await s.clientB.storage.from(BUCKET).download(`FACL/${state.invoiceA.id}.pdf`);
  check('un autre client ne lit pas l’archive dans le bucket', !stolen.data);
  const legit = await s.clientA.storage.from(BUCKET).download(`FACL/${state.invoiceA.id}.pdf`);
  check('le titulaire la lit sous sa session', !!legit.data);
  const upload = await s.adminIssuer.storage.from(BUCKET).upload(`FACL/${randomUUID()}.pdf`, firstBytes, { contentType: 'application/pdf' });
  check('aucune session ne dépose dans le bucket', Boolean(upload.error));

  /* --- Écrans ---------------------------------------------------------- */

  const page = async (cookieHeader, url) => {
    const response = await fetch(`${base}${url}`, { redirect: 'manual', headers: cookieHeader ? { cookie: cookieHeader } : {} });
    return { status: response.status, body: response.status === 200 ? await response.text() : '' };
  };

  const list = await page(readerCookie, '/administration/commandes/factures/');
  check('la liste des factures s’ouvre sous orders.view', list.status === 200, `HTTP ${list.status}`);
  check('elle montre la facture, son client et sa commande', list.body.includes(reference) && list.body.includes(state.orders.a.reference) && list.body.includes('Contrôle Client A'));
  check('elle propose le PDF et le partage', list.body.includes(`/api/documents/${reference}/`) && list.body.includes('Envoyer par WhatsApp / partager'));
  check('aucun faux lien wa.me de « pièce jointe »', !/wa\.me\/\?text/.test(list.body));

  const searched = await page(readerCookie, `/administration/commandes/factures/?q=${encodeURIComponent(state.invoiceB.reference)}`);
  check('la recherche filtre', searched.body.includes(state.invoiceB.reference) && !searched.body.includes(`>${reference}<`));

  const fiche = await page(readerCookie, `/administration/commandes/factures/${reference}/`);
  check('la fiche de la facture s’ouvre', fiche.status === 200 && fiche.body.includes('Lignes facturées'));

  const listNone = await page(await cookie(s.adminNone), '/administration/commandes/factures/');
  check('sans orders.view, la liste est introuvable', listNone.status === 404, `HTTP ${listNone.status}`);
  const listClient = await page(ownerCookie, '/administration/commandes/factures/');
  check('un client ne découvre pas la liste', listClient.status === 404 || (listClient.status >= 300 && listClient.status < 400), `HTTP ${listClient.status}`);

  const updaterFiche = await page(await cookie(s.adminUpdater), `/administration/commandes/${state.orders.e.reference}/`);
  check('sans invoices.issue, la fiche commande ne propose pas l’émission', updaterFiche.status === 200 && !updaterFiche.body.includes('Émettre la facture'));
  const issuerFiche = await page(await cookie(s.adminIssuer), `/administration/commandes/${state.orders.e.reference}/`);
  check('avec invoices.issue, elle la propose', issuerFiche.status === 200 && issuerFiche.body.includes('Émettre la facture'));

  const clientOrder = await page(ownerCookie, `/espace-client/commandes/${state.orders.a.reference}/`);
  check('le client voit sa facture depuis sa commande', clientOrder.status === 200 && clientOrder.body.includes('Votre facture') && clientOrder.body.includes(reference));
  check('l’espace client n’emprunte aucune classe admin', !/class="[^"]*admin-/.test(clientOrder.body));

  for (const body of [list.body, fiche.body, clientOrder.body]) {
    if (/sb_secret_|service_role|SUPABASE_SECRET/.test(body)) {
      check('aucun secret dans une page servie', false);
      return;
    }
  }
  check('aucun secret dans les pages servies', true);
}

/* ========================================================== démontage === */

async function teardown(state, before) {
  log.step('Nettoyage des données de contrôle');
  const { admin } = state;

  const docs = await runSql(
    state.target,
    state.accessToken,
    `select id from public.documents where doc_type = 'FACL' and issued_at >= '${state.startedAt}'::timestamptz;`,
  ).catch(() => []);
  const paths = (docs ?? []).map((row) => `FACL/${row.id}.pdf`);
  if (paths.length > 0) await admin.storage.from(BUCKET).remove(paths);

  const orderIds = Object.values(state.orders ?? {}).filter(Boolean).map((order) => order.id);
  if (orderIds.length > 0) await admin.from('orders').delete().in('id', orderIds);

  // Une pièce émise ne se supprime pas : annuler d'abord (règle de 4D).
  const since = `'${state.startedAt}'::timestamptz`;
  await runSql(state.target, state.accessToken,
    `update public.documents set status = 'ANNULE' where doc_type in ('CMCL', 'FACL') and issued_at >= ${since};`,
  ).catch((error) => log.warn(`annulation : ${error.message}`));
  await runSql(state.target, state.accessToken,
    `delete from public.documents where doc_type in ('CMCL', 'FACL') and issued_at >= ${since};`,
  ).catch((error) => log.warn(`suppression : ${error.message}`));

  for (const [docType, value] of Object.entries(before.sequences)) {
    await runSql(
      state.target,
      state.accessToken,
      value === null
        ? `delete from public.document_sequences where doc_type = '${docType}';`
        : `update public.document_sequences set series = '${value.series}', last_number = ${value.last_number},
             allocated_count = ${value.allocated_count} where doc_type = '${docType}';`,
    ).catch(() => {});
  }

  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of users?.users ?? []) {
    if (user.email?.startsWith(PREFIX)) await admin.auth.admin.deleteUser(user.id);
  }

  /* --- Et l'on prouve qu'il ne reste rien -------------------------------- */

  const after = await snapshotState(state);
  for (const key of Object.keys(before.counts)) {
    check(`aucun résidu : ${key}`, after.counts[key] === before.counts[key], `${after.counts[key]} contre ${before.counts[key]}`);
  }
  for (const docType of SEQUENCES) {
    check(
      `la suite ${docType} est rendue telle qu’elle était`,
      JSON.stringify(after.sequences[docType]) === JSON.stringify(before.sequences[docType]),
      `${JSON.stringify(before.sequences[docType])} → ${JSON.stringify(after.sequences[docType])}`,
    );
  }
  const { data: objects } = await admin.storage.from(BUCKET).list('FACL', { limit: 1000 });
  check('aucun fichier de contrôle dans le bucket', (objects ?? []).length === before.objects, `${(objects ?? []).length}`);
  const leftover = (users?.users ?? []).length === 0
    ? 0
    : ((await admin.auth.admin.listUsers({ perPage: 1000 })).data?.users ?? []).filter((user) => user.email?.startsWith(PREFIX)).length;
  check('aucun compte de contrôle', leftover === 0, `${leftover}`);
}

async function snapshotState(state) {
  const sequences = {};
  for (const docType of SEQUENCES) sequences[docType] = await sequence(state, docType);
  const counts = (
    await runSql(
      state.target,
      state.accessToken,
      `select (select count(*)::int from public.documents) as documents,
              (select count(*)::int from public.document_snapshots) as snapshots,
              (select count(*)::int from public.orders) as orders,
              (select count(*)::int from public.order_items) as order_items`,
    )
  )?.[0];
  const { data: objects } = await state.admin.storage.from(BUCKET).list('FACL', { limit: 1000 });
  return { sequences, counts, objects: (objects ?? []).length };
}

/* ================================================================ main === */

async function main() {
  const target = resolveTarget();
  const accessToken = resolveAccessToken();
  const base = readFlag('base')?.replace(/\/$/, '');
  log.step(`Facturation officielle — ${describeTarget(target)}`);

  const admin = createClient(target.url, target.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // Une seconde de marge : `issued_at` est posé par la base, dont l'horloge
  // peut différer légèrement de celle de ce poste.
  const state = { target, accessToken, admin, startedAt: new Date(Date.now() - 1000).toISOString(), orders: {} };
  const before = await snapshotState(state);

  try {
    state.accounts = {
      clientA: await createAccount(admin, { roleCode: 'CLIENT', label: 'clienta', fullName: 'Contrôle Client A' }),
      clientB: await createAccount(admin, { roleCode: 'CLIENT', label: 'clientb', fullName: 'Contrôle Client B' }),
      superAdmin: await createAccount(admin, { roleCode: 'SUPER_ADMIN', label: 'super' }),
      adminIssuer: await createAccount(admin, { roleCode: 'ADMIN', label: 'emetteur', grants: ['orders.view', 'invoices.issue'] }),
      adminUpdater: await createAccount(admin, {
        roleCode: 'ADMIN',
        label: 'gestion',
        grants: ['orders.view', 'orders.update', 'orders.cancel', 'payments.view', 'payments.verify'],
      }),
      adminReader: await createAccount(admin, { roleCode: 'ADMIN', label: 'lecteur', grants: ['orders.view'] }),
      adminNone: await createAccount(admin, { roleCode: 'ADMIN', label: 'nu' }),
    };

    const lines = [
      { designation: `${PREFIX} création de site — formule « Essentielle »`, unit_price: 15000, quantity: 1, item_reference: PREFIX },
      { designation: `${PREFIX} prestation complémentaire`, unit_price: 2500, quantity: 2 },
    ];
    state.orders.a = await makeOrder(admin, state.accounts.clientA.id, lines);
    state.orders.b = await makeOrder(admin, state.accounts.clientB.id, [lines[0]]);
    state.orders.d = await makeOrder(admin, state.accounts.clientA.id, [lines[1]]);
    state.orders.e = await makeOrder(admin, state.accounts.clientA.id, [lines[1]]);
    state.orders.cancelled = await makeOrder(admin, state.accounts.clientA.id, [lines[1]]);
    await admin.rpc('cancel_order', { p_order_id: state.orders.cancelled.id, p_reason: `${PREFIX} annulation` });

    state.s = {
      clientA: await signIn(target, state.accounts.clientA.email),
      clientB: await signIn(target, state.accounts.clientB.email),
      superAdmin: await signInAal2(target, state.accounts.superAdmin.email),
      adminIssuer: await signInAal2(target, state.accounts.adminIssuer.email),
      adminUpdater: await signInAal2(target, state.accounts.adminUpdater.email),
      adminReader: await signInAal2(target, state.accounts.adminReader.email),
      adminNone: await signInAal2(target, state.accounts.adminNone.email),
    };

    await checkPermissions(state);
    if (state.invoiceA) {
      await checkIdempotence(state);
      await checkSnapshot(state);
      await checkReading(state);
      if (base) await checkHttp(state, base);
      else log.skip('Route HTTP non éprouvée : passer --base pour la contrôler');
    }
  } catch (error) {
    results.failed += 1;
    log.fail(`interruption : ${error.message}`);
  } finally {
    await teardown(state, before);
  }

  console.log(`\n${results.passed} réussi(s), ${results.failed} échec(s).`);
  process.exit(results.failed === 0 ? 0 : 1);
}

await main();
