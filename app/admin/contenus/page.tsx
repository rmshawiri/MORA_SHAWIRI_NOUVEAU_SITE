import { createAdminClient } from "@/lib/supabase/admin";
import { FaqManager } from "@/components/admin/FaqManager";
import { AdminPage } from "@/components/admin/AdminPage";

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
    <AdminPage
      icon="▤"
      title="07 — Gestion des contenus"
      subtitle="FAQ du site. Ajoutez, modifiez ou supprimez des questions — publication immédiate."
    >
      <FaqManager faqs={faqs} />
    </AdminPage>
  );
}
