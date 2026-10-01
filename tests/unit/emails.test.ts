import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  describeLifetime,
  renderSupabaseAuthTemplates,
  SUPABASE_CONFIRMATION_URL,
  SUPABASE_TEMPLATE_FIELDS,
} from '../../src/lib/emails/auth';
import { INVITATION_SUBJECT, renderInvitationEmail } from '../../src/lib/emails/invitation';
import { escapeHtml, renderEmail } from '../../src/lib/emails/layout';
import {
  renderConfirmationEmail,
  renderTeamEmail,
  type MailRequest,
} from '../../src/lib/emails/templates';

/**
 * Contrôles du lot de finition — gabarit commun des e-mails.
 *
 * Ce que ces tests établissent sans rien envoyer : chaque e-mail destiné à un
 * utilisateur porte l'identité MORA Shawiri, parle français, propose une
 * action qui existe réellement, et ne laisse passer aucune valeur saisie sous
 * forme de HTML. Pour les modèles Supabase, que le lien d'action fabriqué par
 * Supabase est repris intact.
 */

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const SITE = 'https://mora-shawiri-nouveau-site.vercel.app';

const request: MailRequest = {
  kind: 'devis',
  nom: 'Fatima Saïd',
  organisation: 'Association <script>',
  email: 'fatima@exemple.km',
  telephone: '+269 333 44 55',
  sujet: 'Site internet',
  budget: '',
  offre: '',
  message: 'Bonjour,\n<img src=x onerror=alert(1)>',
  details: [],
  receivedAt: '01/10/2026 12:30 (heure de Moroni)',
};

const supabase = renderSupabaseAuthTemplates({ siteUrl: SITE, linkLifetimeSeconds: 3600 });

/* ============================================================== gabarit === */

test('le gabarit porte l’identité, même quand les images sont bloquées', () => {
  const { html } = renderEmail(
    { preheader: 'p', title: 'Titre', blocks: [], reason: 'r' },
    SITE,
  );

  assert.match(html, /<html lang="fr">/);
  // Le logo est une image distante HTTPS stable, jamais une pièce jointe…
  assert.match(html, new RegExp(`<img src="${SITE}/logo-circle.png"[^>]*alt="MORA Shawiri"`));
  assert.doesNotMatch(html, /cid:/);
  // … et le nom est écrit en toutes lettres à côté : il reste si l'image manque.
  assert.match(html, />MORA Shawiri<\/div>/);
});

