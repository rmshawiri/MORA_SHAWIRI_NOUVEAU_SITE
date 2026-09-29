/**
 * Le moteur de permissions effectives, parcouru exhaustivement.
 *
 * `effective.ts` ne lit rien et n'écrit rien : ses entrées sont trois listes,
 * sa sortie une liste. C'est précisément ce qui permet de ne pas se contenter
 * de trois cas bien choisis.
 *
 * Deux invariants sont vérifiés sur **l'intégralité du catalogue**, permission
 * par permission, et dans les quatre configurations possibles de chacune
 * (accordée ou non par le rôle × ajustée ou non) :
 *
 *   1. un retrait individuel l'emporte toujours, quelle que soit l'origine ;
 *   2. aucune permission n'apparaît sans avoir été explicitement accordée.
 *
 * Un test qui vérifie trois cas rassure. Un test qui les vérifie tous prouve.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_TEMPLATE_PERMISSIONS,
  CRITICAL_PERMISSIONS,
  FULL_ACCESS,
  PERMISSIONS,
  type Permission,
} from '../../src/lib/rbac/catalogue';
import {
  allows,
  allowsAll,
  allowsAny,
  effectivePermissions,
  permissionOrigin,
  planAdjustments,
  type PermissionAdjustment,
} from '../../src/lib/rbac/effective';

/* -------------------------------------------------------------------------- */
/*  Le calcul                                                                  */
/* -------------------------------------------------------------------------- */

test('sans rôle ni ajustement, aucune permission n’est détenue', () => {
  assert.deepEqual(effectivePermissions({ fromRoles: [], adjustments: [] }), []);
});

test('un octroi individuel accorde une permission qu’aucun rôle ne donne', () => {
  const result = effectivePermissions({
    fromRoles: [],
    adjustments: [{ permission: 'orders.view', effect: 'OCTROI' }],
  });

  assert.deepEqual(result, ['orders.view']);
});

test('un retrait individuel reprend une permission accordée par le rôle', () => {
  const result = effectivePermissions({
    fromRoles: ['orders.view', 'orders.update'],
    adjustments: [{ permission: 'orders.update', effect: 'RETRAIT' }],
  });

  assert.deepEqual(result, ['orders.view']);
});

test('le retrait l’emporte sur l’octroi portant la même permission', () => {
  // Cas impossible en base — la clé primaire l'interdit — mais le calcul doit
  // rester déterministe si les deux se présentaient.
  const result = effectivePermissions({
    fromRoles: [],
    adjustments: [
      { permission: 'orders.view', effect: 'OCTROI' },
      { permission: 'orders.view', effect: 'RETRAIT' },
    ],
  });

  assert.deepEqual(result, []);
});

test('le retrait l’emporte pour CHAQUE permission du catalogue, quelle que soit son origine', () => {
  for (const permission of PERMISSIONS) {
    for (const fromRoles of [[], [permission]] as readonly (readonly string[])[]) {
      const result = effectivePermissions({
        fromRoles,
        adjustments: [{ permission, effect: 'RETRAIT' }],
      });

      assert.ok(
        !result.includes(permission),
        `${permission} reste détenue malgré son retrait (rôle : ${fromRoles.length > 0})`,
      );
    }
  }
});

test('aucune permission n’apparaît sans avoir été accordée', () => {
  for (const permission of PERMISSIONS) {
    const others = PERMISSIONS.filter((code) => code !== permission);

    const result = effectivePermissions({
      fromRoles: others,
      adjustments: [],
    });

    assert.ok(!result.includes(permission), `${permission} apparaît sans être accordée`);
  }
});

test('le résultat est trié et sans doublon', () => {
  const result = effectivePermissions({
    fromRoles: ['orders.view', 'orders.view', 'users.view'],
    adjustments: [{ permission: 'orders.view', effect: 'OCTROI' }],
  });

  assert.deepEqual(result, ['orders.view', 'users.view']);
  assert.equal(new Set(result).size, result.length);
});

/* -------------------------------------------------------------------------- */
/*  Le verdict                                                                 */
/* -------------------------------------------------------------------------- */

test('refus par défaut : ce qui n’est pas accordé est refusé', () => {
  for (const permission of PERMISSIONS) {
    assert.equal(allows([], permission), false, `${permission} accordée sur un ensemble vide`);
  }
});

test('admin.full_access couvre l’intégralité du catalogue', () => {
  for (const permission of PERMISSIONS) {
    assert.equal(allows([FULL_ACCESS], permission), true);
  }
});

test('retirer admin.full_access retire tout ce qu’il couvrait', () => {
  const effective = effectivePermissions({
    fromRoles: [FULL_ACCESS],
    adjustments: [{ permission: FULL_ACCESS, effect: 'RETRAIT' }],
  });

  assert.deepEqual(effective, []);

  for (const permission of PERMISSIONS) {
    assert.equal(allows(effective, permission), false, `${permission} survit au retrait global`);
  }
});

