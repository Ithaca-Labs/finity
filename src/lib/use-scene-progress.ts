"use client";
import type { RefObject } from "react";
import { useMotionValue, useReducedMotion, useScroll, useTransform, type MotionValue } from "motion/react";

type Offset = NonNullable<Parameters<typeof useScroll>[0]>["offset"];

/**
 * Scroll progress through a scene, or a fixed resting value when the visitor prefers reduced motion.
 * The identity transform opts out of Motion's native ViewTimeline acceleration, which desyncs in pinned scenes.
 */
export function useSceneProgress(target: RefObject<HTMLElement | null>, offset: Offset, rest = 1): MotionValue<number> {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target, offset });
  const live = useTransform(scrollYProgress, (v) => v);
  const still = useMotionValue(rest);
  return reduced ? still : live;
}
