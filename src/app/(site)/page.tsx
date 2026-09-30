import Image from 'next/image';
import Link from 'next/link';
import CheckList from '@/components/sections/CheckList';
import CtaBand from '@/components/sections/CtaBand';
import Faq from '@/components/sections/Faq';
import Hero from '@/components/sections/Hero';
import Marquee from '@/components/sections/Marquee';
import OfferCard from '@/components/sections/OfferCard';
import SectionHead from '@/components/sections/SectionHead';
import Steps from '@/components/sections/Steps';
import Testimonials from '@/components/sections/Testimonials';
import JsonLd from '@/components/seo/JsonLd';
import {
  ArrowRight,
  Cart,
  ChartBars,
  Check,
  Clock,
  Compass,
  Folder,
  Globe,
  GraduationCap,
  Handshake,
  Palette,
  Shield,
  Sparkles,
} from '@/components/ui/Icon';
import { getPublicCatalogue } from '@/lib/catalogue/public';
import { getPublicFaq } from '@/lib/contenus/faq';
import { getContenus } from '@/lib/contenus/public';
import { renderTitre } from '@/lib/contenus/titre';
import { faqSchema, jsonLdGraph, pageMetadata } from '@/lib/seo';
import { site } from '@/lib/site';

/**
 * Les trois offres mises en avant viennent de la base depuis la phase 4E.
 * Même raisonnement que pour la Boutique : lecture sans cookie, donc page
 * toujours pré-rendue, régénérée toutes les cinq minutes.
 */
// Next.js exige ici un littéral : la valeur est lue par analyse statique, pas
// à l'exécution, et une constante importée est refusée au build. Elle doit
// donc rester égale à CATALOGUE_REVALIDATE_SECONDS — ce que le test
// `catalogue-revalidation` vérifie, pour que la duplication ne dérive pas.
export const revalidate = 300;

const TITRE_ACCUEIL = 'MORA Shawiri — Agence digitale aux Comores | Sites web, branding & formations';

export const metadata = {
  ...pageMetadata({
    title: TITRE_ACCUEIL,
    description: site.description,
    path: '/',
  }),
  /**
   * Titre **absolu** : le gabarit `'%s | MORA Shawiri'` ne s'y applique pas.
   *
   * Tant que la page d'accueil était `src/app/page.tsx`, elle appartenait au
   * segment racine — celui-là même qui déclare le gabarit — et Next.js ne
   * l'appliquait donc pas. Depuis qu'elle vit dans le groupe `(site)`, elle
   * est un segment enfant, et le titre gagnerait un « | MORA Shawiri »
   * surnuméraire : le nom de la marque y figure déjà deux fois.
   *
   * `absolute` rétablit exactement le titre servi auparavant. La comparaison
   * avant/après des routes publiques le vérifie caractère par caractère.
   */
  title: { absolute: TITRE_ACCUEIL },
};

const serviceIcons = {
  globe: Globe,
  cart: Cart,
  palette: Palette,
  chart: ChartBars,
  folder: Folder,
  graduation: GraduationCap,
} as const;

const commitmentIcons = {
  shield: Shield,
  compass: Compass,
  handshake: Handshake,
  sparkles: Sparkles,
} as const;

