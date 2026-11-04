#!/usr/bin/env node
// Generates src/app/theme-dark.generated.css from Folio's light stylesheets.
//
// Every colour declaration in the inputs gets a dark-theme counterpart scoped
// under [data-theme="dark"], using role-aware perceptual mapping:
//   surfaces  → deep, low-saturation backgrounds (accent fills stay vivid)
//   text      → light neutrals; coloured text is lifted for contrast
//   borders   → subtle dark hairlines
//   shadows   → deeper and slightly stronger
// Hand-tuned tokens and component overrides live in src/app/theme.css, which
// is loaded after this file. Re-run with:  node scripts/build-dark-theme.mjs
import { readFileSync, writeFileSync } from "node:fs";

const INPUTS = ["src/app/globals.css", "src/app/polish.css", "src/app/dashboard.css"];
const OUTPUT = "src/app/theme-dark.generated.css";
const SCOPE = '[data-theme="dark"]';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function parseColor(token) {
  const t = token.toLowerCase();
  if (t === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (t === "black") return { r: 0, g: 0, b: 0, a: 1 };
  if (t.startsWith("#")) {
    let hex = t.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = (i) => parseInt(hex.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
  }
  const match = t.match(/^rgba?\(([^()]*)\)$/);
  if (!match) return null;
  const parts = match[1].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (v) => (v.endsWith("%") ? parseFloat(v) * 2.55 : parseFloat(v));
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  const color = { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
  return Object.values(color).some(Number.isNaN) ? null : color;
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s, l };
}

function hslToRgb(h, s, l) {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: hue(p, q, h + 1 / 3) * 255, g: hue(p, q, h) * 255, b: hue(p, q, h - 1 / 3) * 255 };
}

function format({ r, g, b }, a) {
  const c = [r, g, b].map((v) => Math.round(clamp(v, 0, 255)));
  if (a >= 0.999) return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return `rgba(${c.join(", ")}, ${+a.toFixed(3)})`;
}

function mapColor(color, role) {
  let { h, s, l } = rgbToHsl(color);
  let a = color.a;
  // Chroma (not HSL saturation, which explodes near white) decides neutral vs coloured.
  const chroma = (Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)) / 255;
  const vivid = chroma > 0.16 && l > 0.3 && l < 0.85;
  const tint = () => { h = 0.68; s = 0.09; }; // Folio's cool, slightly violet neutral
  if (role === "bg") {
    if (vivid) { l *= 0.9; s *= 0.9; } else { l = 0.095 + (1 - l) * 0.9; if (chroma < 0.025) tint(); else s *= 0.5; }
  } else if (role === "border") {
    if (vivid) l = clamp(l, 0.45, 0.72); else { l = 0.16 + (1 - l); if (chroma < 0.025) tint(); else s *= 0.45; }
  } else if (role === "shadow") {
    if (vivid) { /* keep coloured glows */ } else if (l > 0.6) { l = 0.14 + (1 - l) * 0.9; s *= 0.4; } else { l *= 0.35; a = Math.min(1, a * 1.8); }
  } else if (chroma > 0.12 && l > 0.15 && l < 0.92) {
    l = clamp(1.22 - l, 0.6, 0.8);
  } else {
    l = 0.2 + (1 - l) * 0.8; s *= 0.6;
  }
  return format(hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1)), a);
}

function customPropertyRole(name) {
  if (/shadow/.test(name)) return "shadow";
  if (/text|muted|faint|ink|heading|foreground/.test(name)) return "text";
  if (/border|line|divider|outline|ring(?!-track)/.test(name)) return "border";
  if (/background|surface|bg|soft|fill|track|tint|wash|hover|panel|card/.test(name)) return "bg";
  return "text";
}

function roleFor(prop) {
  if (prop.startsWith("--")) return customPropertyRole(prop);
  if (["color", "caret-color", "accent-color", "-webkit-text-fill-color", "text-emphasis-color"].includes(prop) || prop.startsWith("text-decoration")) return "text";
  if (prop.startsWith("background")) return "bg";
  if (prop.startsWith("border") || prop.startsWith("outline") || prop.startsWith("column-rule")) return "border";
  if (["box-shadow", "-webkit-box-shadow", "text-shadow", "filter"].includes(prop)) return "shadow";
  if (["fill", "stroke", "stop-color", "flood-color", "scrollbar-color"].includes(prop)) return "bg";
  return null;
}

