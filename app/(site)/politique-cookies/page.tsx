import { LegalPage, makeLegalMetadata } from "@/components/legal/LegalPage";

export const metadata = makeLegalMetadata(
  "Politique des cookies",
  "Politique des cookies de MORA Shawiri : catégories, finalités, gestion et consentement.",
);

export default function CookiesPage() {
  return (
    <LegalPage
      title="Politique des cookies"
      description="Comment MORA Shawiri utilise les cookies et technologies similaires."
      sections={[
        {
          heading: "Catégories de cookies",
          body: [
            "1. Strictement nécessaires : authentification, session, sécurité et fonctionnement technique.",
            "2. Préférences : mémorisation de vos préférences.",
            "3. Statistiques : mesure d'utilisation (outil d'analyse, ex. Google Analytics, à confirmer avant production).",
            "4. Marketing : mesure de campagnes et personnalisation (sous réserve d'exigences de consentement applicables).",
            "5. Technologies similaires (pixels, tags, scripts).",
          ],
        },
        {
          heading: "Gestion et consentement",
          body: [
            "Vous pouvez gérer l'acceptation, le refus et la personnalisation des cookies via un bandeau clair (« Gérer mes cookies ») depuis le pied de page, les paramètres ou le centre de confidentialité.",
            "Le refus ne bloque pas les fonctionnalités essentielles. Le retrait du consentement est possible lorsque techniquement applicable.",
          ],
        },
        {
          heading: "Sécurité",
          body: [
            "Les cookies de session utilisent les attributs de sécurité appropriés (Secure, HttpOnly, SameSite) lorsque techniquement applicable. Le site fonctionne exclusivement en HTTPS en production.",
          ],
        },
        {
          heading: "Registre des cookies",
          body: [
            "Un registre détaillé (nom, fournisseur, finalité, catégorie, durée, domaine, consentement requis) doit être maintenu et vérifié avant la mise en production.",
          ],
        },
      ]}
    />
  );
}
