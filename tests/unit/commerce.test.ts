/**
 * Invariants du commerce — phase 4G.
 *
 * ## Ce que ces tests attrapent, et ce qu'ils n'attrapent pas
 *
 * Ils lisent le SQL, ils ne l'exécutent pas. `scripts/verify-commerce.mjs`
 * éprouve les mêmes règles contre la vraie base, avec de vraies sessions —
 * la phase 4E-1 avait montré qu'un garde peut se lire correctement et ne rien
 * refuser.
 *
 * Ce que la lecture du SQL fait mieux : constater une **absence**. Qu'aucune
 * politique n'ouvre ces tables au rôle anonyme, qu'aucun privilège ne laisse
 * une session écrire un montant encaissé, qu'aucune fonction publique
 * n'accepte un statut en paramètre, qu'aucun secret n'a été semé dans la
 * migration. Une absence ne se teste pas en base : on ne peut qu'essayer ce à
 * quoi on pense.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canTransitionOrder,
  canTransitionPayment,
  formatAmount,
  formatQuantity,
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_TRANSITIONS,
  PROOF_MAX_BYTES,
  PROOF_MIME_TYPES,
  remainingDue,
  SETTLEMENT_STATUS_LABELS,
} from '../../src/lib/commerce/labels';
import { buildProofPath, sniffProof } from '../../src/lib/commerce/proof-format';
import { PERMISSIONS } from '../../src/lib/rbac/catalogue';
import { ADMIN_MODULES } from '../../src/lib/rbac/modules';

const MIGRATIONS = resolve(process.cwd(), 'supabase', 'migrations');

const SQL = readFileSync(
  resolve(MIGRATIONS, '20260930160000_commerce_commandes_paiements.sql'),
  'utf8',
);

/** Les huit tables de la phase. */
const TABLES = [
  'payment_methods',
  'orders',
  'order_items',
  'payments',
  'payment_proofs',
  'refunds',
  'order_status_history',
  'order_events',
] as const;

function sqlTransitions(functionName: string): Record<string, string[]> {
  const start = SQL.indexOf(`create or replace function public.${functionName}()`);
  assert.notEqual(start, -1, `fonction ${functionName} introuvable`);

  const body = SQL.slice(start, SQL.indexOf('$fn$;', start));
  const caseStart = body.indexOf('case old.status');
  assert.notEqual(caseStart, -1, `aucun case old.status dans ${functionName}`);

  const graph: Record<string, string[]> = {};

  for (const match of body
    .slice(caseStart, body.indexOf('end;', caseStart))
    .matchAll(/when '([A-Z_]+)'\s*then array\[([^\]]*)\]/g)) {
    graph[match[1]!] = [...match[2]!.matchAll(/'([A-Z_]+)'/g)].map((entry) => entry[1]!);
  }

  return graph;
}

/**
 * Le SQL débarrassé de ses commentaires.
 *
 * Plusieurs contrôles cherchent l'absence d'un mot. Les mener sur le fichier
 * entier les ferait échouer sur les commentaires qui expliquent précisément
 * pourquoi la chose est absente — le bucket public de 4E-2, par exemple, y est
 * nommé pour dire qu'on ne s'en sert pas.
 */
const CODE = SQL.replace(/--[^\n]*/g, '');

/** Corps d'une contrainte `check` nommée, tel qu'il est écrit dans le SQL. */
function checkConstraint(name: string): string {
  const start = SQL.indexOf(`constraint ${name}`);
  assert.notEqual(start, -1, `contrainte ${name} introuvable`);
  return SQL.slice(start, SQL.indexOf('\n  ),', start) + 4);
}

/* ------------------------------------------------ le graphe des statuts --- */

test('le graphe des commandes en TypeScript est celui du déclencheur', () => {
  const sql = sqlTransitions('tg_orders_transition_guard');

  for (const [status, allowed] of Object.entries(sql)) {
    assert.deepEqual(
      [...(ORDER_TRANSITIONS[status as keyof typeof ORDER_TRANSITIONS] ?? [])],
      allowed,
      `transitions divergentes pour ${status}`,
    );
  }

  // Tout statut absent du `case` est final : le `else` rend un tableau vide.
  for (const [status, allowed] of Object.entries(ORDER_TRANSITIONS)) {
    if (!(status in sql)) {
      assert.deepEqual([...allowed], [], `${status} devrait être un état final`);
    }
  }
});

