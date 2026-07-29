import type { Transition, Variants } from "motion/react";

export const appEase = [0.4, 0, 0.2, 1] as const;

export const routeTransition: Transition = {
  opacity: {
    duration: 0.42,
    ease: appEase,
  },
  transform: {
    type: "spring",
    bounce: 0,
    visualDuration: 0.55,
  },
};

export const backdropMotion: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.22, ease: appEase },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.16, ease: appEase },
  },
};

export const overlaySurfaceMotion: Variants = {
  hidden: {
    opacity: 0,
    transform: "translateY(10px) scale(0.985)",
  },
  visible: {
    opacity: 1,
    transform: "translateY(0px) scale(1)",
    transition: {
      opacity: { duration: 0.24, ease: appEase },
      transform: { type: "spring", bounce: 0, visualDuration: 0.36 },
    },
  },
  exit: {
    opacity: 0,
    transform: "translateY(5px) scale(0.99)",
    transition: { duration: 0.16, ease: appEase },
  },
};

export const popoverMotion: Variants = {
  hidden: {
    opacity: 0,
    transform: "translateY(-4px) scale(0.98)",
  },
  visible: {
    opacity: 1,
    transform: "translateY(0px) scale(1)",
    transition: {
      opacity: { duration: 0.18, ease: appEase },
      transform: { type: "spring", bounce: 0, visualDuration: 0.26 },
    },
  },
  exit: {
    opacity: 0,
    transform: "translateY(-2px) scale(0.985)",
    transition: { duration: 0.12, ease: appEase },
  },
};

export const tooltipMotion: Variants = {
  hidden: {
    opacity: 0,
    transform: "scale(0.96)",
  },
  visible: {
    opacity: 1,
    transform: "scale(1)",
    transition: { duration: 0.16, ease: appEase },
  },
  exit: {
    opacity: 0,
    transform: "scale(0.98)",
    transition: { duration: 0.1, ease: appEase },
  },
};

export const stateMotion: Variants = {
  hidden: {
    opacity: 0,
    transform: "translateY(8px)",
  },
  visible: {
    opacity: 1,
    transform: "translateY(0px)",
    transition: {
      opacity: { duration: 0.22, ease: appEase },
      transform: { type: "spring", bounce: 0, visualDuration: 0.32 },
    },
  },
  exit: {
    opacity: 0,
    transform: "translateY(-4px)",
    transition: { duration: 0.14, ease: appEase },
  },
};

export const controlTransition: Transition = {
  type: "spring",
  bounce: 0,
  visualDuration: 0.28,
};

export const loadingTransition: Transition = {
  duration: 0.9,
  ease: "linear",
  repeat: Infinity,
};
