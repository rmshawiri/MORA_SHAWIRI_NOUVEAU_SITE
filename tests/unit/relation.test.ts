/**
 * Invariants de la relation client — phase 4F.
 *
 * ## Ce que ces tests attrapent, et ce qu'ils n'attrapent pas
 *
 * Ils lisent le SQL, ils ne l'exécutent pas. La phase 4E-1 a montré la limite
 * de l'exercice : un garde `SECURITY DEFINER` s'y lisait correctement et ne
 * refusait rien. C'est pourquoi `scripts/verify-relation.mjs` éprouve les
 * mêmes règles contre la vraie base, avec de vraies sessions.
 *
 * Ce que la lecture du SQL fait mieux, en revanche : constater une **absence**.
 * Qu'aucune politique n'ouvre ces tables au rôle anonyme, qu'aucun privilège
 * ne laisse une session écrire une référence, qu'aucun paramètre de fonction
 * publique n'accepte un identifiant d'utilisateur. Une absence ne se teste pas
 * en base — on ne peut qu'essayer ce à quoi on pense.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APPOINTMENT_TRANSITIONS,
  formatAmount,
  formatDay,
  formatRange,
  formatSlot,
  offeredQuoteRequestStatuses,
  QUOTE_REQUEST_STATUS_LABELS,
  QUOTE_REQUEST_TRANSITIONS,
  QUOTE_STATUS_LABELS,
  QUOTE_TRANSITIONS,
  toLocalInputValue,
} from '../../src/lib/relation/labels';

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '20260930150000_relation_client.sql'),
  'utf8',
);

/** Les huit tables de la phase. */
const TABLES = [
  'leads',
  'quote_requests',
  'quotes',
  'quote_request_events',
  'appointments',
  'appointment_events',
  'appointment_availabilities',
  'relation_notes',
] as const;

/**
 * Extrait un graphe de transitions d'un `case old.status when … then array[…]`.
 *
 * C'est la forme exacte des trois déclencheurs. La lire plutôt que de la
 * recopier est tout l'intérêt : si le SQL change, le test le voit.
 */