test('le graphe des paiements en TypeScript est celui du déclencheur', () => {
  const sql = sqlTransitions('tg_payments_transition_guard');

  for (const [status, allowed] of Object.entries(sql)) {
    assert.deepEqual(
      [...(PAYMENT_TRANSITIONS[status as keyof typeof PAYMENT_TRANSITIONS] ?? [])],
      allowed,
      `transitions divergentes pour ${status}`,
    );
  }

  for (const [status, allowed] of Object.entries(PAYMENT_TRANSITIONS)) {
    if (!(status in sql)) {
      assert.deepEqual([...allowed], [], `${status} devrait être un état final`);
    }
  }
});

test('une commande terminée ou annulée n’évolue plus', () => {
  for (const target of Object.keys(ORDER_STATUS_LABELS) as (keyof typeof ORDER_STATUS_LABELS)[]) {
    assert.equal(canTransitionOrder('TERMINEE', target), false);
    assert.equal(canTransitionOrder('ANNULEE', target), false);
  }
});

test('aucun chemin ne mène directement d’une déclaration à un remboursement', () => {
  assert.equal(canTransitionPayment('EN_VERIFICATION', 'REMBOURSE'), false);
  assert.equal(canTransitionPayment('EN_ATTENTE', 'PAYE'), false);
  // Un paiement ne devient remboursé qu'après avoir été payé.
  assert.equal(canTransitionPayment('PAYE', 'REMBOURSE'), true);
});

test('un paiement rejeté est final : le client en refait un autre', () => {
  for (const target of Object.keys(
    PAYMENT_STATUS_LABELS,
  ) as (keyof typeof PAYMENT_STATUS_LABELS)[]) {
    assert.equal(canTransitionPayment('ECHEC', target), false);
    assert.equal(canTransitionPayment('ANNULE', target), false);
  }
});

/* ------------------------------------- les statuts retenus, et eux seuls --- */

test('les statuts de commande sont ceux de 09_ADMINISTRATION/02 § 22', () => {
  const constraint = checkConstraint('orders_status_valid');
  const sql = [...constraint.matchAll(/'([A-Z_]+)'/g)].map((entry) => entry[1]!);

  assert.deepEqual(sql.sort(), Object.keys(ORDER_STATUS_LABELS).sort());

  // Aucun état de paiement dans le statut de commande — § 151.
  for (const forbidden of ['PAYEE', 'PAYE', 'REMBOURSEE', 'PAIEMENT_EN_ATTENTE']) {
    assert.ok(!sql.includes(forbidden), `${forbidden} n’a rien à faire dans un statut de commande`);
  }
});

test('les statuts de paiement sont ceux de 06_PAIEMENTS § 22', () => {
  const constraint = checkConstraint('payments_status_valid');
  const sql = [...constraint.matchAll(/'([A-Z_]+)'/g)].map((entry) => entry[1]!);

  assert.deepEqual(sql.sort(), Object.keys(PAYMENT_STATUS_LABELS).sort());
  // EN_VERIFICATION est celui sans lequel D-10 n'aurait pas de traduction.
  assert.ok(sql.includes('EN_VERIFICATION'));
});

test('chaque statut a un libellé français', () => {
  for (const labels of [ORDER_STATUS_LABELS, SETTLEMENT_STATUS_LABELS, PAYMENT_STATUS_LABELS]) {
    for (const [code, label] of Object.entries(labels)) {
      assert.ok(label.trim().length > 0, `${code} sans libellé`);
      assert.notEqual(label, code, `${code} affiche son code brut`);
    }
  }
});

/* ------------------------------------------------------------ D-10 tenue --- */

test('un paiement confirmé porte forcément la trace de sa vérification', () => {
  const constraint = checkConstraint('payments_confirmed_traceable');
  assert.match(constraint, /status <> 'PAYE'/);
  assert.match(constraint, /confirmed_at is not null/);
  assert.match(constraint, /verified_at is not null/);
});

