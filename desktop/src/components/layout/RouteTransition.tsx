import { useEffect, useRef, type ReactNode } from "react";
import { motion } from "motion/react";
import { routeTransition } from "../../lib/motion";

export default function RouteTransition({
  routeKey,
  children,
}: {
  routeKey: string;
  children: ReactNode;
}) {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);

  return (
    <motion.div
      key={routeKey}
      className="h-full min-h-0"
      initial={
        mounted.current
          ? { opacity: 0, transform: "translateY(14px)" }
          : false
      }
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={routeTransition}
    >
      {children}
    </motion.div>
  );
}
