/**
 * Attribution — phase 4H-4 : liens, cookie, prospects, confidentialité.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { visitorHash } from '../../src/lib/affiliation/click';
import { PROSPECT_TRANSITIONS, validateProspect } from '../../src/lib/affiliation/prospects';
import {
  ATTRIBUTION_COOKIE,
  attributionCookie,
  isAutomatedAgent,
  readAttributionToken,
  readReferral,
} from '../../src/lib/affiliation/tracking';

const SQL = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261001170000_affiliation_attribution.sql'), 'utf8');
const LEGAL = readFileSync(resolve(process.cwd(), 'src/content/legal.tsx'), 'utf8');
const PROXY = readFileSync(resolve(process.cwd(), 'src/proxy.ts'), 'utf8');

test('un lien d’affiliation est lu, puis retiré de l’adresse', () => {
  const hit = readReferral(new URL('https://exemple.km/services/?ref=Amina-Ahmed&c=whatsapp&x=1'));
  assert.ok(hit);
  assert.equal(hit.slug, 'amina-ahmed');
  assert.equal(hit.campaign, 'whatsapp');
  assert.equal(hit.cleanUrl.toString(), 'https://exemple.km/services/?x=1');
  assert.equal(readReferral(new URL('https://exemple.km/?q=1')), null);
});

test('un identifiant malformé est nettoyé de l’adresse sans être enregistré', () => {
  const hit = readReferral(new URL('https://exemple.km/?ref=amina@exemple.km'));
  assert.ok(hit);
  assert.equal(hit.slug, '');
  assert.equal(hit.cleanUrl.search, '');
  const bad = readReferral(new URL('https://exemple.km/?ref=amina&c=%2B269'));
  assert.equal(bad?.campaign, null);
});

test('les aperçus de liens et les robots ne sont pas des clics', () => {
  for (const agent of [
    'WhatsApp/2.23.20.0 A',
    'facebookexternalhit/1.1',
    'Mozilla/5.0 (compatible; Googlebot/2.1)',
    'TelegramBot (like TwitterBot)',
    'curl/8.0',
    null,
  ]) {
    assert.equal(isAutomatedAgent(agent), true, String(agent));
  }
  assert.equal(isAutomatedAgent('Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile Safari/537.36'), false);
});

test('le cookie ne porte qu’un jeton, inaccessible aux scripts, pour la durée de la fenêtre', () => {
  const cookie = attributionCookie('2b5f2c8e-1d1a-4a6b-9c55-3a8a6f5d9e10', 90, true);
  assert.equal(cookie.name, ATTRIBUTION_COOKIE);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.secure, true);
  assert.equal(cookie.sameSite, 'lax');
  assert.equal(cookie.maxAge, 90 * 86_400);
  assert.equal(readAttributionToken('pas-un-jeton'), null);
  assert.equal(readAttributionToken("x'; drop table"), null);
});

test('l’empreinte d’un visiteur change chaque jour et ne contient pas l’adresse', () => {
  const a = visitorHash('secret', '41.207.1.2', 'Mozilla', '2026-10-01');
  const b = visitorHash('secret', '41.207.1.2', 'Mozilla', '2026-10-02');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.ok(!a.includes('41.207'));
});

test('le proxy n’intercepte ni l’API ni l’administration', () => {
  assert.match(PROXY, /pathname\.startsWith\('\/api\/'\) \|\| pathname\.startsWith\('\/administration\/'\)/);
  assert.match(PROXY, /request\.method !== 'GET'/);
});

test('le graphe des prospects est le même en TypeScript et en SQL', () => {
  const block = SQL.slice(SQL.indexOf('affiliate_prospect_transition_ok'), SQL.indexOf('tg_affiliate_prospects_guard'));
  const sqlPairs = [...block.matchAll(/\('([A-Z_]+)',\s+'([A-Z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
  const tsPairs = Object.entries(PROSPECT_TRANSITIONS).flatMap(([from, to]) => to.map((t) => `${from}>${t}`)).sort();
  assert.deepEqual(tsPairs, sqlPairs);
});

test('une déclaration de prospect exige le strict nécessaire et l’accord du prospect', () => {
  const ok = { fullName: 'Ali', company: '', phone: '+269 321 00 00', email: '', need: 'Un site vitrine', comment: '', consent: true };
  assert.deepEqual(validateProspect(ok), {});
  assert.ok(validateProspect({ ...ok, consent: false }).consent);
  assert.ok(validateProspect({ ...ok, phone: '12' }).phone);
  assert.ok(validateProspect({ ...ok, need: '' }).need);
  assert.ok(validateProspect({ ...ok, email: 'x' }).email);
});

test('l’affilié ne voit jamais les coordonnées d’un client', () => {
  const fn = SQL.slice(SQL.indexOf('create or replace function public.my_affiliate_conversions'), SQL.indexOf('comment on function public.my_affiliate_conversions'));
  assert.doesNotMatch(fn, /customer_name|customer_email|customer_phone|full_name|email|phone/);
  // Il ne lit pas non plus les attributions brutes, qui désignent la demande et le prospect.
  assert.match(SQL, /create policy affiliate_attributions_select[\s\S]*?using \(public\.can_view_affiliation\(\)\)/);
});

test('ni l’empreinte du visiteur, ni le jeton, ni l’indice de rapprochement ne sont accordés aux sessions', () => {
  const clicks = SQL.slice(SQL.indexOf('grant select (id, affiliate_id, campaign_id, landing_path'), SQL.indexOf('on public.affiliate_clicks to authenticated'));
  assert.doesNotMatch(clicks, /visitor_hash|token/);
  const prospects = SQL.slice(SQL.indexOf('grant select (id, affiliate_id, status, full_name'), SQL.indexOf('on public.affiliate_prospects to authenticated'));
  assert.doesNotMatch(prospects, /review_hint/);
});

test('un seul code par commande, une seule attribution courante par affaire', () => {
  assert.match(SQL, /affiliate_code_uses_one_per_order[\s\S]*?where status = 'ACTIVE'/);
  assert.match(SQL, /affiliate_attributions_one_per_order[\s\S]*?status in \('ACTIVE', 'VALIDEE'\)/);
  assert.match(SQL, /affiliate_attributions_one_per_request[\s\S]*?status in \('ACTIVE', 'VALIDEE'\)/);
});

test('une attribution validée ne se déplace pas : ni par un code, ni par une attribution manuelle', () => {
  assert.match(SQL, /Une attribution validée existe : révoquez-la d''abord/);
  assert.match(SQL, /Une attribution validée à un autre affilié existe : révoquez-la d''abord/);
});

test('les politiques publiées décrivent le cookie d’attribution et les coordonnées de versement', () => {
  assert.match(LEGAL, /Cookie d’attribution d’affiliation/);
  assert.match(LEGAL, /mora_aff/);
  assert.doesNotMatch(LEGAL, /ne demandons jamais d’informations bancaires/);
  assert.doesNotMatch(LEGAL, /Il ne propose ni compte utilisateur/);
});
