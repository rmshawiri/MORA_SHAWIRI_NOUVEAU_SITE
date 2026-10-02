/**
 * Espace client — socle (phase 4I-1).
 *
 * Règles pures du profil, garde-fous de la migration (identité par
 * `auth.uid()`, référence définitive, aucune écriture directe), structure de
 * l'espace (session, filtrage par compte, aucune clé à privilèges), et
 * protection de la suite MORA-CLI par les contrôles automatisés.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { greetingName, readClientProfile } from '../../src/lib/client/profile';
import { restoreClientSequence } from '../../scripts/lib/client-sequence.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SPACE = resolve(ROOT, 'src', 'app', '(site)', '(compte)', 'espace-client', '(espace)');
const MIGRATION = readFileSync(resolve(ROOT, 'supabase', 'migrations', '20261002120000_espace_client_socle.sql'), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function fn(name: string): string {
  const start = MIGRATION.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `fonction ${name} absente`);
  const ends = ['\n$$;', '\n$fn$;'].map((marker) => MIGRATION.indexOf(marker, start)).filter((index) => index > 0);
  return MIGRATION.slice(start, Math.min(...ends));
}

/* -------------------------------------------------------------------------- */
/* Profil : règles pures                                                       */
/* -------------------------------------------------------------------------- */

const base = { nom: 'Awa Saïd', telephone: '+269 321 00 00', whatsapp: '', memeNumero: null, preference: '' };

test('un profil complet et cohérent est accepté', () => {
  const result = readClientProfile({ ...base, whatsapp: '+33 6 00 00 00 00', preference: 'WHATSAPP' });
  assert.deepEqual(result, {
    ok: true,
    value: { fullName: 'Awa Saïd', phone: '+269 321 00 00', whatsapp: '+33 6 00 00 00 00', contactPreference: 'WHATSAPP' },
  });
});

test('« même numéro » recopie le téléphone dans WhatsApp, explicitement', () => {
  const result = readClientProfile({ ...base, whatsapp: 'ignoré', memeNumero: 'on' });
  assert.equal(result.ok && result.value.whatsapp, '+269 321 00 00');
  assert.equal(readClientProfile({ ...base, telephone: '', memeNumero: 'on' }).ok, false);
});

test('on ne préfère pas un canal non renseigné', () => {
  assert.equal(readClientProfile({ ...base, preference: 'WHATSAPP' }).ok, false);
  assert.equal(readClientProfile({ ...base, telephone: '', preference: 'TELEPHONE' }).ok, false);
  assert.equal(readClientProfile({ ...base, telephone: '', preference: 'EMAIL' }).ok, true);
  assert.equal(readClientProfile({ ...base, preference: 'SMS' }).ok, false);
});

test('nom obligatoire, numéros au format de la base', () => {
  assert.equal(readClientProfile({ ...base, nom: ' ' }).ok, false);
  assert.equal(readClientProfile({ ...base, nom: 'A' }).ok, false);
  assert.equal(readClientProfile({ ...base, telephone: 'abc' }).ok, false);
  assert.equal(readClientProfile({ ...base, whatsapp: '12' }).ok, false);
  const empty = readClientProfile({ ...base, telephone: '  ', whatsapp: '' });
  assert.equal(empty.ok && empty.value.phone, null);
});

test('la salutation vient du nom réel, jamais d’un prénom inventé', () => {
  assert.equal(greetingName('Awa Saïd'), 'Awa');
  assert.equal(greetingName(null), null);
  assert.equal(greetingName('   '), null);
});

/* -------------------------------------------------------------------------- */
/* Migration                                                                   */
/* -------------------------------------------------------------------------- */

test('le code CLI n’est admis que comme référence seule, sans toucher aux pièces', () => {
  assert.match(MIGRATION, /code ~ '\^\[A-Z\]\{4,6\}\$' or \(code ~ '\^\[A-Z\]\{3\}\$' and is_reference_only\)/);
  assert.match(MIGRATION, /\('CLI', 'Client', 'client', 'users\.view', 'users\.create', \d+, true\)/);
  assert.doesNotMatch(MIGRATION, /alter table public\.documents\b/);
  assert.match(MIGRATION, /allocate_document_number\('CLI'\)/);
  assert.doesNotMatch(MIGRATION, /document_sequences/);
});

