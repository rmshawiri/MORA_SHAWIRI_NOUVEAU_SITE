/**
 * Injecte un graphe de données structurées schema.org.
 *
 * Le contenu provient exclusivement de données internes typées (jamais d'une
 * saisie utilisateur) : la sérialisation JSON est donc sûre. Les séquences
 * `<` sont échappées par précaution pour ne pas pouvoir clore le script.
 */
export default function JsonLd({ data }: { data: object }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
  );
}
