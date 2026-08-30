import { LegalPage, makeLegalMetadata } from "@/components/legal/LegalPage";

export const metadata = makeLegalMetadata(
  "Conditions générales d'utilisation",
  "Conditions générales d'utilisation du site MORA Shawiri.",
);

export default function CguPage() {
  return (
    <LegalPage
      title="Conditions générales d'utilisation"
      description="Règles d'accès et d'utilisation du site MORA Shawiri."
      sections={[
        {
          heading: "Objet et acceptation",
          body: [
            "L'utilisation du site implique la prise de connaissance et l'acceptation des présentes conditions, sous réserve des règles impératives applicables.",
          ],
        },
        {
          heading: "Comptes et identifiants",
          body: [
            "Chaque utilisateur est responsable de la confidentialité de ses identifiants. Les comptes administrateurs ne sont pas partagés. Tout usage frauduleux (accès non autorisé, usurpation, manipulation de commandes ou commissions) est interdit.",
          ],
        },
        {
          heading: "Services et produits",
          body: [
            "Les demandes de devis et les commandes sont soumises aux conditions générales de vente. Une demande de devis ne constitue pas une commande définitive.",
          ],
        },
        {
          heading: "Usage du site",
          body: [
            "Sont interdits : accès non autorisé, contournement de sécurité, malveillance, spam, faux comptes, extraction massive, activité illégale ou contraire aux présentes conditions.",
          ],
        },
        {
          heading: "Responsabilités et droit applicable",
          body: [
            "MORA Shawiri s'efforce d'assurer un service de qualité mais ne peut garantir une disponibilité ininterrompue (maintenance, pannes, services tiers).",
            "Le cadre juridique applicable doit être validé juridiquement avant la mise en production définitive.",
          ],
        },
      ]}
    />
  );
}