test('la référence est définitive, et la fiche ne se supprime pas en direct', () => {
  const guard = fn('tg_clients_guard');
  assert.match(guard, /new\.reference is distinct from old\.reference/);
  assert.match(guard, /new\.user_id is distinct from old\.user_id/);
  assert.match(guard, /exists \(select 1 from public\.profiles p where p\.id = old\.user_id\)/);
  // Aucune exception pour un rôle privilégié : même la clé de service est refusée.
  assert.doesNotMatch(guard, /is_privileged_db_role/);
});

test('aucune écriture directe sur la fiche client, lecture limitée au titulaire ou à users.view', () => {
  assert.match(MIGRATION, /revoke all on public\.clients from anon, authenticated;/);
  assert.match(MIGRATION, /grant select on public\.clients to authenticated;/);
  assert.doesNotMatch(MIGRATION, /grant (insert|update|delete)[^;]*on public\.clients/);
  assert.match(MIGRATION, /using \(user_id = auth\.uid\(\) or public\.has_permission\('users\.view'\)\)/);
});

test('l’attribution exige le rôle CLIENT et une adresse confirmée, une seule fois', () => {
  const ensure = fn('ensure_client_reference');
  assert.match(ensure, /pg_advisory_xact_lock/);
  assert.match(ensure, /r\.code = 'CLIENT'/);
  assert.match(ensure, /email_confirmed_at is not null/);
  assert.match(MIGRATION, /revoke execute on function public\.ensure_client_reference\(uuid\) from public, anon, authenticated;/);
  // La réparation par le titulaire ne prend aucun paramètre : identité = session.
  assert.match(MIGRATION, /function public\.ensure_my_client_reference\(\)\s/);
  assert.match(fn('ensure_my_client_reference'), /ensure_client_reference\(auth\.uid\(\)\)/);
});

test('les déclencheurs d’attribution ne font jamais échouer une inscription', () => {
  for (const name of ['tg_user_roles_client_reference', 'tg_auth_users_client_reference']) {
    assert.match(fn(name), /exception when others then\s+raise warning/);
  }
  assert.match(MIGRATION, /when \(old\.email_confirmed_at is null and new\.email_confirmed_at is not null\)/);
});

test('les clients existants sont numérotés dans l’ordre de création, sans doublon', () => {
  assert.match(MIGRATION, /order by u\.created_at, u\.id/);
  assert.match(MIGRATION, /not exists \(select 1 from public\.clients c where c\.user_id = u\.id\)/);
});

test('le profil s’écrit par auth.uid(), compte actif exigé, journalisé', () => {
  const update = fn('update_my_client_profile');
  assert.match(update, /v_uid\s+uuid := auth\.uid\(\)/);
  assert.match(update, /v_profile\.status <> 'ACTIF' or v_profile\.deleted_at is not null/);
  assert.match(update, /record_audit_event\(\s*'clients\.profil\.modification'/);
  // Ni l'e-mail, ni le statut, ni l'identifiant, ni la référence.
  assert.doesNotMatch(update, /set[^;]*\b(email|status|username|reference)\s*=/);
  // Aucun paramètre ne désigne un compte.
  const signature = update.slice(0, update.indexOf(')'));
  assert.doesNotMatch(signature, /p_user|p_id|p_client/);
  assert.match(MIGRATION, /revoke execute on function public\.update_my_client_profile\(text, text, text, text\) from public, anon;/);
});

/* -------------------------------------------------------------------------- */
/* L'espace                                                                    */
/* -------------------------------------------------------------------------- */

test('chaque page de l’espace relit l’état du compte, aucune n’emploie la clé à privilèges', () => {
  const files = walk(SPACE).filter((path) => path.endsWith('.tsx'));
  for (const file of files.filter((path) => /(page|layout)\.tsx$/.test(path))) {
    assert.match(readFileSync(file, 'utf8'), /getMyClientSpace\(\)/, file);
  }
  for (const file of [...files, resolve(ROOT, 'src/lib/client/space.ts'), resolve(ROOT, 'src/lib/client/actions.ts')]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /getAdminSupabaseClient|SUPABASE_SECRET_KEY|service_role/, file);
  }
});