const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)|(?<![-\w])(?:white|black)(?![-\w])/g;

function mapValue(value, role) {
  let changed = false;
  const next = value.replace(COLOR_TOKEN, (token) => {
    const color = parseColor(token);
    if (!color) return token;
    changed = true;
    return mapColor(color, role);
  });
  return changed ? next : null;
}

function splitTopLevel(input, separator) {
  const parts = [];
  let depth = 0, quote = null, start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === separator && depth === 0) { parts.push(input.slice(start, i)); start = i + 1; }
  }
  parts.push(input.slice(start));
  return parts;
}

function scopeSelector(selector) {
  const sel = selector.trim();
  if (sel.startsWith(":root")) return `:root${SCOPE}${sel.slice(5)}`;
  if (/^html(?![\w-])/.test(sel)) return `html${SCOPE}${sel.slice(4)}`;
  return `${SCOPE} ${sel}`;
}

function parse(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  function readBlockBody() {
    const start = i;
    let depth = 1, quote = null;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) { const body = source.slice(start, i); i++; return body; }
    }
    return source.slice(start);
  }
  function parseNodes() {
    const nodes = [];
    while (i < source.length) {
      while (i < source.length && /\s/.test(source[i])) i++;
      if (i >= source.length) break;
      if (source[i] === "}") { i++; break; }
      const start = i;
      let depth = 0, quote = null;
      for (; i < source.length; i++) {
        const ch = source[i];
        if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (depth === 0 && (ch === "{" || ch === ";" || ch === "}")) break;
      }
      const prelude = source.slice(start, i).trim();
      if (source[i] === ";") { i++; continue; }
      if (source[i] !== "{") continue;
      i++;
      if (/^@(media|supports|container|layer)\b/.test(prelude)) nodes.push({ type: "group", prelude, children: parseNodes() });
      else if (prelude.startsWith("@")) readBlockBody();
      else nodes.push({ type: "rule", selector: prelude, body: readBlockBody() });
    }
    return nodes;
  }
  return parseNodes();
}

function emit(nodes) {
  const out = [];
  for (const node of nodes) {
    if (node.type === "group") {
      const inner = emit(node.children);
      if (inner.length) out.push(`${node.prelude}{${inner.join("")}}`);
      continue;
    }
    const declarations = [];
    for (const raw of splitTopLevel(node.body, ";")) {
      const colon = raw.indexOf(":");
      if (colon < 0) continue;
      const prop = raw.slice(0, colon).trim().toLowerCase();
      const value = raw.slice(colon + 1).trim();
      const role = roleFor(prop);
      if (!role || !value) continue;
      const mapped = mapValue(value, role);
      if (mapped === null) continue;
      // Emit colour longhands so widths/styles/images set by other rules are never reset.
      const shorthand = /^(border(-top|-right|-bottom|-left)?|outline|column-rule)$/.test(prop);
      if (shorthand) {
        const colors = mapped.match(COLOR_TOKEN);
        if (colors?.length === 1) { declarations.push(`${prop}-color:${colors[0]}`); continue; }
      }
      if (prop === "background" && !/gradient\(/i.test(value)) {
        const colors = mapped.match(COLOR_TOKEN);
        if (colors?.length === 1) { declarations.push(`background-color:${colors[0]}`); continue; }
      }
      declarations.push(`${raw.slice(0, colon).trim()}:${mapped}`);
    }
    if (!declarations.length) continue;
    const selector = splitTopLevel(node.selector, ",").map(scopeSelector).join(",");
    out.push(`${selector}{${declarations.join(";")}}\n`);
  }
  return out;
}

const banner = `/* Generated by scripts/build-dark-theme.mjs from ${INPUTS.join(", ")}.\n   Do not edit by hand — tune tokens and overrides in src/app/theme.css. */\n`;
const sections = INPUTS.map((file) => `/* ${file} */\n${emit(parse(readFileSync(file, "utf8"))).join("")}`);
writeFileSync(OUTPUT, banner + sections.join("\n"));
const size = Buffer.byteLength(banner + sections.join("\n"));
console.log(`Wrote ${OUTPUT} (${(size / 1024).toFixed(1)} KB)`);
