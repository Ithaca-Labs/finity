"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import ScrollTrigger from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function LandingMotion() {
  useGSAP(() => {
    const media = gsap.matchMedia();

    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.utils.toArray<HTMLElement>(".motion-section").forEach((section) => {
        const cards = section.querySelectorAll(".motion-card");
        const lead = section.querySelector(".section-lead");

        if (lead) {
          gsap.from(lead, {
            y: 28,
            opacity: 0,
            duration: 0.8,
            ease: "power3.out",
            scrollTrigger: { trigger: section, start: "top 76%" },
          });
        }

        gsap.from(cards, {
          y: 36,
          opacity: 0,
          duration: 0.75,
          stagger: 0.12,
          ease: "power3.out",
          scrollTrigger: { trigger: section, start: "top 64%" },
        });
      });

      const proofVisual = document.querySelector<HTMLElement>(".proof-visual");
      if (proofVisual) {
        gsap.fromTo(
          proofVisual,
          { backgroundPositionY: "48%" },
          {
            backgroundPositionY: "70%",
            ease: "none",
            scrollTrigger: { trigger: proofVisual, start: "top bottom", end: "bottom top", scrub: 0.6 },
          },
        );
      }
    });

    return () => media.revert();
  });

  return null;
}
