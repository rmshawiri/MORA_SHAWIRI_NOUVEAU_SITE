import { LegalPage, makeLegalMetadata } from "@/components/legal/LegalPage";

export const metadata = makeLegalMetadata(
  "Politique de confidentialité",
  "Politique de confidentialité de MORA Shawiri concernant la collecte et le traitement des données personnelles.",
);

export default function ConfidentialitePage() {
  return (
    <LegalPage
      title="Politique de confidentialité"
      description="Comment MORA Shawiri collecte, utilise, conserve et protège vos données personnelles."
      sections={[
        {
          heading: "Responsable du traitement",
          body: [
            "Responsable : MORA Shawiri (Mohamed Rachade), à Moroni, Union des Comores. Coordonnées complètes et adresse professionnelle : à compléter avant la mise en production.",
          ],
        },
        {
          heading: "Données collectées",
          body: [
            "Nom, prénom, email, téléphone, coordonnées, informations de commande / devis / rendez-vous / compte / affiliation, historique d'interactions, préférences et données techniques de navigation.",
            "Les mots de passe ne sont jamais stockés en clair (forme sécurisée uniquement). Les informations de paiement sensibles ne sont pas conservées lorsque leur traitement est confié à un prestataire.",
          ],
        },
        {
          heading: "Finalités",
          body: [
            "Fourniture des services, traitement des commandes et devis, gestion des rendez-vous, comptes, affiliation et commissions, notifications, support, remboursements, sécurité, prévention des abus et fraude, amélioration du site et mesure d'utilisation.",
          ],
        },
        {
          heading: "Conservation et sécurité",
          body: [
            "Les données sont conservées uniquement le temps nécessaire (durées à définir dans la politique interne) et protégées (authentification, permissions, HTTPS, contrôle des accès, sauvegardes).",
          ],
        },
        {
          heading: "Vos droits",
          body: [
            "Selon le droit applicable : accès, rectification, effacement, limitation, opposition, portabilité et retrait du consentement. Les modalités d'exercice sont à publier avant la mise en production.",
            "La procédure d'exercice des droits doit être vérifiée juridiquement.",
          ],
        },
      ]}
    />
  );
}
