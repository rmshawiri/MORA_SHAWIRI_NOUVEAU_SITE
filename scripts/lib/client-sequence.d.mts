/** Types de `client-sequence.mjs` (phase 4I), pour les tests unitaires. */

export type ClientSequence = { series: string; last_number: number; allocated_count: number };

type RunSql = (target: unknown, accessToken: unknown, sql: string) => Promise<unknown>;

export function readClientSequence(runSql: RunSql, target: unknown, accessToken: unknown): Promise<ClientSequence | null>;

export function restoreClientSequence(
  runSql: RunSql,
  target: unknown,
  accessToken: unknown,
  snapshot: ClientSequence | null,
): Promise<{
  restored: boolean;
  identical: boolean;
  before: ClientSequence | null;
  after: ClientSequence | null;
  note: string | null;
}>;
