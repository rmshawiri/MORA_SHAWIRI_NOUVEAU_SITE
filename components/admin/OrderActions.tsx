"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOrderStatus } from "@/app/actions/admin";

const ACTIONS = [
  { label: "Marquer payée", status: "paid", payment_status: "paid" },
  { label: "En traitement", status: "processing" },
  { label: "Terminée", status: "completed" },
  { label: "Rembourser", status: "refunded", payment_status: "refunded" },
  { label: "Annuler", status: "cancelled" },
];

export function OrderActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function apply(a: { status: string; payment_status?: string }) {
    if (a.status === "cancelled" && !confirm("Annuler cette commande ? Les commissions liées seront annulées.")) return;
    startTransition(async () => {
      await updateOrderStatus(id, a);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {ACTIONS.map((a) => (
        <button
          key={a.label}
          onClick={() => apply(a)}
          disabled={pending || status === a.status}
          className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-mora-blue hover:text-mora-blue disabled:cursor-not-allowed disabled:opacity-50"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
