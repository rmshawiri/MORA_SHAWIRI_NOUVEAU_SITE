import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";

/**
 * Pilule de statut unifiée MORA Shawiri.
 * Mapping des libellés techniques (base) vers des libellés et des tons lisibles.
 * Aucune donnée n'est inventée : libellés français explicites, couleurs d'état.
 */

const LABELS: Record<string, string> = {
  // Commandes / paiements
  pending: "En attente",
  processing: "En traitement",
  paid: "Payé",
  completed: "Terminé",
  refunded: "Remboursé",
  cancelled: "Annulé",
  // Commissions
  validated: "Validée",
  payable: "Payable",
  // Produits / services
  draft: "Brouillon",
  published: "Publié",
  available: "Disponible",
  unavailable: "Indisponible",
  archived: "Archivé",
  // Affiliés
  active: "Actif",
  inactive: "Inactif",
};

const TONES: Record<string, "success" | "warning" | "error" | "info" | "neutral"> = {
  pending: "warning",
  processing: "info",
  paid: "success",
  completed: "success",
  refunded: "warning",
  cancelled: "error",
  validated: "success",
  payable: "info",
  draft: "neutral",
  published: "success",
  available: "success",
  unavailable: "warning",
  archived: "neutral",
  active: "success",
  inactive: "neutral",
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const label = LABELS[status] ?? status;
  const tone = TONES[status] ?? "neutral";
  const successish = tone === "success";
  return (
    <Badge tone={tone} dot={successish} className={cn("whitespace-nowrap", className)}>
      {label}
    </Badge>
  );
}
