/**
 * The screen you're actually looking at when your matchup is on the line.
 *
 * This is the pitch. Earlier cuts had the bar floating in black and a
 * viewer finished them without learning that Scrollr runs on your screen
 * while you work, which is the entire product.
 *
 * WHY IT'S BUILT THIS DENSELY. The first version was one grey rounded
 * rectangle on a flat grey field, and it read as a wireframe rather than
 * a screen — which made the whole film look like a prototype. What sells
 * "this is a real desktop" in a two-second establishing shot, roughly in
 * order of value per pixel:
 *
 *   1. A wallpaper with COLOUR and depth. Flat grey is the single
 *      biggest tell; real screens are never flat.
 *   2. Layered windows with real shadows. One window reads as a mockup;
 *      two overlapping with a focused/unfocused distinction reads as a
 *      screenshot.
 *   3. A menu bar with a clock. Tiny, but it's the thing every real
 *      screenshot has and no mockup bothers with.
 *   4. Vignette and rounded screen corners, so the frame reads as a
 *      display rather than as the video's own edge.
 *
 * DELIBERATELY GENERIC throughout: invented file names, invented data,
 * neutral grey window dots rather than any vendor's coloured ones, no
 * recognisable chrome. The viewer needs to read "work", not identify a
 * product — and mimicking a real one is a trademark problem.
 */

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H"];

/** Invented and dull on purpose — set dressing, not something to read. */
const ROWS: readonly (readonly string[])[] = [
  ["Region", "Q1", "Q2", "Q3", "Q4", "Total", "Var", "%"],
  ["North", "18,420", "19,110", "17,860", "21,340", "76,730", "+4.1", "12%"],
  ["South", "12,880", "13,450", "14,020", "13,760", "54,110", "+1.8", "9%"],
  ["East", "22,140", "21,880", "23,510", "24,020", "91,550", "+6.2", "15%"],
  ["West", "16,330", "15,940", "16,780", "17,220", "66,270", "+2.4", "11%"],
  ["Central", "9,410", "9,880", "10,120", "10,640", "40,050", "+3.7", "7%"],
  ["Coastal", "14,760", "15,010", "14,330", "15,880", "59,980", "+2.9", "10%"],
  ["Interior", "11,240", "10,970", "11,610", "12,080", "45,900", "+1.2", "8%"],
];

const UI = "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";

