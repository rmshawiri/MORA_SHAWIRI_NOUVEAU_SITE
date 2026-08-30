import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Logo officiel MORA Shawiri.
 * Le fichier PNG fourni (512x512) contient le cercle blanc original REQUIS.
 * On l'utilise tel quel (aucun recadrage / déformation / recolorisation).
 */
export function Logo({
  className,
  priority = false,
  sizes = "48px",
}: {
  className?: string;
  priority?: boolean;
  sizes?: string;
}) {
  return (
    <Image
      src="/logo-mora-shawiri.png"
      alt="Logo MORA Shawiri"
      width={64}
      height={64}
      priority={priority}
      sizes={sizes}
      className={cn("h-auto w-auto select-none", className)}
    />
  );
}
