/**
 * ScrollLogo — the Scrollr brand glyph.
 *
 * Solid mint when idle; animated widget-color gradient + glow when
 * the ticker is alive. Used in the TopBar (always-visible chrome) and
 * in any other surface that wants the brand mark.
 *
 * The `alive` prop drives the gradient animation. We use a unique
 * gradient id per instance to support multiple ScrollLogos on the
 * same page without sharing animation state.
 */
import { useId } from "react";
import clsx from "clsx";

const SCROLL_PATH =
  "M4870 6321 c-100 -32 -157 -70 -215 -140 l-29 -36 41 37 c329 291 807 -68 501 -375 -132 -132 -60 -130 -1750 -66 -1538 57 -1544 57 -1792 9 -1687 -328 -1763 -2552 -101 -2980 253 -65 227 -64 1750 -65 1531 0 1427 4 1568 -66 371 -184 376 -666 9 -858 -160 -83 43 -75 -2157 -81 -2131 -6 -2047 -4 -2225 -61 -234 -74 -312 -243 -250 -539 54 -254 193 -701 256 -821 145 -275 578 -316 759 -72 l28 38 -39 -36 c-279 -257 -732 -25 -564 289 84 158 228 208 560 195 354 -13 3176 -93 3313 -93 895 0 1529 475 1690 1264 188 928 -386 1701 -1383 1862 -108 18 -198 19 -1510 19 l-1395 0 -78 22 c-556 158 -528 849 38 968 60 12 287 15 1525 15 1678 0 1780 4 1990 72 190 61 284 172 283 333 -2 156 -215 857 -302 991 -105 164 -326 238 -521 175z";

interface ScrollLogoProps {
  alive: boolean;
  size?: number;
  className?: string;
}

export default function ScrollLogo({
  alive,
  size = 24,
  className,
}: ScrollLogoProps) {
  const gradId = useId();

  return (
    <svg
      viewBox="0 0 639 639"
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={clsx("shrink-0", alive && "scroll-logo-alive", className)}
    >
      {alive && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%">
              <animate
                attributeName="stop-color"
                values="#34d399;#ff4757;#00d4ff;#a855f7;#34d399"
                dur="8s"
                repeatCount="indefinite"
              />
            </stop>
            <stop offset="50%">
              <animate
                attributeName="stop-color"
                values="#00d4ff;#a855f7;#34d399;#ff4757;#00d4ff"
                dur="8s"
                repeatCount="indefinite"
              />
            </stop>
            <stop offset="100%">
              <animate
                attributeName="stop-color"
                values="#a855f7;#34d399;#ff4757;#00d4ff;#a855f7"
                dur="8s"
                repeatCount="indefinite"
              />
            </stop>
          </linearGradient>
        </defs>
      )}
      <g
        transform="translate(0,639) scale(0.1,-0.1)"
        fill={alive ? `url(#${gradId})` : "var(--color-primary)"}
        stroke="none"
      >
        <path d={SCROLL_PATH} />
      </g>
      <circle
        cx="492"
        cy="39"
        r="20"
        fill="var(--color-fg)"
        className={clsx(!alive && "opacity-60")}
      />
      <circle
        cx="97"
        cy="599"
        r="20"
        fill="var(--color-fg)"
        className={clsx(!alive && "opacity-60")}
      />
    </svg>
  );
}
