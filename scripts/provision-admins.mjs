// ============================================================
//  MORA Shawiri — Provisioning des administrateurs initiaux
//  (rachade, amina, nizaati) — SÉCURISÉ
//
//  ⚠️ Aucun mot de passe n'est codé en dur : ils sont lus depuis
//  les variables d'environnement. Le script utilise la clé SERVICE ROLE
//  (côté serveur uniquement) pour créer les comptes et attribuer les rôles.
//
//  Usage :
//    NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//    ADMIN1_EMAIL=... ADMIN1_PASSWORD=... \
//    ADMIN2_EMAIL=... ADMIN2_PASSWORD=... \
//    ADMIN3_EMAIL=... ADMIN3_PASSWORD=... \
//    node scripts/provision-admins.mjs
// ============================================================
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Variables Supabase manquantes (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const admins = [
  { username: "rachade", role: "SUPER_ADMIN", email: process.env.ADMIN1_EMAIL, password: process.env.ADMIN1_PASSWORD },
  { username: "amina", role: "ADMIN", email: process.env.ADMIN2_EMAIL, password: process.env.ADMIN2_PASSWORD },
  { username: "nizaati", role: "ADMIN", email: process.env.ADMIN3_EMAIL, password: process.env.ADMIN3_PASSWORD },
];

// Récupération des id de rôles.
async function roleIds() {
  const { data, error } = await supabase.from("roles").select("id, name");
  if (error) {
    console.error("Impossible de lire les rôles :", error.message);
    process.exit(1);
  }
  const map = {};
  for (const r of data ?? []) map[r.name] = r.id;
  return map;
}

async function main() {
  const roles = await roleIds();
  for (const a of admins) {
    if (!a.email || !a.password) {
      console.log(`SKIP ${a.username} : email/mot de passe non fournis (env ADMIN*.EMAIL/PASSWORD).`);
      continue;
    }
    try {
      // Créer l'utilisateur Auth (confirmed) s'il n'existe pas déjà.
      const { data: existing } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", a.email)
        .maybeSingle();
      let userId = existing?.id;

      if (!userId) {
        const { data: created, error: err } = await supabase.auth.admin.createUser({
          email: a.email,
          password: a.password,
          email_confirm: true,
          user_metadata: { full_name: a.username },
        });
        if (err) {
          console.log(`ERR ${a.username} : ${err.message}`);
          continue;
        }
        userId = created.user.id;
      }

      // Profil
      await supabase.from("profiles").upsert(
        { id: userId, email: a.email, username: a.username, status: "active" },
        { onConflict: "id" },
      );

      // Rôle
      const roleId = roles[a.role];
      if (roleId) {
        const { error: e } = await supabase.from("user_roles").upsert(
          { user_id: userId, role_id: roleId },
          { onConflict: "user_id,role_id" },
        );
        if (e) console.log(`ERR ${a.username} rôle : ${e.message}`);
      }

      console.log(`OK ${a.username} (${a.email}) -> ${a.role}`);
    } catch (e) {
      console.log(`ERR ${a.username} : ${e.message}`);
    }
  }
}

main();