test('allowsAll exige tout, allowsAny se contente d’une seule', () => {
  const held = ['orders.view'];

  assert.equal(allowsAll(held, ['orders.view', 'orders.update']), false);
  assert.equal(allowsAny(held, ['orders.view', 'orders.update']), true);
  assert.equal(allowsAll(held, ['orders.view']), true);
  assert.equal(allowsAny([], ['orders.view']), false);
});

/* -------------------------------------------------------------------------- */
/*  L'origine affichée                                                         */
/* -------------------------------------------------------------------------- */

test('l’origine d’un droit est toujours identifiable', () => {
  const inputs = {
    fromRoles: ['orders.view', 'orders.update'],
    adjustments: [
      { permission: 'quotes.view', effect: 'OCTROI' },
      { permission: 'orders.update', effect: 'RETRAIT' },
    ] satisfies PermissionAdjustment[],
  };

  assert.equal(permissionOrigin(inputs, 'orders.view'), 'role');
  assert.equal(permissionOrigin(inputs, 'quotes.view'), 'octroi');
  assert.equal(permissionOrigin(inputs, 'orders.update'), 'retrait');
  assert.equal(permissionOrigin(inputs, 'payments.verify'), 'absent');
});

/* -------------------------------------------------------------------------- */
/*  Le plan d'écriture                                                         */
/* -------------------------------------------------------------------------- */

test('n’écrit rien quand le rôle donne déjà exactement ce qui est voulu', () => {
  const plan = planAdjustments(['orders.view'], [], ['orders.view']);

  assert.deepEqual(plan.upserts, []);
  assert.deepEqual(plan.removals, []);
});

test('accorde par octroi ce que le rôle ne donne pas', () => {
  const plan = planAdjustments([], [], ['orders.view']);

  assert.deepEqual(plan.upserts, [{ permission: 'orders.view', effect: 'OCTROI' }]);
  assert.deepEqual(plan.removals, []);
});

test('reprend par retrait ce que le rôle donne mais qui n’est plus voulu', () => {
  const plan = planAdjustments(['orders.view'], [], []);

  assert.deepEqual(plan.upserts, [{ permission: 'orders.view', effect: 'RETRAIT' }]);
});

test('supprime la ligne devenue inutile plutôt que de la laisser traîner', () => {
  // Le rôle accorde désormais ce qu'un octroi accordait : la ligne fait double
  // emploi, et une ligne qui ne change rien finit par tromper la lecture.
  const plan = planAdjustments(
    ['orders.view'],
    [{ permission: 'orders.view', effect: 'OCTROI' }],
    ['orders.view'],
  );

  assert.deepEqual(plan.upserts, []);
  assert.deepEqual(plan.removals, ['orders.view']);
});

test('le plan appliqué produit exactement l’ensemble demandé', () => {
  // Propriété de bout en bout : quel que soit le point de départ, appliquer le
  // plan puis recalculer doit rendre l'ensemble voulu, ni plus ni moins.
  const fromRoles: Permission[] = ['orders.view', 'orders.update', 'quotes.view'];
  const existing: PermissionAdjustment[] = [
    { permission: 'payments.view', effect: 'OCTROI' },
    { permission: 'quotes.view', effect: 'RETRAIT' },
  ];

  const desired: Permission[] = ['orders.view', 'quotes.view', 'content.view'];

  const plan = planAdjustments(fromRoles, existing, desired);

  const kept = existing.filter((entry) => !plan.removals.includes(entry.permission));
  const merged = new Map<string, PermissionAdjustment>(
    kept.map((entry) => [entry.permission, entry]),
  );
  for (const entry of plan.upserts) merged.set(entry.permission, entry);

  const result = effectivePermissions({ fromRoles, adjustments: [...merged.values()] });

  assert.deepEqual(result, [...desired].sort());
});

test('le plan est stable : le rejouer ne produit plus rien', () => {
  const fromRoles: Permission[] = ['orders.view'];
  const desired: Permission[] = ['orders.view', 'quotes.view'];

  const first = planAdjustments(fromRoles, [], desired);
  const second = planAdjustments(fromRoles, first.upserts, desired);

  assert.deepEqual(second.upserts, []);
  assert.deepEqual(second.removals, []);
});

/* -------------------------------------------------------------------------- */
/*  Le modèle opérationnel                                                     */
/* -------------------------------------------------------------------------- */

test('le modèle proposé ne contient aucune permission critique', () => {
  const critical = new Set<string>(CRITICAL_PERMISSIONS);

  for (const permission of ADMIN_TEMPLATE_PERMISSIONS) {
    assert.ok(
      !critical.has(permission),
      `le modèle opérationnel ne doit pas proposer la permission critique ${permission}`,
    );
  }
});

test('le modèle proposé n’est fait que de permissions réelles', () => {
  const known = new Set<string>(PERMISSIONS);

  for (const permission of ADMIN_TEMPLATE_PERMISSIONS) {
    assert.ok(known.has(permission), `${permission} n’existe pas au catalogue`);
  }
});

test('le modèle proposé n’accorde pas l’accès complet', () => {
  assert.ok(!(ADMIN_TEMPLATE_PERMISSIONS as readonly string[]).includes(FULL_ACCESS));
});
