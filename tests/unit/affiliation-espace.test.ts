/**
 * Espace affilié — phase 4H-8 : navigation, isolement, une seule vérité.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { AFFILIATE_SPACE_SECTIONS } from '../../src/components/affiliation/AffiliateSpaceNav';
import { codeState, commissionTone, prospectTone } from '../../src/lib/affiliation/space-labels';

const ROOT = process.cwd();
const SPACE = resolve(ROOT, 'src/app/(site)/(compte)/espace-affilie');
const read = (path: string) => readFileSync(path, 'utf8');
const pages = AFFILIATE_SPACE_SECTIONS.map((section) => {
  const sub = section.href.replace('/espace-affilie/', '').replace(/\/$/, '');
  return { section, file: join(SPACE, sub, 'page.tsx') };
});
const SQL = read(resolve(ROOT, 'supabase/migrations/20261001210000_affiliation_espace.sql'));

test('chaque rubrique de la navigation a sa page', () => {
  assert.equal(AFFILIATE_SPACE_SECTIONS.length, 10);
  for (const { section, file } of pages) assert.ok(existsSync(file), `${section.label} → ${file}`);
});

test('chaque page relit l’affiliation de la session, et rien d’autre', () => {
  for (const { section, file } of pages) {
    const text = read(file);
    assert.match(text, /const space = await getMySpace\(\);\s*if \(space\.state !== 'ready'\) return null;/, section.label);
    // Jamais la clé à privilèges, jamais un identifiant d'affilié venu de l'adresse.
    assert.doesNotMatch(text, /getAdminSupabaseClient|searchParams|params\b/, section.label);
  }
  const loader = read(resolve(ROOT, 'src/lib/affiliation/space.ts'));
  assert.match(loader, /requirePrivateAccess\(AUTH_ROUTES\.affiliateArea\)/);
  assert.doesNotMatch(loader, /getAdminSupabaseClient/);
  assert.match(loader, /\.eq\('user_id', me\.user\.id\)/);
});

test('l’espace parle le langage des espaces privés, jamais celui de l’administration', () => {
  const files = [...pages.map((page) => page.file), join(SPACE, 'layout.tsx'),
    resolve(ROOT, 'src/components/affiliation/SpaceUi.tsx'), resolve(ROOT, 'src/components/affiliation/AffiliateSpaceNav.tsx')];
  for (const file of files) assert.doesNotMatch(read(file), /className="admin-|className=\{`admin-/, file);
});

test('les chiffres viennent des mêmes fonctions que l’administration', () => {
  const loader = read(resolve(ROOT, 'src/lib/affiliation/space.ts'));
  for (const fn of ['affiliate_commission_totals', 'affiliate_stats', 'my_affiliate_conversions']) assert.match(loader, new RegExp(`rpc\\('${fn}'`));
  const admin = read(resolve(ROOT, 'src/lib/affiliation/admin.ts'));
  assert.match(admin, /rpc\('affiliate_commission_totals'/);
});

test('l’affilié ne modifie que son téléphone, sa ville et son pays', () => {
  const fn = SQL.slice(SQL.indexOf('create or replace function public.update_my_affiliate_contact'), SQL.indexOf('comment on function'));
  assert.match(fn, /where user_id = auth\.uid\(\) for update/);
  assert.match(fn, /set contact_phone = v_phone, city = v_city, country = v_country/);
  assert.doesNotMatch(fn, /set [^;]*(display_name|contact_email|category_id|status|slug|payout|acquisition|legal_name)/);
  assert.match(fn, /v_before\.status = 'TERMINE'/);
  assert.match(fn, /affiliation_log/);
});

test('remise client et commission ne se confondent pas à l’écran', () => {
  const codes = read(join(SPACE, 'codes', 'page.tsx'));
  assert.match(codes, /Remise client ≠ commission\./);
  assert.match(codes, /Remise client : /);
});

test('les versements de l’espace ne lisent ni note interne ni justificatif', () => {
  const loader = read(resolve(ROOT, 'src/lib/affiliation/space.ts'));
  const select = loader.match(/from\('affiliate_payouts'\)\s*\.select\('([^']+)'\)/)?.[1] ?? '';
  assert.ok(select.includes('method_snapshot'));
  assert.doesNotMatch(select, /note|proof_path/);
});

test('les états affichés traduisent la base sans rien décider', () => {
  assert.equal(commissionTone('ACQUISE'), 'ok');
  assert.equal(commissionTone('ANNULEE'), 'muted');
  assert.equal(prospectTone('REFUSE'), 'warn');
  const at = new Date('2026-10-02T10:00:00Z');
  assert.equal(codeState({ is_active: true, valid_from: '2026-10-01T00:00:00Z', valid_to: null }, at).label, 'Actif');
  assert.equal(codeState({ is_active: true, valid_from: '2026-11-01T00:00:00Z', valid_to: null }, at).label, 'À venir');
  assert.equal(codeState({ is_active: true, valid_from: '2026-09-01T00:00:00Z', valid_to: '2026-10-01T00:00:00Z' }, at).label, 'Expiré');
  assert.equal(codeState({ is_active: false, valid_from: '2026-09-01T00:00:00Z', valid_to: null }, at).label, 'Désactivé');
});

test('aucun fichier source ne contient de caractère de contrôle brut', () => {
  // Un caractère de contrôle littéral fait passer un fichier pour binaire :
  // les outils de recherche l'ignorent alors pendant un audit.
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx|mjs|css|sql)$/.test(name) ? [path] : [];
    });
  for (const file of [...walk(resolve(ROOT, 'src')), ...walk(resolve(ROOT, 'scripts')), ...walk(resolve(ROOT, 'tests')), ...walk(resolve(ROOT, 'supabase/migrations'))]) {
    const bytes = readFileSync(file);
    const bad = bytes.findIndex((b) => (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f);
    assert.equal(bad, -1, `${file} contient un caractère de contrôle à l’octet ${bad}`);
  }
});
