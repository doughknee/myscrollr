/**
 * The screen you're actually looking at when your matchup is on the line.
 *
 * This is the missing pitch. Every earlier cut showed the bar floating in
 * black, so a viewer finished it without learning that Scrollr sits on
 * your desktop while you work — which is the whole product. The bar has
 * to be seen at the edge of a screen with work on it, or the video is a
 * motion graphic rather than a demo.
 *
 * DELIBERATELY GENERIC. A spreadsheet-shaped window with invented
 * contents, no real product's chrome, branding or layout. Mimicking a
 * recognisable app would be both a trademark problem and a distraction —
 * the viewer needs to read "work", not identify a vendor. Spreadsheet
 * rather than a code editor because the audience is fantasy players, not
 * developers, and a grid reads as "at work" to everyone.
 */

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H"];

/** Invented, and dull on purpose — it's set dressing, not something to read. */
const ROWS: readonly (readonly string[])[] = [
  ["Region", "Q1", "Q2", "Q3", "Q4", "Total", "Var", "%"],
  ["North", "18,420", "19,110", "17,860", "21,340", "76,730", "+4.1", "12%"],
  ["South", "12,880", "13,450", "14,020", "13,760", "54,110", "+1.8", "9%"],
  ["East", "22,140", "21,880", "23,510", "24,020", "91,550", "+6.2", "15%"],
  ["West", "16,330", "15,940", "16,780", "17,220", "66,270", "+2.4", "11%"],
  ["Central", "9,410", "9,880", "10,120", "10,640", "40,050", "+3.7", "7%"],
  ["Coastal", "14,760", "15,010", "14,330", "15,880", "59,980", "+2.9", "10%"],
  ["Interior", "11,240", "10,970", "11,610", "12,080", "45,900", "+1.2", "8%"],
  ["Metro", "27,510", "28,340", "29,110", "28,760", "113,720", "+5.5", "19%"],
  ["Rural", "6,890", "7,120", "6,940", "7,410", "28,360", "+0.9", "5%"],
];

export function Desktop() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#16181d",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: 1960,
          // Sized to its rows, not to the frame. Taller than the content
          // leaves a dead grey slab that reads as a broken screenshot.
          height: 56 + 44 * 11 + 24,
          marginBottom: 260,
          borderRadius: 14,
          overflow: "hidden",
          background: "#1f2228",
          boxShadow: "0 40px 120px rgba(0,0,0,0.55)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            height: 56,
            background: "#282c34",
            display: "flex",
            alignItems: "center",
            gap: 12,
            paddingLeft: 22,
            flexShrink: 0,
          }}
        >
          {["#5c6169", "#5c6169", "#5c6169"].map((c, i) => (
            <span
              key={i}
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: c,
              }}
            />
          ))}
          <span
            style={{ marginLeft: 20, color: "#7d848f", fontSize: 20 }}
          >
            regional-forecast-Q4.xlsx
          </span>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", height: 44, flexShrink: 0 }}>
            <Cell w={80} head />
            {COLS.map((c) => (
              <Cell key={c} w={244} head>
                {c}
              </Cell>
            ))}
          </div>
          {ROWS.map((row, r) => (
            <div key={r} style={{ display: "flex", height: 44, flexShrink: 0 }}>
              <Cell w={80} head>
                {r + 1}
              </Cell>
              {row.map((v, i) => (
                <Cell key={i} w={244} bold={r === 0}>
                  {v}
                </Cell>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Cell({
  children,
  w,
  head = false,
  bold = false,
}: {
  children?: React.ReactNode;
  w: number;
  head?: boolean;
  bold?: boolean;
}) {
  return (
    <div
      style={{
        width: w,
        display: "flex",
        alignItems: "center",
        paddingLeft: 14,
        fontSize: 19,
        color: head ? "#6b7280" : bold ? "#c3c9d3" : "#8b93a1",
        fontWeight: bold ? 600 : 400,
        background: head ? "#23262c" : "transparent",
        borderRight: "1px solid #2a2e35",
        borderBottom: "1px solid #2a2e35",
        justifyContent: head && !children ? "center" : "flex-start",
      }}
    >
      {children}
    </div>
  );
}