function sqlTransitions(functionName: string): Record<string, string[]> {
  const start = SQL.indexOf(`create or replace function public.${functionName}()`);
  assert.notEqual(start, -1, `fonction ${functionName} introuvable`);

  const body = SQL.slice(start, SQL.indexOf('$$;', start));
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

/* ------------------------------------------------ le graphe des statuts --- */

test('le graphe des demandes en TypeScript est celui du déclencheur', () => {
  const sql = sqlTransitions('tg_quote_requests_transition_guard');

  for (const [status, allowed] of Object.entries(sql)) {
    assert.deepEqual(
      [...(QUOTE_REQUEST_TRANSITIONS[status as keyof typeof QUOTE_REQUEST_TRANSITIONS] ?? [])],
      allowed,
      `transitions divergentes pour ${status}`,
    );
  }

  // Tout statut absent du `case` est final : le `else` rend un tableau vide.
  for (const [status, allowed] of Object.entries(QUOTE_REQUEST_TRANSITIONS)) {
    if (!(status in sql)) {
      assert.deepEqual([...allowed], [], `${status} devrait être un état final`);
    }
  }
});

test('le graphe des devis en TypeScript est celui du déclencheur', () => {
  const sql = sqlTransitions('tg_quotes_transition_guard');

  for (const [status, allowed] of Object.entries(sql)) {
    assert.deepEqual(
      [...(QUOTE_TRANSITIONS[status as keyof typeof QUOTE_TRANSITIONS] ?? [])],
      allowed,
      `transitions divergentes pour ${status}`,
    );
  }
});

test('le graphe des rendez-vous en TypeScript est celui du déclencheur', () => {
  const sql = sqlTransitions('tg_appointments_transition_guard');

  for (const [status, allowed] of Object.entries(sql)) {
    assert.deepEqual(
      [...(APPOINTMENT_TRANSITIONS[status as keyof typeof APPOINTMENT_TRANSITIONS] ?? [])],
      allowed,
      `transitions divergentes pour ${status}`,
    );
  }
});

test('les états finaux le restent', () => {
  for (const status of ['REFUSEE', 'TERMINEE', 'ANNULEE'] as const) {
    assert.deepEqual([...QUOTE_REQUEST_TRANSITIONS[status]], []);
  }
  for (const status of ['ANNULE', 'TERMINE'] as const) {
    assert.deepEqual([...APPOINTMENT_TRANSITIONS[status]], []);
  }
  for (const status of ['ACCEPTE', 'REFUSE', 'EXPIRE', 'ANNULE'] as const) {
    assert.deepEqual([...QUOTE_TRANSITIONS[status]], []);
  }
});

test('« Devis envoyé » ne se choisit jamais dans une liste', () => {
  // Le statut s'obtient par l'émission d'un devis, que le déclencheur vérifie.
  // Le proposer ailleurs promettrait un refus.
  for (const status of Object.keys(QUOTE_REQUEST_TRANSITIONS) as (keyof typeof QUOTE_REQUEST_TRANSITIONS)[]) {
    assert.ok(!offeredQuoteRequestStatuses(status).includes('DEVIS_ENVOYE'));
  }

  assert.deepEqual(
    [...offeredQuoteRequestStatuses('EN_ETUDE')],
    ['REFUSEE', 'TERMINEE', 'ANNULEE'],
  );
});

test('chaque statut porte un libellé, et aucun de plus', () => {
  assert.deepEqual(
    Object.keys(QUOTE_REQUEST_STATUS_LABELS).sort(),
    Object.keys(QUOTE_REQUEST_TRANSITIONS).sort(),
  );
  assert.deepEqual(
    Object.keys(QUOTE_STATUS_LABELS).sort(),
    Object.keys(QUOTE_TRANSITIONS).sort(),
  );
});

/* ------------------------------------------------------ aucun accès anon --- */

test('aucune politique de la phase 4F n’est ouverte au rôle anonyme', () => {
  // Point 17 du cadrage : pas de politique SELECT publique sur ces tables.
  // Elles portent des noms, des adresses et des messages.
  for (const table of TABLES) {
    for (const match of SQL.matchAll(
      new RegExp(`create policy [a-z_]+\\s+on public\\.${table}[^;]*?to ([a-z_, ]+)`, 'g'),
    )) {
      assert.ok(
        !/\banon\b/.test(match[1]!),
        `une politique de ${table} vise le rôle anonyme`,
      );
    }
  }
});

test('les huit tables retirent leurs privilèges implicites à anon et authenticated', () => {
  for (const table of TABLES) {
    assert.match(
      SQL,
      new RegExp(`revoke all on public\\.${table}\\s+from anon, authenticated`),
      `privilèges implicites non retirés sur ${table}`,
    );
  }
});

test('le rôle anonyme ne reçoit aucun privilège sur ces tables', () => {
  for (const match of SQL.matchAll(/grant ([a-z, ()a-z_\n ]+?) on public\.([a-z_]+)\s+to ([a-z_, ]+)/g)) {
    if (!TABLES.includes(match[2] as (typeof TABLES)[number])) continue;
    assert.ok(!/\banon\b/.test(match[3]!), `anon reçoit un privilège sur ${match[2]}`);
  }
});

/* ------------------------------------- la référence n'est pas accessible --- */

test('aucune session ne peut écrire une référence', () => {
  // C'est le privilège de colonne, et non l'application, qui ferme la porte :
  // sans `reference`, les contraintes de forme rendent la confirmation d'un
  // rendez-vous et l'émission d'un devis impossibles hors des fonctions
  // prévues.
  for (const table of ['quote_requests', 'quotes', 'appointments']) {
    const grants = [
      ...SQL.matchAll(
        new RegExp(`grant update \\(([^)]*)\\)\\s*\\n?\\s*on public\\.${table} to authenticated`, 'g'),
      ),
    ];

    assert.ok(grants.length > 0, `aucun privilège de colonne déclaré pour ${table}`);

    for (const grant of grants) {
      assert.ok(
        !/\breference\b/.test(grant[1]!),
        `la colonne reference est modifiable sur ${table}`,
      );
    }
  }
});

test('ni document_id ni sent_at ne sont modifiables sur un devis', () => {
  const grant = /grant update \(([^)]*)\)\s*\n?\s*on public\.quotes to authenticated/.exec(SQL);
  assert.ok(grant, 'privilège de colonne des devis introuvable');
  assert.ok(!/document_id/.test(grant![1]!));
  assert.ok(!/sent_at/.test(grant![1]!));
});

test('le message d’une demande n’est jamais modifiable', () => {
  // Le plan exige qu'il soit « conservé intégralement ». Le retirer du
  // privilège de colonne le rend immuable pour toute session.
  const grant = /grant update \(([\s\S]*?)\)\s*\n?\s*on public\.quote_requests to authenticated/.exec(
    SQL,
  );
  assert.ok(grant, 'privilège de colonne des demandes introuvable');
  assert.ok(!/\bmessage\b/.test(grant![1]!));
  assert.ok(!/\blead_id\b/.test(grant![1]!));
  assert.ok(!/\buser_id\b/.test(grant![1]!));
});

