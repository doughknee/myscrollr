import { AnimatePresence, motion } from "motion/react";
import { ROUTE_VARIANTS } from "../../lib/motion";
import type { ReactNode } from "react";

export default function ContentTransition({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={id}
        variants={ROUTE_VARIANTS}
        initial="hidden"
        animate="show"
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
