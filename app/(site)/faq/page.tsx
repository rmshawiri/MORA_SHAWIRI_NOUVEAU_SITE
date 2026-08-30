import type { Metadata } from "next";
import { faqs as seedFaqs, faqCategories as seedCats, type Faq } from "@/lib/data/faqs";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/config";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Réponses aux questions fréquentes sur MORA Shawiri : services, tarifs, devis, rendez-vous, formation, boutique et affiliation.",
  alternates: { canonical: absoluteUrl("/faq") },
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
    <div className="bg-surface">
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
        <SectionHeading
          eyebrow="FAQ"
          title="Questions fréquentes"
          description="Des réponses claires sur nos services, tarifs, devis, rendez-vous, formation, boutique et programme d'affiliation."
        />

        <div className="mt-12 space-y-12">
          {faqCategories.map((cat) => {
            const items = faqs.filter((f) => f.category === cat);
            return (
              <section key={cat}>
                <Reveal>
                  <div className="flex items-center gap-3">
                    <h2 className="font-display text-lg font-bold tracking-tight text-mora-blue sm:text-xl">
                      {cat}
                    </h2>
                    <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-mora-blue-20 to-transparent" />
                  </div>
                </Reveal>
                <div className="mt-5 space-y-3">
                  {items.map((f, i) => (
                    <details
                      key={`${cat}-${i}`}
                      className="group rounded-2xl border border-gray-100 bg-white shadow-soft transition-all duration-200 open:border-mora-blue-40/40 open:shadow-card"
                    >
                      <summary className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl px-5 py-4 text-sm font-semibold text-gray-800 transition-colors hover:text-mora-blue focus-visible:outline-mora-blue">
                        {f.question}
                        <span
                          aria-hidden
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mora-blue-10 text-mora-blue transition-transform group-open:rotate-180"
                        >
                          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </span>
                      </summary>
                      <div className="px-5 pb-5 text-sm leading-relaxed text-gray-600">
                        {f.answer}
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <Reveal>
          <div className="relative mt-14 overflow-hidden rounded-3xl bg-mora-gradient p-8 text-center text-white shadow-lift sm:p-10">
            <div aria-hidden className="absolute inset-0 bg-mora-grid opacity-50" />
            <div aria-hidden className="absolute -left-12 -top-12 h-40 w-40 rounded-full bg-mora-or/15 blur-3xl" />
            <div className="relative">
              <h2 className="font-display text-xl font-bold">Une autre question ?</h2>
              <p className="mx-auto mt-2 max-w-md text-blue-100/90">
                Contactez-nous directement sur WhatsApp ou via notre formulaire de contact.
              </p>
              <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                <Button href="/contact" variant="secondary" size="md">Nous contacter</Button>
                <Button href="/services" variant="primary" size="md">Voir nos services</Button>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
