import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * État vide professionnel MORA Shawiri — évite tout écran blanc "cassé".
 * À utiliser avec un libellé clair, un contexte et une action optionnelle.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center shadow-soft",
        className,
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-mora-blue-10/60 to-transparent" />
      {icon && (
        <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-mora-blue-10 text-mora-blue ring-1 ring-mora-blue-20">
          {icon}
        </div>
      )}
      <p className="relative font-display text-lg font-bold text-gray-900">{title}</p>
      {description && <p className="relative mt-2 max-w-md text-sm leading-relaxed text-gray-500">{description}</p>}
      {action && <div className="relative mt-6">{action}</div>}
    </div>
  );
}
