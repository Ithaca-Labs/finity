"use client";

import { useEffect } from "react";
import Lenis from "lenis";

export function SmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({
      anchors: true,
      autoRaf: true,
      respectReducedMotion: true,
      smoothWheel: true,
    });

    return () => lenis.destroy();
  }, []);

  return null;
}
