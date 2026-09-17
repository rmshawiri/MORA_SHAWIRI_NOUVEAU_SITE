/**
 * Neutralité des messages d'authentification.
 *
 * La protection contre l'énumération des comptes ne tient pas à un mécanisme
 * mais à une discipline de rédaction : le même message, quel que soit l'état
 * réel du compte. Ce test la rend exécutoire — une reformulation qui
 * introduirait « cette adresse n'existe pas » ou « ce compte est déjà inscrit »
 * ferait échouer la suite avant tout déploiement.
 *
 * Référence : `04_AUTHENTIFICATION.md` § 22, § 31-32, § 101, § 171-173.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { AUTH_MESSAGES, authError, authOk, AUTH_IDLE } from '../../src/lib/auth/messages';

/**
 * Formules qui révéleraient l'existence — ou l'absence — d'un compte.
 * La liste est écrite en minuscules et comparée sans accents parasites.
 */
const REVEALING = [
  'aucun compte',
  "n'existe pas",
  'n’existe pas',
  'existe déjà',
  'déjà utilisée',
  'déjà inscrit',
  'compte introuvable',
  'adresse inconnue',
  'utilisateur inconnu',
  'mot de passe incorrect',
  'mot de passe erroné',
];

/** Messages présentés au public, avant toute authentification. */
const PUBLIC_MESSAGES = [
  AUTH_MESSAGES.invalidCredentials,
  AUTH_MESSAGES.resetRequested,
  AUTH_MESSAGES.registrationSubmitted,
  AUTH_MESSAGES.rateLimited,
  AUTH_MESSAGES.missingFields,
  AUTH_MESSAGES.unexpected,
  AUTH_MESSAGES.linkUnusable,
];

test('aucun message public ne révèle l’existence d’un compte', () => {
  for (const message of PUBLIC_MESSAGES) {
    const lowered = message.toLowerCase();

    for (const phrase of REVEALING) {
      assert.ok(
        !lowered.includes(phrase),
        `le message « ${message} » contient la formule révélatrice « ${phrase} »`,
      );
    }
  }
});

test('l’échec de connexion ne distingue pas le compte du mot de passe', () => {
  // Le § 32 propose exactement cette formulation. Elle ne nomme ni l'un ni
  // l'autre des deux champs.
  const lowered = AUTH_MESSAGES.invalidCredentials.toLowerCase();

  assert.ok(lowered.includes('identifiants'));
  assert.ok(!lowered.includes('mot de passe'));
  assert.ok(!lowered.includes('adresse'));
});

test('la réponse à une demande de réinitialisation reste conditionnelle', () => {
  // « Si un compte correspond… » : la phrase ne confirme aucun envoi.
  assert.ok(/^si /i.test(AUTH_MESSAGES.resetRequested));
});

test('la réponse à une inscription ne confirme pas la création du compte', () => {
  const lowered = AUTH_MESSAGES.registrationSubmitted.toLowerCase();

  assert.ok(lowered.includes('si cette adresse'));
  assert.ok(!lowered.includes('votre compte a été créé'));
});

test('aucun message ne contient de secret, de jeton ni de gabarit d’interpolation', () => {
  for (const message of Object.values(AUTH_MESSAGES)) {
    assert.ok(!/\$\{|\{\{|<%/.test(message), `gabarit non résolu dans « ${message} »`);
    assert.ok(!/sb_secret_|sbp_|eyJ[A-Za-z0-9_-]{10,}\./.test(message));
  }
});

test('tous les messages sont des phrases complètes', () => {
  // Un libellé tronqué ou réduit à un mot-clé technique est un défaut visible
  // par le visiteur. Certains messages se terminent par un exemple
  // (« Exemple : nom@domaine.com ») : la ponctuation est cherchée dans la
  // phrase, pas imposée au dernier caractère.
  for (const [key, message] of Object.entries(AUTH_MESSAGES)) {
    const trimmed = message.trim();

    assert.ok(trimmed.length > 0, `message vide : ${key}`);
    assert.ok(trimmed.length > 20, `message trop court pour être compréhensible : ${key}`);
    assert.ok(/[.!?]/.test(trimmed), `message sans ponctuation de phrase : ${key}`);
    assert.ok(/^[A-ZÀ-Ý«]/.test(trimmed), `message ne commençant pas par une majuscule : ${key}`);
  }
});

/* ------------------------------------------------------------- fabriques --- */

test('les fabriques d’état produisent des états cohérents', () => {
  assert.deepEqual(AUTH_IDLE, { status: 'idle', message: '' });

  assert.deepEqual(authOk('Fait.'), { status: 'ok', message: 'Fait.' });

  assert.deepEqual(authError('Refusé.'), { status: 'error', message: 'Refusé.' });

  assert.deepEqual(authError('Refusé.', ['Trop court.']), {
    status: 'error',
    message: 'Refusé.',
    reasons: ['Trop court.'],
  });

  // Une liste vide ne doit pas produire un bloc de motifs vide à l'écran.
  assert.deepEqual(authError('Refusé.', []), { status: 'error', message: 'Refusé.' });
});
