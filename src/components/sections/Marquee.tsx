/**
 * Bandeau de valeurs défilant.
 *
 * Le défilement infini repose sur une translation de −50 % : le contenu est donc
 * rendu deux fois. Contrairement à l'ébauche qui dupliquait les nœuds en
 * JavaScript, la duplication est faite au rendu — aucun script n'est nécessaire.
 */
export default function Marquee({ items }: { items: readonly string[] }) {
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee__track">
        {[...items, ...items].map((item, index) => (
          <span key={`${item}-${index}`}>{item}</span>
        ))}
      </div>
    </div>
  );
}
