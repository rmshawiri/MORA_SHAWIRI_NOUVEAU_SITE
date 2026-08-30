import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

const base =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-full transition-all duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-55 disabled:pointer-events-none disabled:shadow-none select-none active:scale-[0.98]";

const variants = {
  /** Accent premium principal — Or Shawiri (texte sombre pour le contraste). */
  primary:
    "bg-mora-or text-mora-blue shadow-[0_4px_16px_rgba(217,180,0,0.32)] hover:shadow-gold hover:-translate-y-0.5 focus-visible:outline-mora-blue",
  /** Bouton institutionnel — Bleu MORA, texte blanc. */
  blue: "bg-mora-blue text-white shadow-soft hover:bg-mora-blue-70 hover:shadow-lift hover:-translate-y-0.5 focus-visible:outline-mora-blue",
  /** Secondaire : blanc bordé. */
  secondary:
    "border border-gray-300 bg-white text-gray-800 hover:border-mora-blue hover:text-mora-blue hover:shadow-soft focus-visible:outline-mora-blue",
  /** Outline bleu — CTA de poids modéré. */
  outline:
    "border border-mora-blue/70 bg-transparent text-mora-blue hover:bg-mora-blue-20 focus-visible:outline-mora-blue",
  /** Ghost : sans fond, utile pour les liens de navigation / actions secondaires. */
  ghost:
    "text-mora-blue hover:bg-mora-blue-20 focus-visible:outline-mora-blue",
  /** Subtile : fond bleu très clair. */
  subtle:
    "bg-mora-blue-20 text-mora-blue hover:bg-mora-blue-20/70 focus-visible:outline-mora-blue",
  /** WhatsApp (identité service, sans devenir dominant). */
  whatsapp:
    "bg-[#25D366] text-white shadow-soft hover:brightness-95 hover:-translate-y-0.5 focus-visible:outline-[#128C7E]",
  /** Danger — actions destructrices. */
  danger: "bg-error text-white hover:brightness-95 hover:-translate-y-0.5 focus-visible:outline-error",
} as const;

const sizes = {
  sm: "h-10 px-4 text-sm",
  md: "h-12 px-6 text-base",
  lg: "h-14 px-8 text-lg",
  xl: "h-16 px-9 text-lg",
} as const;

type Variant = keyof typeof variants;
type Size = keyof typeof sizes;

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
};

type ButtonAsButton = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type ButtonAsLink = CommonProps & { href: string; target?: string; rel?: string };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button(props: ButtonProps) {
  const { variant = "primary", size = "md", className, children } = props;
  const classes = cn(base, variants[variant], sizes[size], className);

  if ("href" in props && props.href) {
    const { href, target, rel } = props;
    return (
      <Link href={href} className={classes} target={target} rel={rel}>
        {children}
      </Link>
    );
  }

  // Bouton natif : retirer les propriétés que l'on gère nous-mêmes.
  const buttonProps = { ...props } as Record<string, unknown>;
  delete buttonProps.variant;
  delete buttonProps.size;
  delete buttonProps.className;
  delete buttonProps.children;
  return (
    <button className={classes} {...buttonProps}>
      {children}
    </button>
  );
}