test('seule payments.verify permet d’atteindre PAYE', () => {
  const start = SQL.indexOf('create or replace function public.tg_payments_transition_guard()');
  const body = SQL.slice(start, SQL.indexOf('$fn$;', start));

  // La branche qui autorise PAYE et ECHEC exige la permission critique.
  const branch = body.slice(
    body.indexOf("if new.status in ('PAYE', 'ECHEC')"),
    body.indexOf('elsif'),
  );
  assert.match(branch, /has_permission\('payments\.verify'\)/);
});

test('verify_payment est idempotente : confirmée deux fois, elle ne confirme qu’une', () => {
  const start = SQL.indexOf('create or replace function public.verify_payment(');
  const body = SQL.slice(start, SQL.indexOf('$fn$;', start));

  assert.match(body, /if v_payment\.status = 'PAYE' then\s*\n\s*return v_payment;/);
});

test('declare_payment ne peut pas produire un paiement confirmé', () => {
  const start = SQL.indexOf('create or replace function public.declare_payment(');
  const body = SQL.slice(start, SQL.indexOf('$fn$;', start));

  // Le seul statut écrit par cette fonction.
  const inserted = body.slice(body.indexOf('insert into public.payments'));
  assert.match(inserted, /'EN_VERIFICATION'/);
  assert.ok(!/'PAYE'/.test(inserted), 'declare_payment ne doit jamais écrire PAYE');
});

test('le règlement d’une commande ne s’écrit pas', () => {
  const start = SQL.indexOf('create or replace function public.tg_orders_derived_readonly()');
  const body = SQL.slice(start, SQL.indexOf('$fn$;', start));

  for (const column of ['paid_amount', 'refunded_amount', 'settlement_status']) {
    assert.match(body, new RegExp(`new\\.${column} is distinct from old\\.${column}`));
  }
});

test('seuls les paiements confirmés alimentent le montant encaissé', () => {
  const start = SQL.indexOf('create or replace function public.recompute_order_settlement(');
  const body = SQL.slice(start, SQL.indexOf('$fn$;', start));

  const sum = body.slice(body.indexOf('coalesce(sum(p.amount)'), body.indexOf('select coalesce(sum(r.amount)'));
  assert.match(sum, /in \('PAYE', 'REMBOURSE', 'PARTIELLEMENT_REMBOURSE'\)/);
  assert.ok(!/EN_VERIFICATION/.test(sum), 'une déclaration non vérifiée ne compte pas');
});

/* ------------------------------------------------------ l’idempotence --- */

test('un devis ne peut donner qu’une commande', () => {
  assert.match(SQL, /quote_id\s+uuid unique references public\.quotes/);
});

test('place_order_from_quote regarde avant d’allouer un numéro', () => {
  const start = SQL.indexOf('create or replace function public.place_order_from_quote(');
  const body = SQL.slice(start, SQL.indexOf('$fn$;', start));

  const lookup = body.indexOf('select * into v_existing from public.orders where quote_id');
  const issue = body.indexOf('public.issue_document(');

  assert.notEqual(lookup, -1);
  assert.notEqual(issue, -1);
  assert.ok(lookup < issue, 'la recherche doit précéder l’allocation, sinon un numéro est perdu');
});

test('issue_order_invoice regarde avant d’allouer un numéro', () => {
  const start = SQL.indexOf('create or replace function public.issue_order_invoice(');
  const body = SQL.slice(start, SQL.indexOf('$fn$;', start));

  const lookup = body.indexOf("where doc_type = 'FACL'");
  const issue = body.indexOf('public.issue_document(');

  assert.notEqual(lookup, -1);
  assert.ok(lookup < issue, 'une facture déjà émise doit être renvoyée sans consommer de FACL');
});

test('la même référence de transaction ne produit pas deux paiements', () => {
  assert.match(SQL, /create unique index if not exists payments_transaction_unique/);
  assert.match(SQL, /on public\.payments \(method_code, transaction_key\)/);
});

test('le même justificatif ne s’attache pas deux fois', () => {
  assert.match(SQL, /constraint payment_proofs_unique_per_payment unique \(payment_id, checksum\)/);
});

/* ---------------------------------------------- le moteur documentaire --- */

