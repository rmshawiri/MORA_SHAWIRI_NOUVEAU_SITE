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
import {
  commitments,
  homeFaq,
  marqueeItems,
  method,
  serviceHighlights,
  whyPoints,
} from '@/content/home';
import { featuredOffers } from '@/content/offers';
import { faqSchema, jsonLdGraph, pageMetadata } from '@/lib/seo';
import { site } from '@/lib/site';

export const metadata = pageMetadata({
  title: 'MORA Shawiri — Agence digitale aux Comores | Sites web, branding & formations',
  description: site.description,
  path: '/',
});

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

export default function HomePage() {
  return (
    <>
      <JsonLd data={jsonLdGraph([faqSchema(homeFaq)])} />

      <Hero
        eyebrow="Agence digitale — Moroni, Union des Comores"
        title={
          <>
            Le Choix Optimal pour votre <span className="hl-gold">Performance</span>
          </>
        }
        lead="Sites web, boutiques en ligne, identité visuelle, organisation des données et formations : MORA Shawiri conçoit les outils numériques qui rendent votre organisation visible, crédible et efficace."
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

      <Marquee items={marqueeItems} />

      <section className="section" aria-labelledby="services-title">
        <div className="container">
          <SectionHead
            eyebrow="Nos expertises"
            title="Des solutions digitales qui font grandir votre organisation"
            titleId="services-title"
            lead="Un seul partenaire pour concevoir, lancer et faire performer votre présence numérique — du premier logo à la formation de vos équipes."
            center
          />
          <div className="grid grid--3 reveal-group">
            {serviceHighlights.map((service) => {
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
                items={whyPoints.map((point) => (
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
            eyebrow="Nos engagements"
            title="Ce que vous obtenez en travaillant avec nous"
            titleId="preuves-title"
            lead="Pas de promesses chiffrées invérifiables : des engagements de méthode, tenus sur chaque projet."
            center
            onBrand
          />
          <div className="proof-grid reveal-group">
            {commitments.map((item) => {
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
          <SectionHead
            eyebrow="Notre méthode"
            title="Du premier échange aux premiers résultats"
            titleId="methode-title"
            center
          />
          <Steps items={method} />
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="boutique-title">
        <div className="container">
          <SectionHead
            eyebrow="Boutique"
            title="Nos offres les plus demandées"
            titleId="boutique-title"
            lead="Quatorze prestations prêtes à démarrer, de la création de logo au développement d’applications. Les prix définis sont affichés ; les projets sur mesure sont chiffrés selon votre besoin réel."
          />
          <div className="grid grid--3 reveal-group">
            {featuredOffers.map((offer) => (
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
        title="Ils nous font confiance pour leur croissance"
        titleId="temoignages-title"
      />

      <section className="section section--alt" aria-labelledby="faq-title">
        <div className="container">
          <SectionHead
            eyebrow="Questions fréquentes"
            title="Vos questions, nos réponses directes"
            titleId="faq-title"
            center
          />
          <Faq items={homeFaq} />
        </div>
      </section>

      <CtaBand
        title="Prêt à passer au niveau supérieur ?"
        text="Décrivez-nous votre projet : vous recevez un diagnostic et un devis gratuit sous 48 h."
        primaryLabel="Demander un devis gratuit"
        whatsappMessage="Bonjour MORA Shawiri, je souhaite un devis pour mon projet digital."
      />
    </>
  );
}
