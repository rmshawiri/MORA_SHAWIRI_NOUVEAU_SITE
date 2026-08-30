import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * En-tête de page d'administration MORA Shawiri.
 * Fournit un titre, un sous-titre et des actions optionnelles, dans un conteneur cohérent.
 */
export function AdminPage({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("p-5 sm:p-8", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          {icon && (
            <span
              aria-hidden
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-mora-blue-10 font-display text-2xl text-mora-blue ring-1 ring-mora-blue-20"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
            {subtitle && (
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-500">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-6">{children}</div>
    </div>
  );
}

/** Carte blanche standard de l'administration. */
export function AdminPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-gray-100 bg-white shadow-soft", className)}>
      {children}
    </div>
  );
}