test('aucun second allocateur de numéros n’est créé', () => {
  assert.ok(!/create or replace function public\.allocate/.test(SQL));
  assert.ok(!/max\(\s*number/i.test(SQL), 'aucun MAX(numero) + 1');
  assert.ok(!/create table if not exists public\.document_sequences/.test(SQL));
});

test('la migration ne redéfinit pas issue_document', () => {
  // La garde `is_reference_only` posée en 4F doit rester intacte : DMCL et
  // RVCL numérotent des entités métier et n'émettent aucune pièce.
  assert.ok(
    !/create or replace function public\.issue_document/.test(SQL),
    '4G ne doit pas retoucher issue_document — 4F y avait déjà perdu trois comportements',
  );
});

test('les commandes et factures passent par issue_document', () => {
  assert.match(SQL, /public\.issue_document\(\s*\n?\s*'CMCL'/);
  assert.match(SQL, /public\.issue_document\(\s*\n?\s*'FACL'/);
});

test('la référence de commande respecte la nomenclature D-2', () => {
  assert.match(SQL, /reference ~ '\^MORA-CMCL-\[A-Z\]\+\[0-9\]\{4\}\$'/);
  // Pas d'année, pas de suffixe.
  assert.ok(!/MORA-CMCL-\[0-9\]\{4\}-/.test(SQL));
});

/* ------------------------------------------------------- les permissions --- */

test('aucune permission nouvelle n’est créée', () => {
  assert.ok(
    !/insert into public\.permissions/.test(SQL),
    '4A avait déjà semé les sept permissions de commerce',
  );

  for (const permission of [
    'orders.view',
    'orders.update',
    'orders.cancel',
    'orders.refund',
    'payments.view',
    'payments.verify',
    'payments.refund',
  ]) {
    assert.ok(
      (PERMISSIONS as readonly string[]).includes(permission),
      `${permission} devrait exister depuis 4A`,
    );
  }
});

test('les deux modules commerce sont ouverts sous leur permission', () => {
  for (const slug of ['commandes', 'paiements'] as const) {
    const entry = ADMIN_MODULES.find((module) => module.slug === slug);
    assert.ok(entry, `module ${slug} absent du registre`);
    assert.equal(entry.status, 'DISPONIBLE');
    assert.equal(entry.phase, '4G');
  }

  assert.equal(ADMIN_MODULES.find((m) => m.slug === 'commandes')?.permission, 'orders.view');
  assert.equal(ADMIN_MODULES.find((m) => m.slug === 'paiements')?.permission, 'payments.view');
});

test('annuler et traiter ne réclament pas la même permission', () => {
  const start = SQL.indexOf('create or replace function public.tg_orders_transition_guard()');
  const body = SQL.slice(start, SQL.indexOf('$fn$;', start));

  assert.match(body, /has_permission\('orders\.cancel'\)/);
  assert.match(body, /has_permission\('orders\.update'\)/);
});

/* ------------------------------------------------------------ la RLS --- */

test('chaque table porte la RLS', () => {
  for (const table of TABLES) {
    assert.match(
      SQL,
      new RegExp(`alter table public\\.${table}\\s+enable row level security`),
      `RLS absente sur ${table}`,
    );
  }
});

test('aucune politique n’ouvre le commerce au rôle anonyme', () => {
  for (const match of SQL.matchAll(/create policy\s+(\w+)[\s\S]*?\n\s+(using|with check)/g)) {
    const block = match[0];
    if (!/bucket_id/.test(block)) {
      assert.ok(
        !/\bto\s+[^\n;]*\banon\b/.test(block),
        `la politique ${match[1]} atteint anon`,
      );
    }
  }
});

test('aucun privilège d’écriture n’est accordé sur l’historique', () => {
  for (const table of ['order_status_history', 'order_events']) {
    for (const verb of ['insert', 'update', 'delete']) {
      assert.ok(
        !new RegExp(`grant ${verb}[^;]*public\\.${table}`).test(SQL),
        `${verb} accordé sur ${table}`,
      );
    }
  }
});

test('aucune session ne peut insérer une commande ou un paiement directement', () => {
  assert.ok(!/grant insert[^;]*public\.orders/.test(SQL));
  assert.ok(!/grant insert[^;]*public\.payments\b/.test(SQL));
  assert.ok(!/grant insert[^;]*public\.refunds/.test(SQL));
  assert.ok(!/grant insert[^;]*public\.payment_proofs/.test(SQL));
});

test('rien ne se supprime : ni commande, ni paiement, ni justificatif', () => {
  for (const table of ['orders', 'payments', 'payment_proofs', 'refunds']) {
    assert.ok(
      !new RegExp(`grant delete[^;]*public\\.${table}`).test(SQL),
      `delete accordé sur ${table}`,
    );
    assert.ok(
      !new RegExp(`create policy \\w+\\s+on public\\.${table} for delete`).test(SQL),
      `politique delete sur ${table}`,
    );
  }
});

test('recompute_order_settlement reste hors de portée des sessions', () => {
  assert.match(
    SQL,
    /revoke execute on function public\.recompute_order_settlement\(uuid\) from public, anon, authenticated/,
  );
});

/* ------------------------------------------------- les moyens de paiement --- */

test('les moyens validés par le propriétaire sont là, dans l’état annoncé', () => {
  const seed = SQL.slice(
    SQL.indexOf('insert into public.payment_methods'),
    SQL.indexOf('on conflict (code) do nothing'),
  );

  // Actifs : les moyens réellement utilisables aujourd'hui.
  assert.match(seed, /'MVOLA', 'Paiement via Mvola', 'MOBILE_MONEY', true, true/);
  assert.match(seed, /'HOLO', 'Paiement via Holo', 'MOBILE_MONEY', true, true/);
  // Espèces et chèque : pas de justificatif exigé (point 10 du cadrage).
  assert.match(seed, /'CHEQUE', 'Paiement par chèque', 'CHEQUE', true, false/);
  assert.match(seed, /'ESPECES', [^,]+, 'CASH', true, false/);

  // Inactifs : Wakati n'a pas lancé, le virement n'a pas de coordonnées,
  // PayPal attend une décision d'intégration.
  assert.match(seed, /'WAKATI', 'Paiement via Wakati', 'MOBILE_MONEY', false/);
  assert.match(seed, /'VIREMENT', 'Virement bancaire', 'BANK_TRANSFER', false/);
  assert.match(seed, /'PAYPAL', 'Paiement via PayPal', 'ONLINE', false/);
});

test('aucune coordonnée bancaire n’est inventée', () => {
  const seed = SQL.slice(
    SQL.indexOf("('VIREMENT'"),
    SQL.indexOf("('CHEQUE'"),
  );
  assert.match(seed, /null, null, ''/, 'le virement doit rester sans coordonnées ni instructions');
});

test('un moyen inactif ne peut pas être utilisé', () => {
  const start = SQL.indexOf('create or replace function public.declare_payment(');
  const body = SQL.slice(start, SQL.indexOf('$fn$;', start));

  assert.match(body, /if not v_method\.is_active then/);
});

test('aucun secret ne peut être stocké dans un moyen de paiement', () => {
  const constraint = checkConstraint('payment_methods_no_secret');
  for (const key of ['api_key', 'client_secret', 'private_key', 'webhook_secret']) {
    assert.ok(constraint.includes(key), `${key} devrait être refusé`);
  }
});

test('la migration ne contient aucun secret', () => {
  // Les seules valeurs sensibles admises sont les coordonnées publiques que le
  // propriétaire a fournies pour que ses clients puissent payer.
  assert.ok(!/sk_live|sk_test|eyJ[A-Za-z0-9_-]{20,}|service_role_key/.test(SQL));
  assert.ok(!/BEGIN (RSA |EC )?PRIVATE KEY/.test(SQL));
});

test('aucune passerelle n’est simulée', () => {
  // Aucune adresse externe : le § 193 interdit d'inventer une passerelle, et
  // une URL en dur serait le premier signe qu'on en a inventé une.
  assert.ok(!/https?:\/\//.test(CODE), 'aucune URL externe dans la migration');

  // Le point est échappé : sans quoi « wakati. » attraperait le libellé du
  // moyen de paiement, qui a parfaitement sa place ici.
  for (const forbidden of ['paypal\\.com', 'wakati\\.', 'stripe', 'signature']) {
    assert.ok(
      !new RegExp(forbidden, 'i').test(CODE),
      `${forbidden} apparaît dans le code de la migration`,
    );
  }

  // « webhook » ne figure que dans la liste des clés de métadonnées refusées.
  // Nulle part ailleurs : il n'existe aucun traitement d'événement externe.
  assert.equal(
    [...CODE.matchAll(/webhook/gi)].length,
    1,
    'webhook ne doit apparaître que comme clé interdite',
  );
  assert.ok(CODE.includes("'webhook_secret'"));
});

/* ------------------------------------------------------- les montants --- */

test('aucun montant n’est un flottant', () => {
  assert.ok(!/\b(float|real|double precision)\b/i.test(SQL));

  for (const column of [
    'subtotal_amount',
    'discount_amount',
    'fees_amount',
    'total_amount',
    'paid_amount',
    'refunded_amount',
  ]) {
    assert.match(
      SQL,
      new RegExp(`${column}\\s+numeric\\(12, 2\\)`),
      `${column} devrait être numeric(12, 2)`,
    );
  }
});

test('le total d’une commande est la somme de ses parties, par contrainte', () => {
  const constraint = checkConstraint('orders_total_coherent');
  assert.match(
    constraint,
    /total_amount = subtotal_amount - discount_amount \+ fees_amount/,
  );
});

test('une quantité ou un prix négatif est refusé par la base', () => {
  assert.match(SQL, /constraint order_items_quantity_positive check \(quantity > 0\)/);
  assert.match(SQL, /constraint order_items_unit_price_positive check \(unit_price >= 0\)/);
  assert.match(SQL, /constraint payments_amount_positive check \(amount > 0\)/);
});

test('une remise ne peut pas dépasser ce qu’elle réduit', () => {
  assert.match(SQL, /constraint orders_discount_bounded check \(discount_amount <= subtotal_amount\)/);
  assert.match(SQL, /constraint order_items_discount_bounded/);
});

test('on ne rembourse pas plus qu’on n’a encaissé', () => {
  assert.match(SQL, /constraint orders_refund_bounded check \(refunded_amount <= paid_amount\)/);
});

test('le montant d’une ligne est recalculé, jamais lu', () => {
  const start = SQL.indexOf('create or replace function public.tg_order_items_amount()');
  const body = SQL.slice(start, SQL.indexOf('$fn$;', start));

  assert.match(body, /new\.line_total := round\(new\.unit_price \* new\.quantity, 2\) - new\.discount_amount/);
});

/* -------------------------------------------------------- justificatifs --- */

test('le bucket des justificatifs est privé', () => {
  const insert = SQL.slice(
    SQL.indexOf("insert into storage.buckets"),
    SQL.indexOf('drop policy if exists justificatifs_read'),
  );

  assert.match(insert, /'paiements-justificatifs'/);
  assert.match(insert, /\n\s+false,/, 'le bucket doit être non public');
  assert.match(insert, /set public\s+= false/, 'un rejeu ne doit pas pouvoir le rendre public');
});

test('le bucket public des contenus n’est pas réutilisé', () => {
  assert.ok(
    !/contenus-medias/.test(CODE),
    'les justificatifs n’ont rien à faire dans le bucket public de 4E-2',
  );
});

test('les formats acceptés côté code sont ceux du bucket et de la contrainte', () => {
  const insert = SQL.slice(SQL.indexOf('insert into storage.buckets'));
  for (const mime of PROOF_MIME_TYPES) {
    assert.ok(insert.includes(`'${mime}'`), `${mime} absent du bucket`);
  }

  const constraint = checkConstraint('payment_proofs_mime_allowed');
  for (const mime of PROOF_MIME_TYPES) {
    assert.ok(constraint.includes(`'${mime}'`), `${mime} absent de la contrainte`);
  }

  // Le SVG est refusé : contenu actif possible.
  assert.ok(!constraint.includes('image/svg'));
});

test('la limite de taille du code est celle du bucket', () => {
  assert.equal(PROOF_MAX_BYTES, 5_242_880);
  assert.match(SQL, /5242880/);
});

test('le chemin d’un justificatif est imposé par contrainte', () => {
  const constraint = checkConstraint('payment_proofs_path_shape');
  assert.match(constraint, /storage_path ~/);
  // Trois UUID séparés par des barres, puis une extension connue.
  assert.match(constraint, /\(jpg\|jpeg\|png\|webp\|pdf\)/);
});

test('un chemin construit par le serveur satisfait la contrainte', () => {
  const path = buildProofPath(
    '11111111-2222-3333-4444-555555555555',
    '66666666-7777-8888-9999-aaaaaaaaaaaa',
    'jpg',
  );

  assert.match(
    path,
    /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/,
  );
  assert.ok(!path.includes('..'));
});

test('le type d’un justificatif se lit dans ses octets, pas dans son nom', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const pdf = new Uint8Array([...'%PDF-1.7'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0]));
  const webp = new Uint8Array([
    ...[...'RIFF'].map((c) => c.charCodeAt(0)),
    0, 0, 0, 0,
    ...[...'WEBP'].map((c) => c.charCodeAt(0)),
  ]);

  const typeOf = (bytes: Uint8Array) => {
    const result = sniffProof(bytes, bytes.length);
    return result.ok ? result.mimeType : `refusé (${result.reason})`;
  };

  assert.equal(typeOf(jpeg), 'image/jpeg');
  assert.equal(typeOf(png), 'image/png');
  assert.equal(typeOf(pdf), 'application/pdf');
  assert.equal(typeOf(webp), 'image/webp');
});

test('un exécutable renommé « recu.pdf » est refusé', () => {
  // MZ : en-tête d'un exécutable Windows.
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const result = sniffProof(exe, exe.length);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'type');
});

test('un SVG portant du script est refusé', () => {
  const svg = new Uint8Array([...'<svg xmlns="http://'].map((c) => c.charCodeAt(0)));
  assert.equal(sniffProof(svg, svg.length).ok, false);
});

test('un fichier trop gros est refusé avant d’être lu', () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const result = sniffProof(bytes, PROOF_MAX_BYTES + 1);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'taille');
});

