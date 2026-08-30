import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Badge MORA Shawiri — pilule compacte pour catégories, statuts, états.
 * Les couleurs restent dans l'identité (bleu / or / vert / neutres + états).
 */
type Tone = "blue" | "green" | "gold" | "neutral" | "success" | "warning" | "error" | "info";

const tones: Record<Tone, string> = {
  blue: "bg-mora-blue-20 text-mora-blue ring-mora-blue-20",
  green: "bg-mora-green-soft text-mora-green ring-mora-green-soft",
  gold: "bg-mora-or-soft text-mora-or-deep ring-mora-or-soft",
  neutral: "bg-gray-100 text-gray-700 ring-gray-200",
  success: "bg-success-soft text-success ring-success-soft",
  warning: "bg-warning-soft text-warning ring-warning-soft",
  error: "bg-error-soft text-error ring-error-soft",
  info: "bg-info-soft text-info ring-info-soft",
};

export function Badge({
  children,
  tone = "neutral",
  className,
  dot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  const isGreenish = tone === "success" || tone === "green";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition-colors",
        tones[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            isGreenish ? "bg-current animate-pulse-dot" : "bg-current",
          )}
        />
      )}
      {children}
    </span>
  );
}
