import { ImageResponse } from "next/og";
export const alt = "Folio — A clearer mind. A little more possibility.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function OpenGraphImage() {
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", background: "#f4eff9", color: "#302938", padding: "72px 90px", fontFamily: "sans-serif" }}><div style={{ display: "flex", fontSize: 39, fontWeight: 700, letterSpacing: -2, marginBottom: 52 }}>folio.</div><div style={{ display: "flex", fontSize: 68, fontWeight: 500, lineHeight: 1.1, letterSpacing: -3 }}>A clearer mind.</div><div style={{ display: "flex", fontSize: 68, fontStyle: "italic", lineHeight: 1.1, letterSpacing: -3, color: "#8062ad" }}>A little more possibility.</div><div style={{ display: "flex", marginTop: 35, fontSize: 21, color: "#7a7683" }}>Your projects, plans, and bright ideas. Beautifully together.</div></div>, size);
}
