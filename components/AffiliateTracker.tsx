"use client";

import { useEffect } from "react";

/**
 * Capture le paramètre `?ref=CODE` (lien affilié) et mémorise le code dans un
 * cookie (30 jours) afin que les conversions soient attribuées à l'affilié.
 * Ne stocke aucune donnée personnelle ; le code est non sensible.
 */
export function AffiliateTracker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && /^[A-Z0-9-]{3,20}$/i.test(ref)) {
      document.cookie = `ms_ref=${encodeURIComponent(ref)}; path=/; max-age=${60 * 60 * 24 * 30}`;
    }
  }, []);

  return null;
}
