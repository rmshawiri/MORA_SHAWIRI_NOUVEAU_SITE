/**
 * FAQ MORA Shawiri — questions fréquentes réelles (source : 02_CONTENUS/05_FAQ.md).
 * Aucune invention : les réponses reprennent les informations officielles
 * (tarifs, coordonnées, fonctionnement des parcours).
 */

export interface Faq {
  question: string;
  answer: string;
  category:
    | "Général"
    | "Services"
    | "Commandes"
    | "Devis"
    | "Rendez-vous"
    | "Formation"
    | "Boutique"
    | "Affiliation"
    | "Contact";
}

export const faqs: Faq[] = [
  {
    category: "Général",
    question: "Qu'est-ce que MORA Shawiri ?",
    answer:
      "MORA Shawiri est une structure digitale indépendante basée à Moroni, Union des Comores, proposant des services numériques, administratifs, de design, des templates professionnels et des formations.",
  },
  {
    category: "Services",
    question: "Quels services sont à prix fixe ?",
    answer:
      "Audit Stratégique Global (30 000 KMF), Création de Logo (15 000 KMF), Formation — Maîtriser la Prospection et la Relation Client (5 000 KMF), Offre Basique (250 KMF / image), Offre Pro (500 KMF / visuel) et Offre Premium (750 KMF / pack). Les autres services sont proposés sur devis.",
  },
  {
    category: "Devis",
    question: "Comment fonctionne le formulaire de demande de devis ?",
    answer:
      "Le devis est demandé via un parcours conversationnel étape par étape, avec des questions adaptées au service concerné, un champ « Informations complémentaires / Message » et un récapitulatif avant l'envoi. Le prix dépend de votre projet et de son périmètre.",
  },
  {
    category: "Boutique",
    question: "Avez-vous des produits disponibles ?",
    answer:
      "Les produits ne sont pas encore disponibles au lancement. MORA Shawiri prépare progressivement de nouvelles ressources et offres qui pourront être ajoutées à la boutique. Nos services sont disponibles dès maintenant.",
  },
  {
    category: "Rendez-vous",
    question: "Puis-je prendre rendez-vous avec MORA Shawiri ?",
    answer:
      "Oui. Certains services permettent de prendre rendez-vous via un parcours de réservation qui affiche les créneaux réellement disponibles. Le créneau est confirmé et le client reçoit une confirmation.",
  },
  {
    category: "Formation",
    question: "Comment fonctionne la formation ?",
    answer:
      "La formation « Maîtriser la Prospection et la Relation Client » est proposée à 5 000 KMF, en deux formats : en ligne et présentiel. Le prix est identique pour les deux formats. Le format en ligne donne accès à la formation après validation de l'inscription et du paiement.",
  },
  {
    category: "Contact",
    question: "Comment contacter MORA Shawiri ?",
    answer:
      "Vous pouvez nous contacter via WhatsApp au +269 430 63 06 ou par email à contact@morashawiri.com. Le site permet aussi de demander un devis, de présenter un projet ou de prendre rendez-vous.",
  },
  {
    category: "Affiliation",
    question: "Puis-je devenir affilié ?",
    answer:
      "Oui. Le programme d'affiliation permet de recommander les services et produits MORA Shawiri. Après inscription et validation, vous obtenez un lien affilié personnel. Les commissions sont calculées selon les règles du programme.",
  },
  {
    category: "Services",
    question: "Quels services sont proposés sur devis ?",
    answer:
      "Les prestations nécessitant une analyse sont proposées sur devis, par exemple l'accompagnement digital, la conception de template, la création d'applications mobiles, de SaaS, de sites e-commerce ou vitrines, la gestion documentaire et la saisie de données. Le prix dépend du projet ; présentez-nous votre besoin via le formulaire.",
  },
];

export const faqCategories = Array.from(new Set(faqs.map((f) => f.category)));
