import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * En-tête de section MORA Shawiri — hiérarchie claire :
 * sur-titre (eyebrow) → titre → description.
 * Le bloc est centré ou aligné à gauche selon `align`.
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  className,
  light = false,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  className?: string;
  light?: boolean;
}) {
  return (
    <div
      className={cn(
        "max-w-3xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow && (
        <p
          className={cn(
            "mb-3.5 inline-flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.2em]",
            light ? "text-mora-or" : "text-mora-blue-60",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "h-px w-8 rounded-full bg-gradient-to-r",
              light
                ? "from-mora-or/80 to-transparent"
                : "from-mora-blue-40/80 to-transparent",
            )}
          />
          {eyebrow}
        </p>
      )}
      <h2
        className={cn(
          "font-display text-balance tracking-tight text-2xl font-bold sm:text-3xl",
          light ? "text-white" : "text-gray-900",
        )}
      >
        {title}
      </h2>
      {description && (
        <p
          className={cn(
            "mt-3.5 max-w-2xl text-base leading-relaxed",
            align === "center" && "mx-auto",
            light ? "text-blue-100/90" : "text-gray-600",
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}