/* ----------------------------------------------- pas d'usurpation possible --- */

test('les deux portes publiques n’acceptent aucun identifiant d’utilisateur', () => {
  // Point 9 du cadrage. Le rattachement est lu dans auth.uid() à l'intérieur
  // de la fonction : il n'y a rien à falsifier dans la requête.
  for (const name of ['submit_quote_request', 'submit_appointment_request']) {
    const start = SQL.indexOf(`create or replace function public.${name}(`);
    assert.notEqual(start, -1, `${name} introuvable`);

    const signature = SQL.slice(start, SQL.indexOf(')\nreturns', start));

    for (const forbidden of ['user_id', 'client_id', 'lead_id', 'owner', 'role', 'status']) {
      assert.ok(
        !new RegExp(`p_[a-z_]*${forbidden}`).test(signature),
        `${name} accepte un paramètre ${forbidden}`,
      );
    }
  }
});

test('les deux portes publiques lisent auth.uid() elles-mêmes', () => {
  for (const name of ['submit_quote_request', 'submit_appointment_request']) {
    const start = SQL.indexOf(`create or replace function public.${name}(`);
    const body = SQL.slice(start, SQL.indexOf('$$;', start));
    assert.match(body, /auth\.uid\(\)/, `${name} n'établit pas le rattachement lui-même`);
  }
});

test('un compte ne s’approprie une fiche prospect que si l’adresse est la sienne', () => {
  const start = SQL.indexOf('create or replace function public.relation_upsert_lead(');
  const body = SQL.slice(start, SQL.indexOf('$$;', start));

  // La preuve d'appartenance : l'adresse du compte, lue dans auth.users.
  assert.match(body, /from auth\.users u/);
  assert.match(body, /lower\(u\.email\) = v_email/);
  // Et un rattachement acquis ne se reprend pas.
  assert.match(body, /when l\.user_id is null then excluded\.user_id/);
});

test('l’auteur d’une note est imposé, jamais lu', () => {
  const start = SQL.indexOf('create or replace function public.tg_relation_notes_author()');
  const body = SQL.slice(start, SQL.indexOf('$$;', start));

  assert.match(body, /new\.author_id\s*:=\s*auth\.uid\(\)/);
});

/* ------------------------------------------------- double réservation --- */

test('la double réservation est refusée par une contrainte, pas par du code', () => {
  // § 31-32 : la vérification doit tenir même entre deux confirmations
  // simultanées. Une lecture suivie d'une écriture laisserait une fenêtre.
  assert.match(
    SQL,
    /constraint appointments_no_double_booking\s+exclude using gist \(tstzrange\(scheduled_at, scheduled_end, '\[\)'\) with &&\)\s+where \(status = 'CONFIRME'\)/,
  );
});

test('seuls les rendez-vous confirmés occupent un créneau', () => {
  // § 64 : après une annulation, le créneau redevient disponible. C'est la
  // clause `where` de la contrainte qui le garantit, sans code de libération.
  const match = /exclude using gist[^;]*?where \(status = '([A-Z_]+)'\)/.exec(SQL);
  assert.equal(match?.[1], 'CONFIRME');
});

test('un rendez-vous confirmé porte forcément un créneau et une référence', () => {
  assert.match(
    SQL,
    /constraint appointments_confirmed_shape check \(\s*status <> 'CONFIRME'\s*or \(scheduled_at is not null and reference is not null and confirmed_at is not null\)/,
  );
});

/* --------------------------------------------------- données personnelles --- */

test('le journal d’audit ne reçoit ni message, ni adresse, ni téléphone', () => {
  // Point 17 du cadrage : « éviter de recopier inutilement les messages
  // complets ou autres données personnelles ».
  const start = SQL.indexOf('create or replace function public.tg_relation_audit()');
  const body = SQL.slice(start, SQL.indexOf('$$;', start));

  for (const forbidden of ['message', 'email', 'phone', 'full_name', 'body,', 'subject']) {
    assert.ok(
      !new RegExp(`v_row\\.${forbidden}`).test(body),
      `le journal d'audit recopie ${forbidden}`,
    );
  }
});

test('aucune colonne de la phase ne duplique une prestation du catalogue', () => {
  // Le catalogue 4E-1 reste la source. La demande porte une clé étrangère et
  // un instantané du titre, pas un prix ni une description recopiés.
  assert.match(SQL, /service_id\s+uuid references public\.services \(id\)/);
  assert.ok(!/price_label|short_description|image_path/.test(SQL));
});

/* ------------------------------------------- aucune valeur métier inventée --- */

test('aucune durée de rendez-vous n’est codée dans la migration', () => {
  // § 25 : « ne pas inventer de durée si elle n'est pas définie ».
  assert.ok(!/interval '(15|30|45|60) minutes'/.test(SQL));
  assert.ok(!/duration_minutes\s+integer\s+not null/.test(SQL));
});

test('aucune disponibilité n’est semée', () => {
  // § 86 : « ne pas inventer automatiquement les jours non disponibles ».
  assert.ok(
    !/insert into public\.appointment_availabilities/.test(SQL),
    'la migration sème des disponibilités',
  );
});

test('aucune durée de validité de devis n’est imposée', () => {
  // § 134 : « ne pas inventer de délai ».
  assert.match(SQL, /valid_until\s+date,/);
  assert.ok(!/valid_until[^,]*default/.test(SQL));
});

test('les deux codes de référence ne peuvent pas émettre de document', () => {
  // Décision B2 : ils numérotent une entité métier, ils n'émettent pas de
  // pièce. `issue_document` les refuse explicitement.
  assert.match(SQL, /\('DMCL',[^)]*true\)/);
  assert.match(SQL, /\('RVCL',[^)]*true\)/);
  assert.match(SQL, /if v_type\.is_reference_only then\s*\n\s*raise exception/);
});

