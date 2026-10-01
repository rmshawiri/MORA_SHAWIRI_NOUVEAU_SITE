/**
 * Candidatures au programme d'affiliation — phase 4H-2.
 *
 * Ces tests lisent le SQL et exécutent les modules purs ; ils ne touchent pas
 * la base. `npm run affiliation:verify` éprouve les mêmes règles contre la
 * vraie base, avec de vraies sessions.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APPLICATION_TRANSITIONS,
  EMPTY_DRAFT,
  PAYOUT_FIELDS,
  PROFILE_OPTIONS,
  PROFILE_QUESTIONS,
  canTransitionApplication,
  maskPayoutValue,
  payoutDetailsFor,
  profileAnswersFor,
  validateDraft,
  validateStep,
  type ApplicationDraft,
  type ApplicationStatus,
  type PayoutMethodOption,
} from '../../src/lib/affiliation/applications';
import {
  renderApplicationReceived,
  renderApplicationStatus,
  renderApplicationTeam,
  type ApplicationSummary,
} from '../../src/lib/emails/affiliation';
import { sanitizeSmtpError } from '../../src/lib/emails/smtp-error';

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261001150000_affiliation_candidatures.sql'),
  'utf8',
);

const METHODS: PayoutMethodOption[] = [
  { code: 'MVOLA', label: 'Paiement via Mvola', kind: 'MOBILE_MONEY' },
  { code: 'VIREMENT', label: 'Virement bancaire', kind: 'BANK_TRANSFER' },
  { code: 'PAYPAL', label: 'Paiement via PayPal', kind: 'ONLINE' },
  { code: 'CHEQUE', label: 'Paiement par chèque', kind: 'CHEQUE' },
  { code: 'ESPECES', label: 'Espèces', kind: 'CASH' },
];

const complete: ApplicationDraft = {
  ...EMPTY_DRAFT,
  firstName: 'Amina',
  lastName: 'Ahmed',
  email: 'amina@example.com',
  phone: '+269 321 00 00',
  country: 'Union des Comores',
  city: 'Moroni',
  profile: 'INFLUENCEUR',
  answers: { reseaux: 'Instagram', liens: 'https://instagram.com/amina', audience: '1 000 à 10 000 personnes' },
  motivation: 'Je présente MORA Shawiri à mon audience de commerçants.',
  idea: '',
  payoutMethod: 'MVOLA',
  payoutDetails: { numero: '321 00 00', titulaire: 'Amina Ahmed' },
  consent: true,
};

// -----------------------------------------------------------------------------
// Parité TypeScript / SQL
// -----------------------------------------------------------------------------

test('le graphe des statuts est le même en TypeScript et en SQL', () => {
  const block = SQL.slice(
    SQL.indexOf('create or replace function public.affiliate_application_transition_ok'),
    SQL.indexOf('create or replace function public.tg_affiliate_applications_guard'),
  );
  const sqlPairs = [...block.matchAll(/\('([A-Z_]+)',\s+'([A-Z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
  const tsPairs = Object.entries(APPLICATION_TRANSITIONS)
    .flatMap(([from, targets]) => targets.map((to) => `${from}>${to}`))
    .sort();
  assert.deepEqual(tsPairs, sqlPairs);
});

test('une décision est définitive : rien ne sort d’ACCEPTEE ni de REFUSEE', () => {
  for (const from of ['ACCEPTEE', 'REFUSEE'] as ApplicationStatus[]) {
    for (const to of Object.keys(APPLICATION_TRANSITIONS) as ApplicationStatus[]) {
      assert.equal(canTransitionApplication(from, to), false, `${from} → ${to}`);
    }
  }
});

test('les champs de versement sont les mêmes en TypeScript et en SQL', () => {
  const block = SQL.slice(
    SQL.indexOf('create or replace function public.affiliate_payout_details_valid'),
    SQL.indexOf('-- 2. LES CANDIDATURES'),
  );
  for (const [kind, fields] of Object.entries(PAYOUT_FIELDS)) {
    const match = block.match(new RegExp(`when '${kind}'\\s+then v_allowed := array\\[([^\\]]*)\\]`));
    assert.ok(match, `famille ${kind} absente du SQL`);
    const sqlKeys = [...match[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(fields.map((f) => f.key).sort(), sqlKeys, kind);
  }
});

test('les profils proposés au public n’incluent aucune catégorie interne', () => {
  const values = PROFILE_OPTIONS.map((option) => option.value);
  assert.deepEqual(values, ['PARTICULIER', 'INFLUENCEUR', 'COMMUNAUTE', 'APPORTEUR', 'PROFESSIONNEL', 'AUTRE']);
  const text = JSON.stringify(PROFILE_OPTIONS);
  assert.doesNotMatch(text, /Équipe|Recruté|EQUIPE|RECRUTE/);
  const sqlProfiles = SQL.match(/requested_profile in \(([^)]*)\)/)![1]!;
  for (const value of values) assert.ok(sqlProfiles.includes(`'${value}'`), value);
});

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

test('une candidature complète passe toutes les étapes', () => {
  assert.equal(validateDraft(complete, METHODS), null);
});

test('chaque étape refuse ce qui lui manque', () => {
  assert.ok(validateStep('identite', { ...complete, email: 'pas-une-adresse' }, METHODS).email);
  assert.ok(validateStep('identite', { ...complete, phone: '12' }, METHODS).phone);
  assert.ok(validateStep('identite', { ...complete, city: ' ' }, METHODS).city);
  assert.ok(validateStep('profil', { ...complete, profile: '' }, METHODS).profile);
  assert.ok(validateStep('potentiel', { ...complete, answers: { reseaux: 'Instagram' } }, METHODS)['answers.liens']);
  assert.ok(
    validateStep('potentiel', { ...complete, answers: { ...complete.answers, audience: 'Un million' } }, METHODS)['answers.audience'],
    'une réponse hors liste est refusée',
  );
  assert.ok(validateStep('motivation', { ...complete, motivation: '' }, METHODS).motivation);
  assert.ok(validateStep('paiement', { ...complete, payoutMethod: 'INCONNU' }, METHODS).payoutMethod);
  assert.ok(validateStep('paiement', { ...complete, payoutDetails: { numero: '321' } }, METHODS)['payout.titulaire']);
  assert.ok(validateStep('recapitulatif', { ...complete, consent: false }, METHODS).consent);
});

test('une question facultative peut rester vide', () => {
  const pro: ApplicationDraft = {
    ...complete,
    profile: 'PROFESSIONNEL',
    answers: { entreprise: 'Boutique Moroni', activite: 'Commerce' },
  };
  assert.deepEqual(validateStep('potentiel', pro, METHODS), {});
});

test('chaque moyen n’exige que ses champs utiles', () => {
  assert.deepEqual(validateStep('paiement', { ...complete, payoutMethod: 'ESPECES', payoutDetails: {} }, METHODS), {});
  assert.ok(validateStep('paiement', { ...complete, payoutMethod: 'PAYPAL', payoutDetails: { email: 'x' } }, METHODS)['payout.email']);
  const virement = validateStep('paiement', { ...complete, payoutMethod: 'VIREMENT', payoutDetails: {} }, METHODS);
  assert.deepEqual(Object.keys(virement).sort(), ['payout.banque', 'payout.compte', 'payout.titulaire']);
});

test('seules les réponses du profil choisi et les champs du moyen choisi sont transmis', () => {
  const answers = profileAnswersFor({ ...complete, answers: { ...complete.answers, entreprise: 'intrus' } });
  assert.deepEqual(Object.keys(answers).sort(), ['audience', 'liens', 'reseaux']);
  const details = payoutDetailsFor('MOBILE_MONEY', { numero: ' 321 00 00 ', titulaire: 'Amina', compte: 'intrus' });
  assert.deepEqual(details, { numero: '321 00 00', titulaire: 'Amina' });
});

test('les questions de chaque profil ont des clés acceptées par la base', () => {
  for (const questions of Object.values(PROFILE_QUESTIONS)) {
    for (const question of questions) assert.match(question.key, /^[a-z][a-z_]{1,30}$/);
  }
});

test('une coordonnée financière s’affiche masquée', () => {
  assert.equal(maskPayoutValue('430 63 06'), '•••• 6306');
  assert.equal(maskPayoutValue('123'), '••••');
});

// -----------------------------------------------------------------------------
// E-mails
// -----------------------------------------------------------------------------

const summary: ApplicationSummary = {
  firstName: 'Amina <script>',
  lastName: 'Ahmed',
  email: 'amina@example.com',
  phone: '+269 321 00 00',
  country: 'Union des Comores',
  city: 'Moroni',
  profileLabel: 'Influenceur ou créateur de contenu',
  payoutLabel: 'Paiement via Mvola',
  answers: [{ label: 'Réseaux', value: 'Instagram' }],
  motivation: 'Mon audience <b>commerçante</b>',
  idea: null,
  submittedAt: new Date('2026-10-01T08:00:00Z'),
};

const allEmails = () => [
  renderApplicationReceived(summary),
  renderApplicationTeam(summary, 'https://example.org/administration/affiliation/candidatures/x/'),
  renderApplicationStatus('EN_ETUDE', { firstName: 'Amina' }),
  renderApplicationStatus('INFOS_REQUISES', { firstName: 'Amina', message: 'Lien vers votre page ?' }),
  renderApplicationStatus('ACCEPTEE', { firstName: 'Amina', message: null }),
  renderApplicationStatus('REFUSEE', { firstName: 'Amina', message: 'Merci de votre intérêt.' }),
];

test('aucun e-mail de candidature ne promet un taux, un montant ni un délai', () => {
  for (const email of allEmails()) {
    const text = email.rendered.text;
    assert.doesNotMatch(text, /\d+\s?%/, email.subject);
    assert.doesNotMatch(text, /\b(24|48|72)\s?h\b|sous \d+ (jours|heures)|dans les \d+/i, email.subject);
    assert.doesNotMatch(text, /KMF/, email.subject);
  }
});

test('la saisie du candidat est échappée, jamais interprétée', () => {
  const received = renderApplicationReceived(summary);
  assert.ok(!received.rendered.html.includes('<script>'));
  assert.ok(received.rendered.html.includes('Amina &lt;script&gt;'));
  const team = renderApplicationTeam(summary, 'https://example.org/x/');
  assert.ok(!team.rendered.html.includes('<b>commerçante</b>'));
});

test('l’e-mail à l’équipe ne contient aucune coordonnée financière', () => {
  const team = renderApplicationTeam(summary, 'https://example.org/x/');
  assert.match(team.rendered.text, /Paiement via Mvola/);
  assert.doesNotMatch(team.rendered.text, /321 00 00.*titulaire|titulaire/i);
  assert.match(team.rendered.text, /payouts\.view/);
  assert.match(team.subject, /^\[Site\] Affiliation — candidature de /);
});

test('un refus ne transporte que le message rédigé pour le candidat', () => {
  const refused = renderApplicationStatus('REFUSEE', { firstName: 'Amina', message: null });
  assert.doesNotMatch(refused.rendered.text, /motif interne/i);
  assert.match(refused.subject, /candidature/);
});

test('les e-mails sont en français, signés, avec l’identité MORA Shawiri', () => {
  for (const email of allEmails()) {
    assert.match(email.rendered.html, /MORA Shawiri/);
    assert.match(email.rendered.text, /MORA Shawiri/);
    assert.ok(email.rendered.text.length > 80);
  }
  assert.match(renderApplicationStatus('INFOS_REQUISES', { firstName: 'Amina', message: 'Lien ?' }).rendered.text, /Lien \?/);
});

test('une erreur SMTP est consignée sans adresse ni identifiant', () => {
  const error = Object.assign(new Error('Invalid login: 535 auth failed for contact@morashawiri.com password=abc'), {
    code: 'EAUTH',
  });
  const cleaned = sanitizeSmtpError(error);
  assert.match(cleaned, /^EAUTH/);
  assert.doesNotMatch(cleaned, /@|password|abc/i);
  assert.ok(cleaned.length <= 300);
});

// -----------------------------------------------------------------------------
// Sécurité de la migration
// -----------------------------------------------------------------------------

test('la porte publique n’accepte ni compte, ni catégorie, ni statut', () => {
  const signature = SQL.slice(
    SQL.indexOf('create or replace function public.submit_affiliate_application('),
    SQL.indexOf('returns table (application_id uuid, duplicate boolean)'),
  );
  assert.doesNotMatch(signature, /p_user|p_category|p_status|p_affiliate/);
  assert.match(SQL, /auth\.uid\(\),\s*\n\s*'site'/);
});

test('les coordonnées de versement ne sont accordées à aucune session', () => {
  const grant = SQL.slice(SQL.indexOf('grant select (id, status'), SQL.indexOf('on public.affiliate_applications to authenticated'));
  assert.ok(grant.length > 0);
  assert.doesNotMatch(grant, /payout_details/);
  assert.match(SQL, /application_payout_details[\s\S]*has_permission\('payouts\.view'\)/);
});

test('aucune écriture directe n’est accordée aux sessions', () => {
  assert.doesNotMatch(SQL, /grant (insert|update|delete)[^;]*on public\.(affiliate_applications|affiliate_application_events|email_outbox) to (anon|authenticated)/);
  const anonGrants = [...SQL.matchAll(/grant[^;]*to[^;]*\banon\b[^;]*;/g)].map((m) => m[0]);
  for (const grant of anonGrants) assert.match(grant, /grant\s+execute on function public\.(affiliate_payout_methods|submit_affiliate_application)/);
});

test('Wakati n’est pas proposé pour les versements tant que le service n’existe pas', () => {
  const update = SQL.slice(SQL.indexOf('update public.payment_methods'), SQL.indexOf('-- Liste publique'));
  assert.doesNotMatch(update, /WAKATI/);
});
