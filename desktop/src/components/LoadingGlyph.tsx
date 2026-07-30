import { clsx } from "clsx";
import { Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { loadingTransition } from "../lib/motion";
import type { CSSProperties } from "react";

export default function LoadingGlyph({
  size = 14,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <motion.span
      aria-hidden
      animate={{ transform: "rotate(360deg)" }}
      transition={loadingTransition}
      className={clsx("inline-flex shrink-0", className)}
      style={style}
    >
      <Loader2 size={size} />
    </motion.span>
  );
}