test('le gabarit tient sur un téléphone : largeur fluide, lien de secours sécable', () => {
  const { html } = renderEmail(
    { preheader: 'p', title: 'T', blocks: [{ kind: 'fallback', href: `${SITE}/x` }], reason: 'r' },
    SITE,
  );

  assert.match(html, /width:100%;max-width:600px/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1" \/>/);
  assert.match(html, /@media \(max-width: 480px\)/);
  assert.match(html, /word-break:break-all;overflow-wrap:anywhere/);
});

test('aucun bloc ne transporte de HTML : tout texte est échappé', () => {
  const { html } = renderEmail(
    {
      preheader: '<b>',
      title: '<script>alert(1)</script>',
      blocks: [
        { kind: 'paragraph', text: '<a href="https://piege.example">clic</a>' },
        { kind: 'rows', rows: [{ label: 'Nom', value: '"><img src=x>' }] },
        { kind: 'cta', button: { label: 'Aller', href: 'https://x.example/?a="b"' } },
      ],
      reason: 'r',
    },
    SITE,
  );

  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<a href="https:\/\/piege\.example">/);
  assert.doesNotMatch(html, /"><img src=x>/);
  assert.match(html, /href="https:\/\/x\.example\/\?a=&quot;b&quot;"/);
  assert.equal(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
});

test('la version texte dit l’essentiel : titre, action et adresse en clair, signature', () => {
  const { text } = renderEmail(
    {
      preheader: 'p',
      title: 'Confirmez',
      blocks: [
        { kind: 'paragraph', text: 'Pourquoi vous recevez ce message.' },
        { kind: 'cta', button: { label: 'Agir', href: `${SITE}/agir/` } },
      ],
      reason: 'Raison',
    },
    SITE,
  );

  assert.match(text, /^Confirmez\n/);
  assert.match(text, /Agir :\nhttps:\/\/mora-shawiri-nouveau-site\.vercel\.app\/agir\//);
  assert.match(text, /MORA Shawiri — Le Choix Optimal pour votre performance/);
  assert.match(text, /Raison\n$/);
  assert.doesNotMatch(text, /<[a-z]/i);
});

/* ======================================================== Supabase Auth === */

test('les modèles Supabase reprennent le lien d’action intact, en bouton et en clair', () => {
  for (const [key, template] of Object.entries(supabase)) {
    const occurrences = template.html.split(SUPABASE_CONFIRMATION_URL).length - 1;
    // bouton (href) + lien de secours (href et texte affiché)
    assert.equal(occurrences, 3, `${key} : ${occurrences} occurrence(s) du lien`);
    assert.match(template.html, /href="\{\{ \.ConfirmationURL \}\}"/);
  }
});

test('les modèles Supabase n’emploient aucune autre variable, et aucune valeur saisie', () => {
  for (const [key, template] of Object.entries(supabase)) {
    const variables = template.html.match(/\{\{[^}]*\}\}/g) ?? [];
    assert.deepEqual([...new Set(variables)], ['{{ .ConfirmationURL }}'], key);
    // Le nom saisi à l'inscription n'est jamais repris : voir l'en-tête de auth.ts.
    assert.doesNotMatch(template.html, /\.Data|\.Email|full_name/, key);
  }
});

test('les modèles Supabase sont en français, avec l’action attendue', () => {
  assert.equal(supabase.confirmation.subject, 'Confirmez votre adresse e-mail — MORA Shawiri');
  assert.match(supabase.confirmation.html, />Confirmer mon adresse e-mail<\/a>/);
  assert.match(supabase.confirmation.html, /pas à l’origine de cette inscription/);

  assert.equal(supabase.recovery.subject, 'Réinitialisation de votre mot de passe — MORA Shawiri');
  assert.match(supabase.recovery.html, />Réinitialiser mon mot de passe<\/a>/);
  assert.match(supabase.recovery.html, /Vous n’avez rien demandé/);

  for (const template of Object.values(supabase)) {
    assert.doesNotMatch(template.html, /Confirm your|Reset your|Follow the link/);
    assert.match(template.html, /<html lang="fr">/);
  }
});

test('la validité annoncée suit la configuration, sans délai inventé', () => {
  assert.equal(describeLifetime(3600), 'une heure');
  assert.equal(describeLifetime(7200), '2 heures');
  assert.equal(describeLifetime(1800), '30 minutes');

  const short = renderSupabaseAuthTemplates({ siteUrl: SITE, linkLifetimeSeconds: 900 });
  assert.match(short.recovery.html, /valable 15 minutes/);
  assert.match(supabase.recovery.html, /valable une heure/);
});

test('seuls les deux modèles déclenchés par le site sont produits', () => {
  assert.deepEqual(Object.keys(supabase).sort(), ['confirmation', 'recovery']);
  assert.deepEqual(SUPABASE_TEMPLATE_FIELDS.confirmation, {
    subject: 'mailer_subjects_confirmation',
    content: 'mailer_templates_confirmation_content',
  });
  assert.deepEqual(SUPABASE_TEMPLATE_FIELDS.recovery, {
    subject: 'mailer_subjects_recovery',
    content: 'mailer_templates_recovery_content',
  });

  // Et le site déclenche bien ces deux-là, et eux seuls.
  const actions = readFileSync(resolve(PROJECT_ROOT, 'src', 'lib', 'auth', 'actions.ts'), 'utf8');
  assert.match(actions, /supabase\.auth\.signUp\(/);
  assert.match(actions, /supabase\.auth\.resetPasswordForEmail\(/);
  assert.doesNotMatch(actions, /inviteUserByEmail|signInWithOtp|reauthenticate\(/);
});

/* ======================================================== e-mails du site === */

test('l’accusé de réception reste en français, signé, et échappe la saisie', () => {
  const mail = renderConfirmationEmail(request);

  assert.equal(mail.subject, 'Nous avons bien reçu votre demande — MORA Shawiri');
  assert.match(mail.html, /Merci Fatima,/);
  assert.match(mail.html, /contact@morashawiri\.com/);
  assert.doesNotMatch(mail.html, /<img src=x/);
  assert.match(mail.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  // Les actions proposées existent : WhatsApp et la page Services.
  assert.match(mail.html, /href="https:\/\/wa\.me\//);
  assert.match(mail.html, /\/services\/"/);
  assert.match(mail.text, /Nous avons bien reçu votre demande\./);
  // Aucun délai chiffré n'est promis (06_CONTACT.md § 41).
  assert.doesNotMatch(mail.text, /\d+\s*h(eures?)?\b/);
});

test('la notification à l’équipe garde son objet de tri et ses réponses en un clic', () => {
  const mail = renderTeamEmail(request);

  assert.equal(mail.subject, '[Site] Devis — Site internet — Fatima Saïd');
  assert.match(mail.html, /href="mailto:fatima@exemple\.km"/);
  assert.match(mail.html, /href="https:\/\/wa\.me\/269333445\d"/);
  assert.doesNotMatch(mail.html, /Association <script>/);
});

test('l’invitation d’un administrateur passe par le gabarit commun', () => {
  const url = `${SITE}/invitation/?jeton=abc-DEF_123`;
  const mail = renderInvitationEmail({
    greeting: 'Amina',
    username: 'amina',
    url,
    invitedBy: 'rachade',
    ttlHours: 48,
  });

  assert.equal(INVITATION_SUBJECT, 'Votre accès à l’administration MORA Shawiri');
  assert.match(mail.html, />Activer mon compte<\/a>/);
  assert.match(mail.html, new RegExp(`href="${url.replace(/[?]/g, '\\?')}"`));
  assert.match(mail.html, /valable 48 heures/);
  assert.match(mail.text, /amina/);
  assert.match(mail.text, new RegExp(url.replace(/[?]/g, '\\?')));
  assert.match(mail.html, /ignorez-le : aucun compte ne sera créé/);
});

test('les envois passent tous par le gabarit commun, sans HTML recopié', () => {
  for (const file of ['src/app/api/contact/route.ts', 'src/lib/admin/invitations.ts']) {
    const source = readFileSync(resolve(PROJECT_ROOT, file), 'latin1');
    assert.doesNotMatch(source, /<table|<!doctype/i, `${file} contient du HTML d'e-mail`);
  }
});
