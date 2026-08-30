import { createAdminClient } from "@/lib/supabase/admin";
import { FaqManager } from "@/components/admin/FaqManager";

export const metadata = { title: "Contenus — Administration", robots: { index: false, follow: false } };

export default async function AdminContenusPage() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("faqs")
    .select("id, question, answer, category, is_active")
    .order("sort_order", { ascending: true })
    .limit(200);

  const faqs = (data ?? []).map((f) => ({
    id: f.id,
    question: f.question,
    answer: f.answer,
    category: f.category,
    is_active: f.is_active,
  }));

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl font-bold text-gray-900">07 — Gestion des contenus</h1>
      <p className="mt-1 text-sm text-gray-500">
        FAQ du site. Ajoutez, modifiez ou supprimez des questions — publication immédiate.
      </p>
      <div className="mt-6">
        <FaqManager faqs={faqs} />
      </div>
    </div>
  );
}
