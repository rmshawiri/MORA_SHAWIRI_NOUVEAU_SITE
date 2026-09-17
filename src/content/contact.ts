/**
 * Options du formulaire de demande.
 *
 * La liste des besoins couvre les quatorze services du catalogue officiel
 * (`02_SERVICES.md` § 66) afin qu'une offre consultée en Boutique puisse être
 * transmise au formulaire sans que le visiteur ait à la resaisir
 * (`03_COMPOSANTS.md` § 126, `04_PARCOURS_UTILISATEUR.md` § 104).
 */

export type SelectOption = { value: string; label: string };

export const CONTACT_SUBJECTS: readonly SelectOption[] = [
  { value: 'Site vitrine', label: 'Site vitrine professionnel' },
  { value: 'Boutique e-commerce', label: 'Boutique en ligne' },
  { value: 'Application mobile', label: 'Application mobile' },
  { value: 'Logiciel / SaaS', label: 'Logiciel ou SaaS' },
  { value: 'Identité visuelle / logo', label: 'Identité visuelle ou logo' },
  { value: 'Visuels produits', label: 'Visuels produits / marketplace' },
  { value: 'Templates et supports', label: 'Templates et supports' },
  { value: 'Marketing digital et SEO', label: 'Marketing digital et référencement' },
  { value: 'Gestion documentaire / données', label: 'Gestion documentaire ou saisie de données' },
  { value: 'Audit stratégique', label: 'Audit stratégique' },
  { value: 'Assistance et accompagnement', label: 'Assistance et accompagnement' },
  { value: 'Formation', label: 'Formation professionnelle' },
  { value: 'Programme d’affiliation', label: 'Programme d’affiliation' },
  { value: 'Autre demande', label: 'Autre demande' },
] as const;

export const CONTACT_BUDGETS: readonly SelectOption[] = [
  { value: '', label: 'À définir ensemble' },
  { value: 'moins de 200 000 KMF', label: 'Moins de 200 000 KMF' },
  { value: '200 000 à 500 000 KMF', label: '200 000 à 500 000 KMF' },
  { value: '500 000 à 1 500 000 KMF', label: '500 000 à 1 500 000 KMF' },
  { value: 'plus de 1 500 000 KMF', label: 'Plus de 1 500 000 KMF' },
] as const;
