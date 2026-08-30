import type { Metadata } from "next";
import { faqs as seedFaqs, faqCategories as seedCats, type Faq } from "@/lib/data/faqs";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/config";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Réponses aux questions fréquentes sur MORA Shawiri : services, tarifs, devis, rendez-vous, formation, boutique et affiliation.",
  alternates: { canonical: absoluteUrl("/faq") },
  // Données structurées FAQ (contenu réel visible).
};

export default async function FaqPage() {
  // Lecture depuis la base (gérée par l'admin) ; repli sur les données réelles par défaut.
  let faqs: Faq[] = seedFaqs;
  let faqCategories: string[] = seedCats;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("faqs")
      .select("question, answer, category, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (data && data.length > 0) {
      faqs = data.map((f) => ({
        question: f.question,
        answer: f.answer,
        category: (f.category as Faq["category"]) ?? "Général",
      }));
      faqCategories = Array.from(new Set(faqs.map((f) => f.category)));
    }
  } catch {
    // Conserver les données par défaut si la base n'est pas disponible.
  }

  return (
    <div className="bg-gray-structure">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-bold text-gray-900 sm:text-4xl">
          Questions fréquentes
        </h1>
        <p className="mt-3 text-gray-600">
          Des réponses claires sur nos services, tarifs, devis, rendez-vous, formation, boutique et
          programme d&apos;affiliation.
        </p>

        <div className="mt-10 space-y-10">
          {faqCategories.map((cat) => {
            const items = faqs.filter((f) => f.category === cat);
            return (
              <section key={cat}>
                <h2 className="font-display text-lg font-bold text-mora-blue">{cat}</h2>
                <div className="mt-3 space-y-3">
                  {items.map((f, i) => (
                    <details
                      key={`${cat}-${i}`}
                      className="group rounded-2xl border border-gray-100 bg-white"
                    >
                      <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-gray-800 transition-colors hover:text-mora-blue">
                        {f.question}
                        <span className="text-mora-blue" aria-hidden>
                          <span className="group-open:hidden">＋</span>
                          <span className="hidden group-open:inline">－</span>
                        </span>
                      </summary>
                      <div className="px-5 pb-4 text-sm leading-relaxed text-gray-600">
                        {f.answer}
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-12 rounded-3xl bg-mora-blue p-8 text-center">
          <h2 className="font-display text-xl font-bold text-white">Une autre question ?</h2>
          <p className="mx-auto mt-2 max-w-md text-blue-100">
            Contactez-nous directement sur WhatsApp ou via notre formulaire de contact.
          </p>
          <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
            <Button href="/contact" variant="secondary" size="md">
              Nous contacter
            </Button>
            <Button href="/services" variant="primary" size="md">
              Voir nos services
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
