import { createAdminClient } from "@/lib/supabase/admin";
import { PromoManager } from "@/components/admin/PromoManager";

export const metadata = { title: "Marketing — Administration", robots: { index: false, follow: false } };

export default async function AdminMarketingPage() {
  let promos: { id: string; code: string; discount_type: string; value: number; is_active: boolean; used_count: number; valid_until: string | null }[] = [];
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("promo_codes")
      .select("id, code, discount_type, value, is_active, used_count, valid_until")
      .order("created_at", { ascending: false })
      .limit(200);
    promos = (data ?? []).map((p) => ({
      id: p.id,
      code: p.code,
      discount_type: p.discount_type,
      value: p.value,
      is_active: p.is_active,
      used_count: p.used_count,
      valid_until: p.valid_until,
    }));
  } catch {
    // Table non encore créée -> état vide (voir note sur la migration 0002).
  }

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl font-bold text-gray-900">11 — Gestion du marketing</h1>
      <p className="mt-1 text-sm text-gray-500">
        Codes promotionnels. Créez des codes de réduction (% ou montant).
      </p>
      <div className="mt-6">
        <PromoManager promos={promos} />
      </div>
    </div>
  );
}
