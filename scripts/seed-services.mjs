// ============================================================
//  MORA Shawiri — Seed des 14 services + catégories (base)
//  Utilise l'API Supabase (HTTPS) via la clé service role.
//  Usage :
//    NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-services.mjs
// ============================================================
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Variables Supabase manquantes."); process.exit(1); }
const supabase = createClient(url, key, { auth: { persistSession: false } });

const categories = [
  { name: "Services Digitaux", slug: "services-digitaux" },
  { name: "Audit & Accompagnement", slug: "audit-accompagnement" },
  { name: "Design & Création Visuelle", slug: "design-creation-visuelle" },
  { name: "Services Administratifs", slug: "services-administratifs" },
  { name: "Formation", slug: "formation" },
];

// Référence : 02_CONTENUS/02_SERVICES.md (données réelles, aucune invention).
const services = [
  { name: "Assistance & Accompagnement Digital", slug: "accompagnement-digital", category: "Services Digitaux", price: null, priceType: "quote", cta1: "Demander un accompagnement", cta2: "Discuter sur WhatsApp", direct: false, rdv: true, aff: true, img: "/services/accompagnement-digital.webp", summary: "Un accompagnement personnalisé pour un besoin, un choix d'outil ou un projet numérique.", description: "MORA Shawiri vous accompagne pour trouver et mettre en œuvre une solution adaptée à votre situation." },
  { name: "Audit Stratégique Global", slug: "audit-strategique-global", category: "Audit & Accompagnement", price: 30000, priceType: "fixed", cta1: "Commander mon audit", cta2: "Prendre rendez-vous", direct: true, rdv: true, aff: true, img: "/services/audit-strategique-global.webp", summary: "Analyse globale pour identifier forces, faiblesses, blocages et opportunités.", description: "Diagnostic stratégique structuré accompagné de recommandations concrètes et priorisées." },
  { name: "Conception de Template", slug: "conception-de-template", category: "Design & Création Visuelle", price: null, priceType: "quote", cta1: "Demander un devis", cta2: "Discuter sur WhatsApp", direct: false, rdv: true, aff: true, img: "/services/conception-de-template.webp", summary: "Création de modèles personnalisés professionnels, administratifs ou numériques.", description: "Modèles adaptés au besoin réel : documents, fiches, présentations, supports, templates numériques." },
  { name: "Création d'Application Mobile Professionnelle", slug: "creation-application-mobile", category: "Services Digitaux", price: null, priceType: "quote", cta1: "Présenter mon projet", cta2: "Prendre rendez-vous", direct: false, rdv: true, aff: true, img: "/services/creation-application-mobile.webp", summary: "Conception et développement d'une application mobile professionnelle.", description: "Analyse, UX/UI, développement, base de données, authentification, notifications, tests, déploiement." },
  { name: "Création de Logo", slug: "creation-de-logo", category: "Design & Création Visuelle", price: 15000, priceType: "fixed", cta1: "Commander mon logo", cta2: "Discuter sur WhatsApp", direct: true, rdv: false, aff: true, img: "/services/creation-de-logo.webp", summary: "Création d'un logo professionnel pour votre activité, projet ou marque.", description: "Un logo professionnel conçu pour représenter votre activité, votre projet ou votre marque." },
  { name: "Création de SaaS Professionnel", slug: "creation-saas-professionnel", category: "Services Digitaux", price: null, priceType: "quote", cta1: "Présenter mon projet", cta2: "Prendre rendez-vous", direct: false, rdv: true, aff: true, img: "/services/creation-saas-professionnel.webp", summary: "Conception et développement d'une solution SaaS évolutive.", description: "Analyse, architecture, UX/UI, développement, utilisateurs, abonnements, intégrations, tests." },
  { name: "Création de Site E-commerce", slug: "creation-site-ecommerce", category: "Services Digitaux", price: null, priceType: "quote", cta1: "Présenter mon projet", cta2: "Prendre rendez-vous", direct: false, rdv: true, aff: true, img: "/services/creation-site-ecommerce.webp", summary: "Création d'une boutique en ligne professionnelle.", description: "Catalogue, panier, commandes, paiement, gestion clients, SEO, responsive, mise en ligne." },
  { name: "Création de Site Vitrine", slug: "creation-site-vitrine", category: "Services Digitaux", price: null, priceType: "quote", cta1: "Présenter mon projet", cta2: "Prendre rendez-vous", direct: false, rdv: true, aff: true, img: "/services/creation-site-vitrine.webp", summary: "Site professionnel pour présenter une activité, une marque ou un projet.", description: "Structure, design, présentation, contact, WhatsApp, réseaux, responsive, SEO de base." },
  { name: "Formation — Maîtriser la Prospection et la Relation Client", slug: "formation-prospection-relation-client", category: "Formation", price: 5000, priceType: "fixed", cta1: "S'inscrire à la formation", cta2: "Poser une question", direct: true, rdv: false, aff: true, img: "/services/formation-prospection-relation-client.webp", summary: "Formation pratique en prospection, communication et relation client.", description: "5 000 KMF en ligne et présentiel. Modules : mentalité, communication, techniques de prospection, WhatsApp." },
  { name: "Gestion Documentaire", slug: "gestion-documentaire", category: "Services Administratifs", price: null, priceType: "quote", cta1: "Demander un devis", cta2: "Discuter sur WhatsApp", direct: false, rdv: true, aff: true, img: "/services/gestion-documentaire.webp", summary: "Organiser, structurer et gérer vos documents.", description: "Classement, organisation de fichiers, structuration de dossiers, archives numériques." },
  { name: "Offre Basique — Optimisation Image Produit", slug: "offre-basique-optimisation-image-produit", category: "Design & Création Visuelle", price: 250, priceType: "unit", unit: "image", cta1: "Commander l'offre", cta2: "Discuter sur WhatsApp", direct: true, rdv: false, aff: true, img: "/services/offre-basique-optimisation-image-produit.webp", summary: "Optimisation d'une image de produit (250 KMF / image).", description: "Améliorer et optimiser une image de produit pour un usage professionnel ou commercial." },
  { name: "Offre Premium — Pack Branding Marketplace", slug: "offre-premium-pack-branding-marketplace", category: "Design & Création Visuelle", price: 750, priceType: "unit", unit: "pack", cta1: "Commander le pack", cta2: "Discuter sur WhatsApp", direct: true, rdv: false, aff: true, img: "/services/offre-premium-pack-branding-marketplace.webp", summary: "Pack branding marketplace (750 KMF / pack).", description: "8 livrables + harmonisation : logo, profil, bannière, visuels produits, mini-charte." },
  { name: "Offre Pro — Création de Visuel Produit Marketing", slug: "offre-pro-creation-visuel-produit-marketing", category: "Design & Création Visuelle", price: 500, priceType: "unit", unit: "visuel", cta1: "Commander le visuel", cta2: "Discuter sur WhatsApp", direct: true, rdv: false, aff: true, img: "/services/offre-pro-creation-visuel-produit-marketing.webp", summary: "Création d'un visuel produit marketing (500 KMF / visuel).", description: "Mise en valeur du produit, composition, arrière-plan, export web." },
  { name: "Saisie de Données", slug: "saisie-de-donnees", category: "Services Administratifs", price: null, priceType: "quote", cta1: "Demander un devis", cta2: "Discuter sur WhatsApp", direct: false, rdv: true, aff: true, img: "/services/saisie-de-donnees.webp", summary: "Déléguer vos tâches de saisie et de traitement de données.", description: "Saisie, transcription, classement, mise en forme, traitement de listes." },
];

