import { LegalPage, makeLegalMetadata } from "@/components/legal/LegalPage";

export const metadata = makeLegalMetadata(
  "Politique de remboursement",
  "Politique de remboursement de MORA Shawiri : conditions, procédure et cas particuliers.",
);

export default function RemboursementPage() {
  return (
    <LegalPage
      title="Politique de remboursement"
      description="Conditions et procédure de demande de remboursement des services et produits MORA Shawiri."
      sections={[
        {
          heading: "Principe général",
          body: [
            "Toute demande de remboursement est examinée individuellement, de manière équitable et transparente, conformément aux conditions de la commande, aux engagements contractuels et au droit applicable.",
          ],
        },
        {
          heading: "Situations pouvant ouvrir droit à remboursement",
          body: [
            "Commande payée mais non exécutable, annulée conformément aux conditions, paiement en double, facturation à tort, non-livraison due, problème significatif de conformité, ou autre situation donnant légalement droit à un remboursement.",
          ],
        },
        {
          heading: "Produits numériques",
          body: [
            "Les conditions dépendent de la nature du produit, de l'accès utilisé, du téléchargement et des conditions affichées avant l'achat. Un produit non reçu ou un lien invalide fait l'objet d'une correction (nouveau lien / envoi).",
          ],
        },
        {
          heading: "Prestations sur mesure et services",
          body: [
            "Pour les prestations sur mesure, les conditions (périmètre, livrables, prix, délai, révisions et conditions d'annulation) sont celles précisées dans le devis/contrat.",
            "L'état d'avancement de la prestation est pris en compte.",
          ],
        },
        {
          heading: "Modalités",
          body: [
            "Le remboursement est effectué par le même moyen de paiement lorsque techniquement possible. Un avoir peut être proposé, sans remplacer un remboursement légalement obligatoire. Les frais de transaction sont appréciés selon les causes.",
          ],
        },
        {
          heading: "Procédure de demande",
          body: [
            "Pour demander un remboursement, fournissez : nom, email, numéro de commande, produit/service concerné, date d'achat, montant, motif et justificatifs. L'identité est vérifiée sans jamais demander votre mot de passe ni des données bancaires sensibles.",
          ],
        },
      ]}
    />
  );
}
