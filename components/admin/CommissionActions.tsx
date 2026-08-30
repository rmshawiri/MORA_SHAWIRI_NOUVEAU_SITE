"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCommissionStatus } from "@/app/actions/admin";

const FLOW = [
  { value: "pending", label: "En attente" },
  { value: "validated", label: "Validée" },
  { value: "payable", label: "Payable" },
  { value: "paid", label: "Payée" },
];

export function CommissionActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setStatus(value: string) {
    startTransition(async () => {
      await updateCommissionStatus(id, value);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {FLOW.map((f) => (
        <button
          key={f.value}
          onClick={() => setStatus(f.value)}
          disabled={pending || f.value === status}
          className={
            f.value === status
              ? "rounded-full bg-mora-blue px-3 py-1 text-xs font-semibold text-white"
              : "rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:border-mora-blue hover:text-mora-blue disabled:opacity-50"
          }
        >
          {f.label}
        </button>
      ))}
      {status !== "cancelled" && (
        <button
          onClick={() => setStatus("cancelled")}
          disabled={pending}
          className="rounded-full border border-error-200 px-3 py-1 text-xs font-medium text-error hover:bg-error-soft disabled:opacity-50"
        >
          Annuler
        </button>
      )}
    </div>
  );
}
