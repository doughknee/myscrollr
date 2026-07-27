import type { Transition, Variants } from "motion/react";

export const APP_TRANSITION = {
  duration: 0.18,
  ease: [0.22, 0.61, 0.36, 1],
} satisfies Transition;

export const ROUTE_VARIANTS = {
  hidden: { opacity: 0 },
  show: { opacity: 1 },
  out: { opacity: 0 },
} satisfies Variants;
