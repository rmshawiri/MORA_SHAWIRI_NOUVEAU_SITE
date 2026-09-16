import type { SVGProps } from 'react';

/**
 * Jeu d'icônes du site, repris trait pour trait de l'ébauche.
 *
 * Les icônes sont des SVG inline (aucune dépendance externe, aucun coût réseau).
 * Elles sont décoratives par défaut (`aria-hidden`) : le sens est toujours porté
 * par le texte adjacent.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/** Tracé « contour » : 24×24, trait courant, extrémités arrondies. */
function Stroke({ size = 24, strokeWidth = 1.8, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Tracé « plein » : 24×24, rempli par la couleur courante. */
function Solid({ size = 24, viewBox = '0 0 24 24', children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ------------------------------------------------------------ Navigation */

export const ArrowRight = (p: IconProps) => (
  <Stroke size={16} strokeWidth={2.2} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Stroke>
);

export const ArrowLeft = (p: IconProps) => (
  <Stroke size={16} strokeWidth={2.2} {...p}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </Stroke>
);

export const ArrowUp = (p: IconProps) => (
  <Stroke size={18} strokeWidth={2.2} {...p}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Stroke>
);

export const Close = (p: IconProps) => (
  <Stroke size={18} strokeWidth={2.4} {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Stroke>
);

export const Check = (p: IconProps) => (
  <Stroke size={18} strokeWidth={2.6} {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Stroke>
);

/* ---------------------------------------------------------- Pôles métier */

export const Globe = (p: IconProps) => (
  <Stroke size={26} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a15 15 0 0 1 4 9 15 15 0 0 1-4 9 15 15 0 0 1-4-9 15 15 0 0 1 4-9z" />
  </Stroke>
);

export const Cart = (p: IconProps) => (
  <Stroke size={26} {...p}>
    <circle cx="9" cy="20" r="1.4" />
    <circle cx="18" cy="20" r="1.4" />
    <path d="M2 3h2.2l2.4 12.2A2 2 0 0 0 8.6 17H19a2 2 0 0 0 2-1.6L22.5 8H6" />
  </Stroke>
);

export const Palette = (p: IconProps) => (
  <Stroke size={26} {...p}>
    <path d="M12 21a9 9 0 1 1 9-9c0 2.5-2 4-4.2 4H15a2 2 0 0 0-1.6 3.2A1.8 1.8 0 0 1 12 21z" />
    <circle cx="8" cy="10" r="1" />
    <circle cx="12" cy="7.5" r="1" />
    <circle cx="16" cy="10" r="1" />
  </Stroke>
);

export const ChartBars = (p: IconProps) => (
  <Stroke size={26} {...p}>
    <path d="M4 20h16M7 20v-6M12 20V8M17 20v-9" />
    <path d="m5 9 5-4 4 3 6-5" />
  </Stroke>
);

export const Folder = (p: IconProps) => (
  <Stroke size={26} {...p}>
    <path d="M3 7.5A2 2 0 0 1 5 5.5h3.6a2 2 0 0 1 1.6.8l1 1.4H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Stroke>
);

export const Database = (p: IconProps) => (
  <Stroke size={26} {...p}>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </Stroke>
);

export const GraduationCap = (p: IconProps) => (
  <Stroke size={26} {...p}>
    <path d="m2 8 10-4 10 4-10 4z" />
    <path d="M6 10v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" />
  </Stroke>
);

/* ------------------------------------------------------------- Engagements */

export const Shield = (p: IconProps) => (
  <Stroke size={28} {...p}>
    <path d="M12 3l7.5 3v6c0 4.4-3.1 7.9-7.5 9-4.4-1.1-7.5-4.6-7.5-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </Stroke>
);

export const Compass = (p: IconProps) => (
  <Stroke size={28} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5.2-5.2 2 2-5.2z" />
  </Stroke>
);

export const Handshake = (p: IconProps) => (
  <Stroke size={28} {...p}>
    <path d="m11 17 2 2a1 1 0 1 0 3-3" />
    <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
    <path d="m21 3 1 11h-2" />
    <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
    <path d="M3 4h8" />
  </Stroke>
);

export const Sparkles = (p: IconProps) => (
  <Stroke size={28} {...p}>
    <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" />
    <path d="M20 3v4" />
    <path d="M22 5h-4" />
    <path d="M4 17v2" />
    <path d="M5 18H3" />
  </Stroke>
);

/* ----------------------------------------------------------------- Contact */

export const Clock = (p: IconProps) => (
  <Stroke size={18} strokeWidth={2} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </Stroke>
);

export const MapPin = (p: IconProps) => (
  <Stroke size={18} strokeWidth={2} {...p}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </Stroke>
);

export const Phone = (p: IconProps) => (
  <Stroke size={18} strokeWidth={2} {...p}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7A2 2 0 0 1 22 16.9z" />
  </Stroke>
);

export const Mail = (p: IconProps) => (
  <Stroke size={18} strokeWidth={2} {...p}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-10 6L2 7" />
  </Stroke>
);

/* --------------------------------------------------------------- Formation */

export const Search = (p: IconProps) => (
  <Stroke size={28} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Stroke>
);

export const ChatBubble = (p: IconProps) => (
  <Stroke size={28} {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Stroke>
);

export const ChatLines = (p: IconProps) => (
  <Stroke size={26} {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <path d="M8 9h8M8 13h5" />
  </Stroke>
);

export const Relation = (p: IconProps) => (
  <Stroke size={26} {...p}>
    <path d="m11 17 2 2a1 1 0 1 0 3-3" />
    <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
    <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
  </Stroke>
);

export const WhatsappOutline = (p: IconProps) => (
  <Stroke size={26} {...p}>
    <path d="M20.5 3.5A11 11 0 0 0 4.2 18.1L3 22l4-1.2A11 11 0 0 0 20.5 3.5z" />
    <path d="M8.5 10.5c.6 1.6 2.4 3.4 4 4l1.3-1.3 2 .8-.4 1.6c-1 .3-2.2 0-3.5-.7a10 10 0 0 1-3.8-3.8c-.7-1.3-1-2.5-.7-3.5l1.6-.4.8 2z" />
  </Stroke>
);

export const Scale = (p: IconProps) => (
  <Stroke size={26} {...p}>
    <path d="M12 3v18" />
    <path d="M4 7h16" />
    <path d="m7 7 3 6H4z" />
    <path d="m17 7 3 6h-6z" />
  </Stroke>
);

export const TrendingUp = (p: IconProps) => (
  <Stroke size={26} {...p}>
    <path d="M3 3v18h18" />
    <path d="m7 15 4-4 3 3 5-6" />
  </Stroke>
);

export const Users = (p: IconProps) => (
  <Stroke size={26} {...p}>
    <path d="M17 20v-2a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3v2" />
    <circle cx="11" cy="8" r="4" />
    <path d="M20 20v-2a3 3 0 0 0-2-2.8" />
  </Stroke>
);

export const UsersGroup = (p: IconProps) => (
  <Stroke size={26} {...p}>
    <path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20" />
    <circle cx="9.5" cy="7.5" r="3.5" />
    <path d="M21 20v-1.5a4 4 0 0 0-3-3.8M16.5 4.2a3.5 3.5 0 0 1 0 6.6" />
  </Stroke>
);

export const Monitor = (p: IconProps) => (
  <Stroke size={26} {...p}>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Stroke>
);

export const Mobile = (p: IconProps) => (
  <Stroke size={18} strokeWidth={2} {...p}>
    <rect x="5" y="2" width="14" height="20" rx="3" />
    <path d="M10 18h4" />
  </Stroke>
);

export const CreditCard = (p: IconProps) => (
  <Stroke size={18} strokeWidth={2} {...p}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
  </Stroke>
);

/* ------------------------------------------------------------ Réseaux sociaux */

export const Whatsapp = (p: IconProps) => (
  <Solid size={22} viewBox="0 0 32 32" {...p}>
    <path d="M16 .4C7.4.4.4 7.4.4 16c0 2.8.7 5.4 2 7.7L.4 31.6l8.1-2.1c2.3 1.2 4.8 1.9 7.5 1.9 8.6 0 15.6-7 15.6-15.6S24.6.4 16 .4zm0 28.4c-2.4 0-4.7-.6-6.7-1.8l-.5-.3-4.8 1.3 1.3-4.7-.3-.5c-1.3-2-2-4.4-2-6.8C3 8.8 8.8 3 16 3s13 5.8 13 13-5.8 12.8-13 12.8zm7.1-9.6c-.4-.2-2.3-1.1-2.6-1.3-.4-.1-.6-.2-.9.2-.3.4-1 1.3-1.2 1.5-.2.2-.4.3-.8.1-.4-.2-1.6-.6-3.1-1.9-1.1-1-1.9-2.2-2.1-2.6-.2-.4 0-.6.2-.8.2-.2.4-.4.6-.7.2-.2.3-.4.4-.7.1-.3.1-.5 0-.7-.1-.2-.9-2.1-1.2-2.9-.3-.8-.6-.7-.9-.7h-.8c-.3 0-.7.1-1.1.5-.4.4-1.4 1.4-1.4 3.4s1.5 3.9 1.7 4.2c.2.3 2.9 4.5 7.1 6.3 1 .4 1.8.7 2.4.9 1 .3 1.9.3 2.6.2.8-.1 2.3-.9 2.7-1.9.3-.9.3-1.7.2-1.9-.1-.2-.4-.3-.8-.5z" />
  </Solid>
);

export const Facebook = (p: IconProps) => (
  <Solid size={18} {...p}>
    <path d="M13.5 21v-7.3h2.5l.4-2.9h-2.9V8.9c0-.8.2-1.4 1.4-1.4h1.6V4.9c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.5-4 4.2v2.3H7.6v2.9h2.5V21z" />
  </Solid>
);

export const LinkedIn = (p: IconProps) => (
  <Solid size={18} {...p}>
    <path d="M6.9 8.6H3.5V21h3.4zM5.2 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM21 13.9c0-3.2-1.7-4.7-4-4.7-1.5 0-2.4.8-2.8 1.5h-.1V9.4H10c0 1 .1 12 .1 12h3.4v-6.7c0-1.5.5-2.5 1.9-2.5s1.9 1 1.9 2.5V21H21z" />
  </Solid>
);

export const Instagram = ({ size = 18, ...p }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    aria-hidden="true"
    focusable="false"
    {...p}
  >
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="3.8" />
    <circle cx="17.2" cy="6.8" r="1" />
  </svg>
);

export const YouTube = (p: IconProps) => (
  <Solid size={18} {...p}>
    <path d="M22.5 7.6a2.8 2.8 0 0 0-2-2C18.8 5.2 12 5.2 12 5.2s-6.8 0-8.5.4a2.8 2.8 0 0 0-2 2A29 29 0 0 0 1.2 12c0 1.5.1 3 .3 4.4a2.8 2.8 0 0 0 2 2c1.7.4 8.5.4 8.5.4s6.8 0 8.5-.4a2.8 2.8 0 0 0 2-2c.2-1.4.3-2.9.3-4.4s-.1-3-.3-4.4zM9.8 15.3V8.7l5.7 3.3z" />
  </Solid>
);

export const TikTok = (p: IconProps) => (
  <Solid size={18} {...p}>
    <path d="M16.2 3h-2.9v11.6a2.4 2.4 0 1 1-2.4-2.4c.2 0 .5 0 .7.1V9.3a5.3 5.3 0 1 0 4.6 5.3V8.8a5.6 5.6 0 0 0 3.4 1.1V7a3.3 3.3 0 0 1-3.4-3z" />
  </Solid>
);

export const Telegram = (p: IconProps) => (
  <Solid size={18} {...p}>
    <path d="M21.9 4.3 18.7 19c-.2 1-.9 1.3-1.7.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.4-4.9 8.9-8c.4-.3-.1-.5-.6-.2L6.7 12.8 2.9 11.6c-1-.3-1-1 .2-1.5L20.3 3.3c.8-.3 1.5.2 1.6 1z" />
  </Solid>
);

/** Icône de réseau social résolue par identifiant (voir `site.socials`). */
export const socialIcons: Record<string, (p: IconProps) => React.ReactElement> = {
  facebook: Facebook,
  linkedin: LinkedIn,
  instagram: Instagram,
  youtube: YouTube,
  tiktok: TikTok,
  telegram: Telegram,
  whatsapp: Whatsapp,
};