test('l’espace exige une session active et filtre chaque lecture sur le compte connecté', () => {
  const space = readFileSync(resolve(ROOT, 'src/lib/client/space.ts'), 'utf8');
  assert.match(space, /requirePrivateAccess\(AUTH_ROUTES\.clientArea\)/);
  const reads = [...space.matchAll(/\.from\('(orders|quote_requests|appointments|clients)'\)[\s\S]*?\.(eq\('user_id', [a-zA-Z.]+\))/g)];
  assert.equal(reads.length, 4, 'chaque table lue est filtrée sur user_id');
});

test('la navigation n’annonce que des rubriques réellement construites', () => {
  const nav = readFileSync(resolve(ROOT, 'src/components/client/ClientSpaceNav.tsx'), 'utf8');
  const hrefs = [...nav.matchAll(/href: '(\/espace-client\/[^']*)'/g)].map((match) => match[1]!);
  assert.ok(hrefs.length >= 2);
  // Une page peut vivre dans un groupe de routes « (…) », invisible dans l'adresse.
  const pages = walk(SPACE)
    .filter((path) => path.endsWith('page.tsx'))
    .map((path) => `/${path.slice(SPACE.length + 1).split(/[\\/]/).filter((part) => !/^\(.*\)$/.test(part)).join('/').replace(/page\.tsx$/, '')}`);
  for (const href of hrefs) {
    const route = href.replace(/^\/espace-client/, '');
    assert.ok(pages.includes(route), `${href} n’a pas de page (${pages.join(', ')})`);
  }
});

test('l’e-mail de connexion n’est pas modifiable depuis l’espace', () => {
  const form = readFileSync(resolve(ROOT, 'src/components/client/ClientProfileForm.tsx'), 'utf8');
  assert.doesNotMatch(form, /name="email"/);
  const action = readFileSync(resolve(ROOT, 'src/lib/client/actions.ts'), 'utf8');
  assert.doesNotMatch(action, /auth\.updateUser/);
});

test('les écrans de l’espace client ne contiennent aucune donnée d’exemple', () => {
  for (const file of walk(SPACE).filter((path) => path.endsWith('.tsx'))) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /MORA-(CMCL|DMCL|RVCL|CLI)-A\d{4}/, `${file} contient une référence écrite en dur`);
    assert.doesNotMatch(source, /lorem|exemple de commande|John Doe/i, file);
  }
});

/* -------------------------------------------------------------------------- */
/* Les contrôles automatisés ne consomment aucun numéro MORA-CLI               */
/* -------------------------------------------------------------------------- */

