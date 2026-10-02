/**
 * Suite des références client `MORA-CLI` — protection des contrôles (phase 4I).
 *
 * Depuis la phase 4I, un compte reçoit sa référence `MORA-CLI-…` dès qu'il
 * réunit le rôle CLIENT et une adresse confirmée. Les contrôles automatisés
 * créent de tels comptes (en `@mora-shawiri.test`) : sans précaution, chacun
 * consommerait un vrai numéro de la suite, et le premier client réel suivant
 * hériterait d'un trou.
 *
 * Règle (celle de la phase 4F, `mora-shawiri-numerotation-tests`) : relever la
 * suite avant, la restituer après, et le **prouver**.
 *
 * Une exception, assumée : si un vrai client s'est inscrit pendant le
 * contrôle, sa référence existe encore après le démontage des comptes de
 * test. La suite n'est alors jamais ramenée en dessous de lui — elle s'arrête
 * à la plus haute référence réellement portée, et le résultat le dit. Une
 * suite ramenée sous une référence existante ferait échouer l'inscription
 * suivante sur l'unicité.
 */

const CODE = 'CLI';

/** Ordre des références : série (A < … < Z < AA …), puis numéro. */
function rank(series, number) {
  return [series.length, series, number];
}

function compare(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

function parse(reference) {
  const match = /^MORA-CLI-([A-Z]+)(\d{4})$/.exec(reference ?? '');
  return match ? { series: match[1], number: Number(match[2]) } : null;
}

/** État de la suite CLI (ou `null` si aucun numéro n'a jamais été alloué). */
export async function readClientSequence(runSql, target, accessToken) {
  const rows = await runSql(
    target,
    accessToken,
    `select series, last_number, allocated_count from public.document_sequences where doc_type = '${CODE}';`,
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? { series: row.series, last_number: row.last_number, allocated_count: row.allocated_count } : null;
}

/**
 * Restitue la suite telle qu'elle a été relevée — sauf à passer sous une
 * référence client réellement portée. À appeler **après** la suppression des
 * comptes de contrôle.
 */
export async function restoreClientSequence(runSql, target, accessToken, snapshot) {
  const refs = await runSql(target, accessToken, `select reference from public.clients;`);
  const existing = (Array.isArray(refs) ? refs : []).map((row) => parse(row.reference)).filter(Boolean);

  const floor = snapshot ? rank(snapshot.series, snapshot.last_number) : null;
  const above = existing.filter((ref) => !floor || compare(rank(ref.series, ref.number), floor) > 0);

  let target_state = snapshot;
  let note = null;

  if (above.length > 0) {
    // Des références au-delà du relevé existent encore : de vrais clients
    // inscrits pendant le contrôle, ou des comptes de contrôle non démontés.
    const highest = above.reduce((max, ref) =>
      compare(rank(ref.series, ref.number), rank(max.series, max.number)) > 0 ? ref : max,
    );
    target_state = {
      series: highest.series,
      last_number: highest.number,
      allocated_count: (snapshot?.allocated_count ?? 0) + above.length,
    };
    note = `${above.length} référence(s) au-delà du relevé encore portée(s) — suite arrêtée à MORA-CLI-${highest.series}${String(highest.number).padStart(4, '0')}`;
  }

  const sql = target_state
    ? `update public.document_sequences
          set series = '${target_state.series}', last_number = ${Number(target_state.last_number)},
              allocated_count = ${Number(target_state.allocated_count)}, updated_at = now()
        where doc_type = '${CODE}';`
    : `delete from public.document_sequences where doc_type = '${CODE}';`;
  await runSql(target, accessToken, sql);

  const after = await readClientSequence(runSql, target, accessToken);
  const restored = JSON.stringify(after) === JSON.stringify(target_state ?? null);
  return {
    restored,
    identical: restored && note === null,
    before: snapshot,
    after,
    note,
  };
}