export default async function HomePage() {
  // Deux lectures, en parallèle : le catalogue (4E-1) et les contenus (4E-2).
  // Les enchaîner doublerait la latence de la page pour aucune raison — elles
  // ne dépendent pas l'une de l'autre.
  const [{ featured }, contenus, faq] = await Promise.all([
    getPublicCatalogue(),
    getContenus(),
    getPublicFaq(),
  ]);

  const hero = contenus.texte('accueil.hero');
  const expertises = contenus.liste('accueil.liste-expertises');
  const engagements = contenus.liste('accueil.liste-engagements');
  const etapes = contenus.liste('accueil.liste-methode');
  const bandeau = contenus.liste('accueil.liste-bandeau');
  const pourquoi = contenus.liste('accueil.liste-pourquoi');
  const avis = contenus.liste('transversal.temoignages');

  return (
    <>
      <JsonLd data={jsonLdGraph([faqSchema(faq.accueil)])} />

      <Hero
        eyebrow={hero.eyebrow}
        title={renderTitre(hero.title)}
        lead={hero.lead}
        actions={
          <>
            <Link className="btn btn--gold btn--lg" href="/contact/">
              Demander un devis gratuit <ArrowRight />
            </Link>
            <Link className="btn btn--light btn--lg" href="/services/">
              Découvrir nos services
            </Link>
          </>
        }
        proof={[
          'Première réponse sous 24 h',
          'Sur place à Moroni et à distance',
          'Devis gratuit, sans engagement',
        ]}
        media={
          <>
            <div className="hero__card">
              <Image
                src="/images/hero-accueil.webp"
                alt="Consultant MORA Shawiri au travail dans les bureaux de l’agence à Moroni"
                width={1536}
                height={1024}
                priority
                sizes="(max-width: 1024px) 100vw, 45vw"
              />
            </div>
            <div className="hero__float hero__float--a">
              <Clock strokeWidth={2} />
              <span>
                <strong>Devis sous 48&nbsp;h</strong>
                <span>Périmètre et budget détaillés</span>
              </span>
            </div>
            <div className="hero__float hero__float--b">
              <Check />
              <span>
                <strong>Formation incluse</strong>
                <span>Vous restez autonome</span>
              </span>
            </div>
          </>
        }
      />

      <Marquee items={bandeau} />

      <section className="section" aria-labelledby="services-title">
        <div className="container">
          <SectionHead {...contenus.texte('accueil.expertises')} titleId="services-title" center />
          <div className="grid grid--3 reveal-group">
            {expertises.map((service) => {
              const ServiceIcon = serviceIcons[service.icon];
              return (
                <article className="card card--accent" key={service.id}>
                  <div className="card__icon">
                    <ServiceIcon />
                  </div>
                  <h3>{service.title}</h3>
                  <p>{service.text}</p>
                  <Link className="arrow-link" href={service.href}>
                    En savoir plus <ArrowRight />
                  </Link>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="pourquoi-title">
        <div className="container">
          <div className="split">
            <div className="split__body reveal">
              <p className="eyebrow">Pourquoi MORA Shawiri</p>
              <h2 id="pourquoi-title">
                Un partenaire qui comprend votre réalité, pas un simple prestataire
              </h2>
              <p className="lead">
                Basés à Moroni, nous connaissons le contexte comorien : vos contraintes, vos clients,
                vos opportunités. Nous y appliquons les standards des meilleures agences
                internationales.
              </p>
              <CheckList
                items={pourquoi.map((point) => (
                  <span key={point.strong}>
                    <strong>{point.strong}</strong> {point.text}
                  </span>
                ))}
              />
              <div className="btn-row" style={{ marginTop: 32 }}>
                <Link className="btn btn--primary" href="/qui-sommes-nous/">
                  Découvrir notre approche <ArrowRight />
                </Link>
              </div>
            </div>
            <div className="split__media reveal">
              <figure className="portrait-panel">
                <Image
                  src="/images/section-pourquoi.webp"
                  alt="Consultante MORA Shawiri, prête à accompagner votre organisation"
                  width={1023}
                  height={1537}
                  sizes="(max-width: 767px) 100vw, 45vw"
                  loading="lazy"
                />
              </figure>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--brand" aria-labelledby="preuves-title">
        <div className="container">
          <SectionHead
            {...contenus.texte('accueil.engagements')}
            titleId="preuves-title"
            center
            onBrand
          />
          <div className="proof-grid reveal-group">
            {engagements.map((item) => {
              const CommitmentIcon = commitmentIcons[item.icon];
              return (
                <article className="proof" key={item.title}>
                  <CommitmentIcon />
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="methode-title">
        <div className="container">
          <SectionHead {...contenus.texte('accueil.methode')} titleId="methode-title" center />
          <Steps items={etapes} />
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="boutique-title">
        <div className="container">
          <SectionHead {...contenus.texte('accueil.boutique')} titleId="boutique-title" />
          <div className="grid grid--3 reveal-group">
            {featured.map((offer) => (
              <OfferCard key={offer.id} offer={offer} variant="compact" />
            ))}
          </div>
          <div className="btn-row" style={{ marginTop: 40, justifyContent: 'center' }}>
            <Link className="btn btn--primary btn--lg" href="/boutique/">
              Voir les 14 prestations <ArrowRight />
            </Link>
          </div>
        </div>
      </section>

      <Testimonials
        {...contenus.texte('accueil.temoignages')}
        titleId="temoignages-title"
        items={avis}
      />

      <section className="section section--alt" aria-labelledby="faq-title">
        <div className="container">
          <SectionHead {...contenus.texte('accueil.faq')} titleId="faq-title" center />
          <Faq items={faq.accueil} />
        </div>
      </section>

      <CtaBand {...contenus.texte('accueil.cta')} />
    </>
  );
}
