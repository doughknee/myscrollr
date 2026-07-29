import { AnimatePresence, motion } from "motion/react";
import { stateMotion } from "../lib/motion";

export default function WidgetStateTransition({
  stateKey,
  children,
}: {
  stateKey: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-1 flex-col">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={stateKey}
          variants={stateMotion}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="flex flex-1 flex-col"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
