import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Tableau d'administration responsive MORA Shawiri.
 * Gère le défilement horizontal sur mobile et une hiérarchie de colonnes claire.
 */
export function AdminTable({
  headers,
  children,
  className,
}: {
  headers: ReactNode[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-soft">
      <div className="overflow-x-auto">
        <table className={cn("w-full text-left text-sm", className)}>
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="whitespace-nowrap px-4 py-3.5 font-semibold first:pl-5 last:pr-5 sm:px-5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr className={cn("border-b border-gray-100 transition-colors last:border-0 hover:bg-mora-blue-10/60", className)}>
      {children}
    </tr>
  );
}

export function AdminCell({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("px-4 py-4 align-middle text-gray-600 first:pl-5 last:pr-5 sm:px-5", className)}>{children}</td>;
}
