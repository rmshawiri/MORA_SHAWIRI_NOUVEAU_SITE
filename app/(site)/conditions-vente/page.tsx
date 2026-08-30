import { LegalPage, makeLegalMetadata } from "@/components/legal/LegalPage";

export const metadata = makeLegalMetadata(
  "Conditions générales de vente",
  "Conditions générales de vente des services et produits MORA Shawiri.",
);

export default function CgvPage() {
  return (
    <LegalPage
      title="Conditions générales de vente"
      description="Conditions de vente des produits et services MORA Shawiri."
      sections={[
        {
          heading: "Offres et prix",
          body: [
            "Les prix affichés au moment de la commande s'appliquent, sous réserve d'erreur manifeste. Devise : KMF (à confirmer officiellement). Les promotions et codes promotionnels sont soumis à leurs conditions.",
            "Les services sur devis sont validés avant toute commande ; un devis n'est une commande qu'après acceptation.",
          ],
        },
        {
          heading: "Commande et paiement",
          body: [
            "Une commande est confirmée après récapitulatif et validation. Le paiement est effectué selon les moyens proposés (Mvola, Holo, Wakati, virement, paiement en ligne).",
            "La déclaration de paiement d'un client est vérifiée avant confirmation. Un paiement n'est considéré comme confirmé qu'après vérification.",
          ],
        },
        {
          heading: "Exécution et livraison numérique",
          body: [
            "Les services numériques et livrables sont fournis selon les modalités prévues. Les produits numériques (ebooks, templates, documents) sont accessibles après paiement via un accès protégé.",
            "L'achat d'un produit numérique n'engendre pas un transfert de propriété intellectuelle ; toute revente ou redistribution non autorisée est interdite.",
          ],
        },
        {
          heading: "Réclamations et garanties",
          body: [
            "Les réclamations sont examinées et traitées selon les conditions de la commande et le droit applicable. Lorsque des garanties légales sont applicables, elles s'appliquent conformément au droit compétent.",
          ],
        },
        {
          heading: "Droit applicable",
          body: [
            "Le cadre juridique (statut, lieu d'établissement, lieu du client, nature du service) doit être validé juridiquement avant la mise en production définitive.",
          ],
        },
      ]}
    />
  );
}