export function Desktop() {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/* Wallpaper. Three stacked gradients: a deep base, a warm bloom
          top-left and a cool one bottom-right. Colour and unevenness are
          what stop a screen looking like a placeholder. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#0b1020",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(1400px 900px at 18% 12%, rgba(88,60,160,0.55) 0%, transparent 60%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(1600px 1000px at 88% 92%, rgba(16,84,120,0.5) 0%, transparent 62%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.04) 0%, transparent 40%, rgba(0,0,0,0.35) 100%)",
        }}
      />

      {/* Menu bar. Nobody looks at it and everybody notices its absence. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 46,
          background: "rgba(10,12,20,0.55)",
          display: "flex",
          alignItems: "center",
          padding: "0 28px",
          fontFamily: UI,
          fontSize: 20,
          color: "rgba(255,255,255,0.62)",
          gap: 34,
        }}
      >
        <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>
          Workspace
        </span>
        <span>File</span>
        <span>Edit</span>
        <span>View</span>
        <span style={{ marginLeft: "auto", letterSpacing: "0.02em" }}>
          Sun 1:47 PM
        </span>
      </div>

      {/* Back window, unfocused: dimmer, flatter shadow, slightly desaturated.
          A single window reads as a mockup; two with a focus hierarchy
          reads as somebody's actual screen. */}
      <Window
        x={190}
        y={214}
        w={1460}
        // Sized to content. A window taller than what's in it leaves a
        // dead slab that reads as a broken screenshot.
        h={534}
        title="Q4 planning — notes"
        focused={false}
      >
        <Notes />
      </Window>

      {/* Front window, focused. */}
      <Window
        x={604}
        y={392}
        w={1740}
        h={52 + 42 * 9}
        title="regional-forecast-Q4.xlsx"
        focused
      >
        <Sheet />
      </Window>

      {/* Vignette + rounded screen corners, so the frame reads as a display
          rather than as the edge of the video. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          boxShadow: "inset 0 0 400px 120px rgba(0,0,0,0.55)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

function Window({
  x,
  y,
  w,
  h,
  title,
  focused,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  focused: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 16,
        overflow: "hidden",
        background: focused ? "#1b1f27" : "#171a21",
        border: `1px solid ${focused ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.05)"}`,
        boxShadow: focused
          ? "0 60px 140px rgba(0,0,0,0.65), 0 8px 24px rgba(0,0,0,0.5)"
          : "0 30px 80px rgba(0,0,0,0.5)",
        opacity: focused ? 1 : 0.72,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: 52,
          flexShrink: 0,
          background: focused ? "#232833" : "#1c2029",
          display: "flex",
          alignItems: "center",
          gap: 11,
          paddingLeft: 22,
          borderBottom: "1px solid rgba(0,0,0,0.35)",
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 13,
              height: 13,
              borderRadius: "50%",
              background: focused
                ? "rgba(255,255,255,0.22)"
                : "rgba(255,255,255,0.11)",
            }}
          />
        ))}
        <span
          style={{
            marginLeft: 18,
            fontFamily: UI,
            fontSize: 19,
            color: focused ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.32)",
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>{children}</div>
    </div>
  );
}

function Sheet() {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", height: 42 }}>
        <Cell w={72} head />
        {COLS.map((c) => (
          <Cell key={c} w={210} head>
            {c}
          </Cell>
        ))}
      </div>
      {ROWS.map((row, r) => (
        <div key={r} style={{ display: "flex", height: 42 }}>
          <Cell w={72} head>
            {r + 1}
          </Cell>
          {row.map((v, i) => (
            <Cell key={i} w={210} bold={r === 0} selected={r === 4 && i === 5}>
              {v}
            </Cell>
          ))}
        </div>
      ))}
    </div>
  );
}

function Cell({
  children,
  w,
  head = false,
  bold = false,
  selected = false,
}: {
  children?: React.ReactNode;
  w: number;
  head?: boolean;
  bold?: boolean;
  selected?: boolean;
}) {
  return (
    <div
      style={{
        width: w,
        display: "flex",
        alignItems: "center",
        paddingLeft: 13,
        fontFamily: UI,
        fontSize: 18,
        color: head
          ? "rgba(255,255,255,0.32)"
          : bold
            ? "rgba(255,255,255,0.78)"
            : "rgba(255,255,255,0.52)",
        fontWeight: bold ? 600 : 400,
        background: head
          ? "rgba(255,255,255,0.035)"
          : selected
            ? "rgba(96,140,255,0.16)"
            : "transparent",
        // One selected cell. A grid with no cursor in it looks rendered;
        // a grid with a selection looks like somebody was just working.
        outline: selected ? "2px solid rgba(120,160,255,0.75)" : undefined,
        outlineOffset: -2,
        borderRight: "1px solid rgba(255,255,255,0.05)",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        justifyContent: head && !children ? "center" : "flex-start",
      }}
    >
      {children}
    </div>
  );
}

function Notes() {
  const lines = [
    { w: "62%", dim: false },
    { w: "88%", dim: true },
    { w: "74%", dim: true },
    { w: "0", dim: true },
    { w: "48%", dim: false },
    { w: "91%", dim: true },
    { w: "83%", dim: true },
    { w: "56%", dim: true },
    { w: "0", dim: true },
    { w: "70%", dim: false },
    { w: "86%", dim: true },
    { w: "64%", dim: true },
  ];
  return (
    <div style={{ padding: "38px 44px", display: "grid", gap: 22 }}>
      {lines.map((l, i) =>
        l.w === "0" ? (
          <div key={i} style={{ height: 8 }} />
        ) : (
          <div
            key={i}
            style={{
              height: l.dim ? 13 : 17,
              width: l.w,
              borderRadius: 4,
              background: l.dim
                ? "rgba(255,255,255,0.075)"
                : "rgba(255,255,255,0.16)",
            }}
          />
        ),
      )}
    </div>
  );
}