test('un fichier vide est refusé', () => {
  assert.equal(sniffProof(new Uint8Array(), 0).ok, false);
});

test('la lecture d’un justificatif passe par le propriétaire ou la permission', () => {
  const policy = SQL.slice(
    SQL.indexOf('create policy justificatifs_read'),
    SQL.indexOf('-- Dépôt : le titulaire'),
  );

  assert.match(policy, /can_view_paiements\(\)/);
  assert.match(policy, /o\.user_id = auth\.uid\(\)/);
  assert.match(policy, /storage\.foldername\(name\)/);
  // Rien pour anon : le bucket n'est jamais lisible sans session.
  assert.ok(!/to anon/.test(policy));
});

/* ---------------------------------------------- ce que 4G ne fait pas --- */

test('aucune commission n’est calculée', () => {
  const body = SQL.replace(/--[^\n]*/g, '');
  for (const forbidden of ['commission', 'affiliate_click', 'payout', 'COMAF']) {
    assert.ok(
      !new RegExp(forbidden, 'i').test(body),
      `${forbidden} appartient à la phase 4H`,
    );
  }
});

test('aucune migration historique n’est modifiée', () => {
  // La phase ajoute un fichier, elle n'en retouche aucun. Le contrôle porte
  // sur la présence des huit migrations antérieures, que `npm run db:migrate`
  // compare par empreinte à ce que la base a appliqué.
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  // Les migrations ultérieures (finalisation 4G et suivantes) s'ajoutent après
  // celle-ci ; elles ne la déplacent ni ne la remplacent.
  assert.ok(files.length >= 9);
  assert.equal(files[8], '20260930160000_commerce_commandes_paiements.sql');
});

/* --------------------------------------------------------- mise en forme --- */

test('les montants s’affichent en francs comoriens, sans décimale inutile', () => {
  assert.match(formatAmount('15000.00'), /^15\s?000 KMF$/);
  assert.match(formatAmount('250.50'), /^250,50 KMF$/);
  assert.equal(formatAmount(null), '—');
  assert.equal(formatAmount('pas un nombre'), '—');
});

test('les quantités s’affichent sans zéros décoratifs', () => {
  assert.equal(formatQuantity('1.000'), '1');
  assert.equal(formatQuantity('2.500'), '2,5');
  assert.equal(formatQuantity(null), '—');
});

test('le reste dû ne descend jamais sous zéro', () => {
  assert.equal(remainingDue('10000.00', '4000.00'), 6000);
  assert.equal(remainingDue('10000.00', '10000.00'), 0);
  // Un trop-perçu ne se raconte pas comme une dette négative.
  assert.equal(remainingDue('10000.00', '12000.00'), 0);
});
