/**
 * LaTeX render client — sends a full standalone document to the /api/latex proxy
 * (Vercel Edge Function → latex.codecogs.com), which supports complete TikZ.
 */

interface RenderResult {
  url: string;
  width: number;
  height: number;
}

// Simple in-memory cache keyed by TikZ code
const cache = new Map<string, RenderResult>();

/**
 * Extracts the tikzpicture block from any input (snippet, full doc, or bare commands).
 * api/latex.ts expects only the tikzpicture block — it adds the preamble itself.
 */
function extractBlock(code: string): string {
  const blockMatch = code.match(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/);
  if (blockMatch) return blockMatch[0];
  // No block found — wrap bare commands
  return `\\begin{tikzpicture}\n${code.trim()}\n\\end{tikzpicture}`;
}

/**
 * Fixes common AI TikZ generation mistakes.
 */
function sanitizeTikz(code: string): string {
  // Strip markdown code fences
  const fenced = code.match(/```(?:latex|tex)?\s*([\s\S]*?)```/i)
  if (fenced) code = fenced[1]
  return code
    .replace(/\\n/g, "\n")
    .replace(
      /\\\\(draw|node|fill|filldraw|shade|clip|coordinate|path|foreach|pgf|text|begin|end|tikz|usepackage|usetikzlibrary|def|let|scope)\b/g,
      "\\$1",
    )
    .replace(/\+\s*-\s*\(/g, "(")
    .replace(/-\s*\+\s*\(/g, "(")
    .replace(/\+\s*;/g, ";")
    .trim();
}

/**
 * Renders TikZ code and returns a PNG data URL via the /api/latex proxy.
 */
export async function renderTikz(code: string): Promise<RenderResult> {
  const sanitized = sanitizeTikz(code);
  const document = extractBlock(sanitized);

  const cached = cache.get(document);
  if (cached) return cached;

  const res = await fetch("/api/latex", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: document }),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`LaTeX render error: HTTP ${res.status}${msg ? ` — ${msg}` : ""}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  // We don't know exact dimensions until the image loads — use defaults
  const result: RenderResult = { url, width: 400, height: 300 };
  cache.set(document, result);
  return result;
}