test('aucun second allocateur n’est créé', () => {
  // D-2 : un seul allocateur, celui de la phase 4D.
  assert.ok(!/create (or replace )?function public\.allocate_/.test(SQL));
  assert.match(SQL, /public\.allocate_document_number\('DMCL'\)/);
  assert.match(SQL, /public\.allocate_document_number\('RVCL'\)/);
});

test('aucun second système d’audit n’est créé', () => {
  // Point 12 du cadrage. L'historique métier est distinct de l'audit, mais
  // l'audit reste celui de la phase 4A.
  assert.ok(!/create table if not exists public\.[a-z_]*audit/.test(SQL));
  assert.match(SQL, /perform public\.record_audit_event\(/);
});

test('aucun taux ni mécanisme d’affiliation n’apparaît', () => {
  // La phase 4H n'est pas développée en avance.
  assert.ok(!/affiliate|commission/i.test(SQL));
});

test('aucune commande ni paiement n’apparaît', () => {
  // La phase 4G non plus.
  assert.ok(!/create table if not exists public\.(orders|payments|refunds)/.test(SQL));
});

/* ---------------------------------------------------- gardes et sécurité --- */

test('les gardes de transition sont SECURITY INVOKER', () => {
  // La leçon de 4E-1 : en DEFINER, `is_privileged_db_role()` répond
  // « privilégié » à toute session et le garde ne refuse jamais rien.
  for (const name of [
    'tg_quote_requests_transition_guard',
    'tg_quotes_transition_guard',
    'tg_appointments_transition_guard',
    'tg_appointments_calendar_guard',
    'tg_relation_reference_immutable',
  ]) {
    const start = SQL.indexOf(`create or replace function public.${name}()`);
    assert.notEqual(start, -1, `${name} introuvable`);

    const header = SQL.slice(start, SQL.indexOf('as $$', start));
    assert.match(header, /security invoker/, `${name} devrait être SECURITY INVOKER`);
  }
});

test('les deux fonctions DEFINER qui allouent un numéro vérifient la permission', () => {
  // À l'intérieur d'une fonction DEFINER, le garde de transition voit
  // `current_user = postgres` et laisse passer. La permission est donc
  // revérifiée sur `auth.uid()`, qui traverse la frontière intact.
  const confirm = SQL.slice(
    SQL.indexOf('create or replace function public.confirm_appointment('),
    SQL.indexOf('$$;', SQL.indexOf('create or replace function public.confirm_appointment(')),
  );
  assert.match(confirm, /has_permission\('appointments\.update'\)/);
  assert.match(confirm, /session_is_aal2\(\)/);

  const send = SQL.slice(
    SQL.indexOf('create or replace function public.send_quote('),
    SQL.indexOf('$$;', SQL.indexOf('create or replace function public.send_quote(')),
  );
  assert.match(send, /has_permission\('quotes\.manage'\)/);
});

test('annuler un rendez-vous exige sa propre permission', () => {
  // § 51-53 : c'est un acte distinct, et la phase 4A lui a réservé
  // `appointments.cancel`.
  const start = SQL.indexOf('create or replace function public.tg_appointments_transition_guard()');
  const body = SQL.slice(start, SQL.indexOf('$$;', start));

  assert.match(body, /when new\.status = 'ANNULE' then 'appointments\.cancel'/);
});

test('changer un statut de demande exige quotes.manage, pas quotes.update', () => {
  const start = SQL.indexOf('create or replace function public.tg_quote_requests_transition_guard()');
  const body = SQL.slice(start, SQL.indexOf('$$;', start));

  assert.match(body, /has_permission\('quotes\.manage'\)/);
  assert.ok(!/has_permission\('quotes\.update'\)/.test(body));
});

test('« Devis envoyé » exige un devis réellement émis', () => {
  const start = SQL.indexOf('create or replace function public.tg_quote_requests_transition_guard()');
  const body = SQL.slice(start, SQL.indexOf('$$;', start));

  assert.match(body, /from public\.quotes q[\s\S]*?q\.status <> 'BROUILLON'/);
});

test('les historiques métier sont en ajout seul', () => {
  // Aucune politique d'écriture, aucun privilège d'insertion : seuls les
  // déclencheurs y écrivent, comme pour le journal d'audit.
  for (const table of ['quote_request_events', 'appointment_events']) {
    assert.ok(
      !new RegExp(`create policy [a-z_]+\\s+on public\\.${table} for (insert|update|delete)`).test(
        SQL,
      ),
      `${table} accepte une écriture directe`,
    );
    assert.match(
      SQL,
      new RegExp(`grant select on public\\.${table}\\s+to authenticated`),
      `${table} devrait être lisible`,
    );
  }
});

test('un client ne voit que ses propres demandes', () => {
  // Le cas indispensable du point 16 du cadrage : CLIENT A contre CLIENT B.
  // La politique ne filtre pas sur une valeur reçue, mais sur auth.uid().
  assert.match(
    SQL,
    /create policy quote_requests_select_own[\s\S]*?using \(user_id is not null and user_id = auth\.uid\(\)\)/,
  );
  assert.match(
    SQL,
    /create policy appointments_select_own[\s\S]*?using \(user_id is not null and user_id = auth\.uid\(\)\)/,
  );
});

test('les notes internes ne sont jamais ouvertes au demandeur', () => {
  const policies = [
    ...SQL.matchAll(/create policy (relation_notes_[a-z_]+)[\s\S]*?(?=\n\ndrop policy|\n\n\/\*|$)/g),
  ];

  assert.ok(policies.length > 0, 'aucune politique sur relation_notes');

  for (const policy of policies) {
    assert.ok(
      !/user_id = auth\.uid\(\)/.test(policy[0]),
      `${policy[1]} ouvre une note au demandeur`,
    );
  }
});

test('un brouillon de devis n’est pas visible du client', () => {
  // § 27 de l'espace client : « le système ne doit jamais afficher un devis
  // fictif ». Un brouillon n'existe pas encore pour le demandeur.
  assert.match(
    SQL,
    /create policy quotes_select_own[\s\S]*?status <> 'BROUILLON'/,
  );
});

/* ------------------------------------------------------------ affichage --- */

test('une date souhaitée se lit en français, sans heure', () => {
  assert.equal(formatDay('2026-10-05'), 'lundi 5 octobre 2026');
  assert.equal(formatDay(null), '—');
});

test('un créneau ferme affiche ses deux bornes', () => {
  // 06:00 UTC = 09:00 à Moroni (UTC+3, sans heure d'été).
  const rendered = formatSlot('2026-10-05T06:00:00Z', '2026-10-05T07:30:00Z');
  assert.match(rendered, /09:00/);
  assert.match(rendered, /10:30/);
  assert.match(rendered, /5 octobre 2026/);
});

test('un créneau sans fin ne prétend pas en avoir une', () => {
  const rendered = formatSlot('2026-10-05T06:00:00Z', null);
  assert.ok(!rendered.includes('–'));
});

test('une plage sans horaire couvre la journée', () => {
  assert.equal(formatRange(null, null), 'Journée entière');
  assert.equal(formatRange('08:00:00', '12:00:00'), '08:00 – 12:00');
});

test('un montant garde ses centimes', () => {
  // `numeric` est lu comme une chaîne : un flottant perdrait la précision.
  assert.match(formatAmount('150000.00', 'KMF'), /150\s?000/);
  assert.match(formatAmount('150000.00', 'KMF'), /KMF$/);
});

test('un montant illisible est rendu tel quel plutôt que faussé', () => {
  assert.equal(formatAmount('abc', 'KMF'), 'abc KMF');
});

test('la valeur d’une entrée datetime-local est celle de Moroni', () => {
  assert.equal(toLocalInputValue('2026-10-05T06:00:00Z'), '2026-10-05T09:00');
  assert.equal(toLocalInputValue(null), '');
});
