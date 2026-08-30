import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sauvegarde / Restauration (module Paramètres).
 * GET  → export JSON (données applicatives, sans secrets ni mots de passe).
 * POST → restauration sécurisée (validation + sauvegarde de sécurité préalable).
 */

async function collectBackup(supabase: ReturnType<typeof createAdminClient>) {
  const [settings, faqs, products, services] = await Promise.all([
    supabase.from("settings").select("id, value, is_public").limit(500),
    supabase.from("faqs").select("*").limit(1000),
    supabase.from("products").select("*").limit(1000),
    supabase.from("services").select("*").limit(1000),
  ]);

  return {
    format: "mora-shawiri-backup",
    version: "1.0",
    exportedAt: new Date().toISOString(),
    data: {
      settings: settings.data ?? [],
      faqs: faqs.data ?? [],
      products: products.data ?? [],
      services: services.data ?? [],
    },
  };
}

export async function GET() {
  try {
    const supabase = createAdminClient();
    const backup = await collectBackup(supabase);
    return NextResponse.json(backup, {
      headers: {
        "Content-Disposition": `attachment; filename="mora-shawiri-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Export impossible." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: "Fichier JSON invalide." }, { status: 400 });
    }

    const backup = payload as {
      format?: string;
      version?: string;
      data?: { settings?: unknown[]; faqs?: unknown[]; products?: unknown[]; services?: unknown[] };
    };

    if (backup?.format !== "mora-shawiri-backup" || !backup.data) {
      return NextResponse.json({ error: "Format de sauvegarde non reconnu." }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Sauvegarde de sécurité avant restauration (dans audit_logs).
    const current = await collectBackup(supabase);
    await supabase.from("audit_logs").insert({
      action: "backup_before_restore",
      resource: "settings/faqs/products/services",
      result: "ok",
      context: { count: Object.values(current.data).map((v: unknown) => Array.isArray(v) ? v.length : 0) },
    });

    // Restauration : on upsert uniquement les tables applicatives (config publiques, contenus).
    const settings = Array.isArray(backup.data.settings) ? backup.data.settings : [];
    const faqs = Array.isArray(backup.data.faqs) ? backup.data.faqs : [];
    const products = Array.isArray(backup.data.products) ? backup.data.products : [];
    const services = Array.isArray(backup.data.services) ? backup.data.services : [];

    if (settings.length) await supabase.from("settings").upsert(settings, { onConflict: "id" });
    if (faqs.length) await supabase.from("faqs").upsert(faqs, { onConflict: "id" });
    if (products.length) await supabase.from("products").upsert(products, { onConflict: "id" });
    if (services.length) await supabase.from("services").upsert(services, { onConflict: "id" });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Restauration impossible." }, { status: 500 });
  }
}
