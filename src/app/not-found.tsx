import Link from 'next/link';
import PageHero from '@/components/sections/PageHero';
import { ArrowRight } from '@/components/ui/Icon';
import { mainNav } from '@/lib/site';

export const metadata = {
  title: 'Page introuvable',
  description: 'La page demandée n’existe pas ou a été déplacée.',
  robots: { index: false, follow: true },
};

/** Page 404 : garde la charte du site et propose des chemins de sortie. */
export default function NotFound() {
  return (
    <>
      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Page introuvable' }]}
        eyebrow="Erreur 404"
        title="Cette page n’existe pas (ou plus)"
        lead="Le lien est peut-être obsolète, ou l’adresse comporte une erreur. Voici par où continuer."
      />

      <section className="section">
        <div className="container container--narrow">
          <ul className="pill-row" style={{ justifyContent: 'center' }}>
            {mainNav.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
          <div className="btn-row" style={{ marginTop: 40, justifyContent: 'center' }}>
            <Link className="btn btn--primary btn--lg" href="/">
              Revenir à l’accueil <ArrowRight />
            </Link>
            <Link className="btn btn--ghost btn--lg" href="/contact/">
              Nous signaler le problème
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
