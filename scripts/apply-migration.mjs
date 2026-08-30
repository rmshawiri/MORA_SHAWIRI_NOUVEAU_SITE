// Script d'application des migrations Supabase (usage interne / CI).
// Lit la configuration depuis les variables d'environnement (aucun secret dans ce fichier).
// Usage : PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=postgres node scripts/apply-migration.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../supabase/migrations/0001_init.sql",
);

const client = new Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "postgres",
  ssl: { rejectUnauthorized: false },
});

try {
  console.log(`Connexion à ${process.env.PGHOST} (db ${process.env.PGDATABASE})…`);
  await client.connect();
  const sql = await readFile(file, "utf8");
  console.log(`Application de ${path.basename(file)} (${sql.length} octets)…`);
  await client.query(sql);
  console.log("Migration appliquée avec succès.");

  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema='public' order by table_name;",
  );
  console.log(`Tables publiques (${rows.length}) :`);
  for (const r of rows) console.log("  -", r.table_name);
} catch (err) {
  console.error("ERREUR pendant l'application de la migration :");
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
