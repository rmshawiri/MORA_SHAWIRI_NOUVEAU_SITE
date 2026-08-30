import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { siteConfig } from "@/lib/config";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-structure px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-3">
        <Link href="/" aria-label="Accueil MORA Shawiri">
          <Logo className="h-14 w-14" />
        </Link>
        <div className="text-center">
          <p className="font-display text-lg font-bold text-mora-blue">{siteConfig.name}</p>
          <p className="text-xs text-gray-500">{siteConfig.slogan}</p>
        </div>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
