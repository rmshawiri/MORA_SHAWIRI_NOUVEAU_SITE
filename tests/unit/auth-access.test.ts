/**
 * Règles d'accès aux espaces privés.
 *
 * Ce sont les règles les plus importantes de la phase : elles décident si un
 * compte entre ou non dans l'administration. Elles sont écrites sous forme de
 * fonctions pures précisément pour pouvoir être éprouvées exhaustivement, sans
 * base de données ni session.
 *
 * Le test parcourt les 32 combinaisons possibles des cinq faits qui entrent
 * dans la décision, et vérifie l'invariant qui compte : **aucune combinaison ne
 * donne accès à l'administration sans session AAL2 lorsque le second facteur
 * est obligatoire.**
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adminAccessObstacle,
  canRemoveFactor,
  factorManagementObstacle,
  mfaIsRequiredFor,
  privateAccessObstacle,
  type AccessSnapshot,
} from '../../src/lib/auth/access';

function snapshot(overrides: Partial<AccessSnapshot> = {}): AccessSnapshot {
  return {
    isAdmin: false,
    mustChangePassword: false,
    adminMfaRequired: true,
    assuranceLevel: 'aal1',
    totpFactorCount: 0,
    ...overrides,
  };
}

/** Les 32 combinaisons des cinq faits qui entrent dans la décision. */
function allSnapshots(): AccessSnapshot[] {
  const combinations: AccessSnapshot[] = [];

  for (const isAdmin of [false, true]) {
    for (const mustChangePassword of [false, true]) {
      for (const adminMfaRequired of [false, true]) {
        for (const assuranceLevel of ['aal1', 'aal2'] as const) {
          for (const totpFactorCount of [0, 1]) {
            combinations.push({
              isAdmin,
              mustChangePassword,
              adminMfaRequired,
              assuranceLevel,
              totpFactorCount,
            });
          }
        }
      }
    }
  }

  return combinations;
}

/* -------------------------------------------------------------- session --- */

test('sans session, aucun espace privé n’est accessible', () => {
  assert.equal(adminAccessObstacle(null), 'aucune-session');
  assert.equal(privateAccessObstacle(null), 'aucune-session');
  assert.equal(factorManagementObstacle(null), 'aucune-session');
});

/* ----------------------------------------------------------------- rôle --- */

test('un compte sans rôle d’administration n’entre pas dans l’administration', () => {
  assert.equal(
    adminAccessObstacle(snapshot({ isAdmin: false, assuranceLevel: 'aal2', totpFactorCount: 1 })),
    'role-insuffisant',
  );
});

test('un client authentifié accède à son espace sans second facteur', () => {
  assert.equal(privateAccessObstacle(snapshot()), null);
});

/* ------------------------------------------------- mot de passe d’amorçage --- */

test('le changement de mot de passe obligatoire passe avant tout le reste', () => {
  const context = snapshot({
    isAdmin: true,
    mustChangePassword: true,
    assuranceLevel: 'aal2',
    totpFactorCount: 1,
  });

  assert.equal(adminAccessObstacle(context), 'mot-de-passe-a-changer');
  assert.equal(privateAccessObstacle(context), 'mot-de-passe-a-changer');
  assert.equal(factorManagementObstacle(context), 'mot-de-passe-a-changer');
});

/* -------------------------------------------------------- double facteur --- */

test('un administrateur sans facteur est conduit à l’enrôlement', () => {
  assert.equal(
    adminAccessObstacle(snapshot({ isAdmin: true, totpFactorCount: 0 })),
    'second-facteur-a-enroler',
  );
});

test('un administrateur enrôlé mais en AAL1 doit présenter son code', () => {
  assert.equal(
    adminAccessObstacle(snapshot({ isAdmin: true, totpFactorCount: 1, assuranceLevel: 'aal1' })),
    'second-facteur-a-verifier',
  );
});

test('un administrateur enrôlé et vérifié entre', () => {
  assert.equal(
    adminAccessObstacle(snapshot({ isAdmin: true, totpFactorCount: 1, assuranceLevel: 'aal2' })),
    null,
  );
});

test('D-12 désactivée : un administrateur entre sans second facteur', () => {
  assert.equal(
    adminAccessObstacle(snapshot({ isAdmin: true, adminMfaRequired: false })),
    null,
  );
});

/* --------------------------------------------------------- l’invariant --- */

test('aucune combinaison n’ouvre l’administration en AAL1 quand le MFA est exigé', () => {
  for (const context of allSnapshots()) {
    if (!context.isAdmin || !context.adminMfaRequired) continue;
    if (context.assuranceLevel === 'aal2') continue;

    assert.notEqual(
      adminAccessObstacle(context),
      null,
      `combinaison acceptée à tort : ${JSON.stringify(context)}`,
    );
  }
});

test('aucune combinaison n’ouvre l’administration à un non-administrateur', () => {
  for (const context of allSnapshots()) {
    if (context.isAdmin) continue;

    assert.equal(
      adminAccessObstacle(context),
      'role-insuffisant',
      `combinaison acceptée à tort : ${JSON.stringify(context)}`,
    );
  }
});

test('aucune combinaison n’ouvre un espace privé à un compte devant changer son mot de passe', () => {
  for (const context of allSnapshots()) {
    if (!context.mustChangePassword) continue;

    assert.equal(privateAccessObstacle(context), 'mot-de-passe-a-changer');
    assert.notEqual(adminAccessObstacle(context), null);
  }
});

/* -------------------------------------------------- gestion des facteurs --- */

test('le premier facteur s’enrôle en AAL1, les suivants exigent AAL2', () => {
  // Aucun facteur : l'écran doit être atteignable, sinon l'enrôlement initial
  // serait impossible.
  assert.equal(
    factorManagementObstacle(snapshot({ isAdmin: true, totpFactorCount: 0 })),
    null,
  );

  // Un facteur existe : modifier la protection exige de l'avoir présentée.
  assert.equal(
    factorManagementObstacle(snapshot({ isAdmin: true, totpFactorCount: 1 })),
    'second-facteur-a-verifier',
  );

  assert.equal(
    factorManagementObstacle(
      snapshot({ isAdmin: true, totpFactorCount: 1, assuranceLevel: 'aal2' }),
    ),
    null,
  );
});

test('le dernier facteur d’un administrateur soumis au MFA ne peut pas être retiré', () => {
  assert.equal(
    canRemoveFactor(snapshot({ isAdmin: true, adminMfaRequired: true, totpFactorCount: 1 })),
    false,
  );

  assert.equal(
    canRemoveFactor(snapshot({ isAdmin: true, adminMfaRequired: true, totpFactorCount: 2 })),
    true,
  );

  // Un client n'est soumis à aucune obligation : il dispose de ses facteurs.
  assert.equal(canRemoveFactor(snapshot({ isAdmin: false, totpFactorCount: 1 })), true);
});

test('mfaIsRequiredFor ne vise que les administrateurs, et seulement si D-12 est active', () => {
  assert.equal(mfaIsRequiredFor(snapshot({ isAdmin: true, adminMfaRequired: true })), true);
  assert.equal(mfaIsRequiredFor(snapshot({ isAdmin: true, adminMfaRequired: false })), false);
  assert.equal(mfaIsRequiredFor(snapshot({ isAdmin: false, adminMfaRequired: true })), false);
});
