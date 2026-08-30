import { LegalPage, makeLegalMetadata } from "@/components/legal/LegalPage";

export const metadata = makeLegalMetadata(
  "Mentions légales",
  "Mentions légales de MORA Shawiri — structure numérique indépendante basée à Moroni, Union des Comores.",
);

export default function MentionsLegalesPage() {
  return (
    <LegalPage
      title="Mentions légales"
      description="Informations légales relatives au site MORA Shawiri."
      sections={[
        {
          heading: "Éditeur du site",
          body: [
            "Nom commercial : MORA Shawiri — structure numérique indépendante.",
            "Responsable de la publication : Mohamed Rachade.",
            "Adresse : Moroni, Union des Comores.",
            "Site : https://shawiri.com (domaine définitif à confirmer).",
          ],
        },
        {
          heading: "Coordonnées",
          body: [
            "Adresse professionnelle complète, téléphone, WhatsApp et email : à compléter avant la mise en production (aucune donnée inventée).",
          ],
        },
        {
          heading: "Identification juridique",
          body: [
            "Forme juridique, dénomination sociale, numéro d'immatriculation, numéro d'identification fiscale, adresse du siège et capital social : à compléter selon le statut légal réel.",
            "Aucune information juridique n'est inventée ni publiée avant vérification.",
          ],
        },
        {
          heading: "Hébergement",
          body: [
            "Hébergement applicatif, base de données, stockage, déploiement et gestion du domaine : à compléter selon l'infrastructure finale.",
          ],
        },
        {
          heading: "Propriété intellectuelle",
          body: [
            "Les contenus, éléments de l'identité visuelle (logo MORA Shawiri) et productions originales du site sont protégés. Les images et médias utilisés sont créés ou utilisés avec autorisation.",
          ],
        },
        {
          heading: "Droit applicable",
          body: [
            "Le cadre juridique applicable (statut, lieu d'établissement, nature de l'activité) doit faire l'objet d'une validation juridique avant la mise en production définitive.",
          ],
        },
      ]}
    />
  );
}