test('tout contrôle qui crée des comptes passe par le lanceur qui protège la suite CLI', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const scripts = readdirSync(resolve(ROOT, 'scripts')).filter((name) => /^verify-.*\.mjs$/.test(name));
  for (const name of scripts) {
    const source = readFileSync(resolve(ROOT, 'scripts', name), 'utf8');
    if (!/auth\.admin\.createUser|createAccount\(|signUp\(/.test(source)) continue;
    const entry = Object.values(pkg.scripts).find((command) => command.includes(`scripts/${name}`));
    assert.ok(entry, `${name} n’a pas d’entrée npm`);
    assert.match(entry!, /run-with-client-sequence\.mjs/, `${name} ne protège pas la suite MORA-CLI`);
  }
});

function fakeRunSql(state: { seq: { series: string; last_number: number; allocated_count: number } | null; refs: string[] }) {
  return async (_target: unknown, _token: unknown, sql: string) => {
    if (sql.startsWith('select reference from public.clients')) return state.refs.map((reference) => ({ reference }));
    if (sql.startsWith('select series')) return state.seq ? [state.seq] : [];
    if (sql.trim().startsWith('update public.document_sequences')) {
      const series = /series = '([A-Z]+)'/.exec(sql)![1]!;
      const last = Number(/last_number = (\d+)/.exec(sql)![1]);
      const alloc = Number(/allocated_count = (\d+)/.exec(sql)![1]);
      state.seq = { series, last_number: last, allocated_count: alloc };
      return [];
    }
    if (sql.trim().startsWith('delete from public.document_sequences')) {
      state.seq = null;
      return [];
    }
    throw new Error(`requête inattendue : ${sql}`);
  };
}

test('restitution : la suite revient exactement au relevé quand les comptes de contrôle ont disparu', async () => {
  const state = { seq: { series: 'A', last_number: 5, allocated_count: 5 }, refs: ['MORA-CLI-A0001', 'MORA-CLI-A0002'] };
  const result = await restoreClientSequence(fakeRunSql(state), {}, '', { series: 'A', last_number: 2, allocated_count: 2 });
  assert.equal(result.identical, true);
  assert.deepEqual(state.seq, { series: 'A', last_number: 2, allocated_count: 2 });
});

test('restitution : jamais sous un vrai client inscrit pendant le contrôle', async () => {
  const state = { seq: { series: 'A', last_number: 6, allocated_count: 6 }, refs: ['MORA-CLI-A0001', 'MORA-CLI-A0002', 'MORA-CLI-A0005'] };
  const result = await restoreClientSequence(fakeRunSql(state), {}, '', { series: 'A', last_number: 2, allocated_count: 2 });
  assert.equal(result.identical, false);
  assert.equal(result.restored, true);
  assert.deepEqual(state.seq, { series: 'A', last_number: 5, allocated_count: 3 });
  assert.match(result.note ?? '', /MORA-CLI-A0005/);
});

test('restitution : une suite qui n’existait pas est supprimée', async () => {
  const state = { seq: { series: 'A', last_number: 3, allocated_count: 3 } as { series: string; last_number: number; allocated_count: number } | null, refs: [] as string[] };
  const result = await restoreClientSequence(fakeRunSql(state), {}, '', null);
  assert.equal(result.identical, true);
  assert.equal(state.seq, null);
});

test('une date de création s’affiche en date lisible, dans le fuseau des Comores', async () => {
  const { formatClientDate } = await import('../../src/lib/client/labels');
  assert.equal(formatClientDate('2026-10-02T09:51:29.104432+00:00'), '2 octobre 2026');
  // 22 h 30 UTC le 1er octobre = 1 h 30 le 2 octobre à Moroni.
  assert.equal(formatClientDate('2026-10-01T22:30:00Z'), '2 octobre 2026');
  assert.equal(formatClientDate(null), '—');
  assert.equal(formatClientDate('n’importe quoi'), '—');
});

/* -------------------------------------------------------------------------- */
/* Lot 4I-2 — l'espace client ne s'élargit jamais aux droits d'administration  */
/* -------------------------------------------------------------------------- */

const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

test('« Mes commandes » et la fiche filtrent sur le compte de la session, pas seulement sur la RLS', () => {
  const client = read('src/lib/commerce/client.ts');
  const list = client.slice(client.indexOf('export async function listMyOrders'), client.indexOf('export type ActivePaymentMethod'));
  assert.match(list, /\.eq\('user_id', uid\)/);
  const find = client.slice(client.indexOf('export async function findMyOrder'));
  assert.match(find, /\.eq\('reference', reference\)\s*\.eq\('user_id', uid\)/);
  // La facture lue sur la fiche est celle dont le compte est titulaire.
  assert.match(find, /\.eq\('owner_id', uid\)/);
  assert.match(find, /from\('refunds'\)/);
});

test('les actions client de paiement vérifient la propriété avant tout appel', () => {
  const actions = read('src/lib/commerce/client-actions.ts');
  const declare = actions.slice(actions.indexOf('export async function declareMyPayment'), actions.indexOf('export async function attachMyProof'));
  assert.ok(declare.indexOf('ownsOrder(supabase, orderId)') > 0);
  assert.ok(declare.indexOf('ownsOrder(supabase, orderId)') < declare.indexOf("rpc('declare_payment'"));
  const attach = actions.slice(actions.indexOf('export async function attachMyProof'));
  assert.ok(attach.indexOf('ownsOrder(supabase, orderId, paymentId)') > 0);
  assert.ok(attach.indexOf('ownsOrder(supabase, orderId, paymentId)') < attach.indexOf('uploadPaymentProof('));
  const owns = actions.slice(actions.indexOf('async function ownsOrder'), actions.indexOf('function describe'));
  assert.match(owns, /\.eq\('user_id', me\.user\.id\)/);
  assert.match(owns, /\.eq\('order_id', order\.id\)/);
});

test('les routes partagées ont un mode « espace client » qui exige la propriété', () => {
  const documents = read('src/app/api/documents/[reference]/route.ts');
  assert.match(documents, /params\.get\('espace'\) === 'client'/);
  assert.match(documents, /\.eq\('owner_id', userData\.user\.id\)/);
  // Le contrôle a lieu avant toute lecture de pièce (facture, affiliation, autres).
  assert.ok(documents.indexOf("params.get('espace') === 'client'") < documents.indexOf("parseReference(reference)?.type === 'FACL'"));
  const proofs = read('src/app/api/justificatifs/[id]/route.ts');
  assert.match(proofs, /searchParams\.get\('espace'\) === 'client'/);
  assert.match(proofs, /\.eq\('user_id', me\.user\.id\)/);
  assert.ok(proofs.indexOf("get('espace') === 'client'") < proofs.indexOf('signProofUrl(proof.storage_path)'));
});

test('tous les liens de pièces et de justificatifs de l’espace client passent par ce mode', () => {
  for (const file of walk(SPACE).filter((path) => path.endsWith('.tsx'))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\/api\/(documents|justificatifs)\/\$\{[^}]+\}\/[^`'"]*/g)) {
      assert.match(match[0], /espace=client/, `${file} : ${match[0]}`);
    }
    for (const match of source.matchAll(/<(OfficialDocumentActions|DocumentShareButton)\b[\s\S]*?\/>/g)) {
      assert.match(match[0], /ownerOnly/, `${file} : ${match[1]} sans ownerOnly`);
    }
  }
});

test('les lectures de l’espace client ne sortent aucune note interne', () => {
  const commerce = read('src/lib/client/commerce.ts');
  assert.doesNotMatch(commerce.replace(/\/\*\*[\s\S]*?\*\//g, ''), /admin_note|reason'|select\('\*'\)/);
  for (const match of commerce.matchAll(/\.from\('(orders|payments|refunds|documents)'\)/g)) assert.ok(match);
  const fiche = readFileSync(resolve(SPACE, 'commandes', '[reference]', 'page.tsx'), 'utf8');
  assert.doesNotMatch(fiche, /admin_note|refund\.reason/);
});

test('passerelle retour : l’espace affilié ne propose l’espace client qu’à un compte CLIENT', () => {
  const nav = read('src/components/affiliation/AffiliateSpaceNav.tsx');
  assert.match(nav, /clientSpace = false/);
  assert.match(nav, /\{clientSpace \? \(/);
  const layout = read('src/app/(site)/(compte)/espace-affilie/layout.tsx');
  assert.match(layout, /roles\.includes\('CLIENT'\)/);
  assert.match(layout, /<AffiliateSpaceNav clientSpace=\{isClient\} \/>/);
});

test('aucune zone de chargement au-dessus de la fiche commande : une commande d’autrui répond 404', () => {
  // Une zone de chargement fait partir la réponse (200) avant que la page ne
  // sache si la commande existe ; `notFound()` ne pourrait plus poser le 404.
  const ancestors = ['', 'commandes', 'commandes/[reference]'];
  for (const dir of ancestors) {
    assert.ok(!existsSync(resolve(SPACE, dir, 'loading.tsx')), `loading.tsx dans ${dir || '(espace)'}`);
  }
  assert.ok(existsSync(resolve(SPACE, '(accueil)', 'loading.tsx')));
});