// Upsert catégories.
async function upsertCategories() {
  const map = {};
  for (const c of categories) {
    const { data } = await supabase.from("categories").upsert(
      { name: c.name, slug: c.slug, type: "service", is_active: true },
      { onConflict: "slug" },
    ).select("id, slug").maybeSingle();
    if (data?.id) map[c.slug] = data.id;
  }
  return map;
}

async function main() {
  const catMap = await upsertCategories();
  console.log(`Catégories prêtes : ${Object.keys(catMap).length}`);
  const nameToSlug = {
    "Services Digitaux": "services-digitaux",
    "Audit & Accompagnement": "audit-accompagnement",
    "Design & Création Visuelle": "design-creation-visuelle",
    "Services Administratifs": "services-administratifs",
    "Formation": "formation",
  };
  for (const s of services) {
    const priceType = s.price === null ? "quote" : (s.priceType === "unit" ? "unit" : "fixed");
    const { error } = await supabase.from("services").upsert({
      name: s.name,
      slug: s.slug,
      category_id: catMap[nameToSlug[s.category]] ?? null,
      summary: s.summary,
      description: s.description,
      image_url: s.img,
      price: s.price,
      price_type: priceType,
      price_unit: s.priceType === "unit" ? (s.unit ?? null) : null,
      cta_primary: s.cta1,
      cta_secondary: s.cta2,
      direct_purchase: s.direct,
      appointment_available: s.rdv,
      affiliate_eligible: s.aff,
      status: "active",
      is_featured: false,
    }, { onConflict: "slug" });
    if (error) {
      console.log(`ERR ${s.slug}: ${error.message}`);
    } else {
      console.log(`OK ${s.slug}`);
    }
  }
  console.log("Seed terminé.");
}
main();
