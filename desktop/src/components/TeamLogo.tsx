import { useState } from "react";
import { clsx } from "clsx";

const SIZES = {
  xs: "w-3 h-3",
  sm: "w-3.5 h-3.5",
  md: "w-4 h-4",
  lg: "w-5 h-5",
  xl: "w-8 h-8",
} as const;

interface TeamLogoProps {
  src: string;
  alt: string;
  size?: keyof typeof SIZES;
  className?: string;
}

export default function TeamLogo({ src, alt, size = "md", className }: TeamLogoProps) {
  const [err, setErr] = useState(false);
  if (err || !src) return null;
  return (
    <img
      src={src}
      alt={alt}
      className={clsx(SIZES[size], "object-contain shrink-0", className)}
      loading="lazy"
      onError={() => setErr(true)}
    />
  );
}
