/**
 * QuickLaTeX client — renders TikZ code to a PNG image via the proxy.
 * In production: /api/quicklatex (Vercel Edge Function).
 * In dev: /api/quicklatex (Vite configureServer middleware in vite.config.ts).
 */

interface QuickLaTeXResult {
  url: string;
  width: number;
  height: number;
}

// Simple in-memory cache keyed by TikZ code
const cache = new Map<string, QuickLaTeXResult>();

/**
 * Extracts the \begin{tikzpicture}...\end{tikzpicture} block from any input.
 * Full \documentclass documents are unwrapped — QuickLaTeX's free API only
 * accepts snippet mode (mode=0) and rejects \documentclass with error -3.
 * \usetikzlibrary calls in the preamble are preserved via extractLibraries().
 */
function wrapTikz(code: string): string {
  const trimmed = code.trim();

  // Full document: extract only the tikzpicture block (discard \documentclass wrapper).
  // QuickLaTeX free API does not support mode=1 and errors on \documentclass.
  if (trimmed.startsWith("\\documentclass")) {
    const blockMatch = trimmed.match(
      /\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/,
    );
    if (blockMatch) return blockMatch[0];
    // Full doc but tikzpicture block missing — fall through to bare-command handler
  }

  // Complete tikzpicture block — extract it.
  const blockMatch = trimmed.match(
    /\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/,
  );
  if (blockMatch) return blockMatch[0];

  // Truncated output: \begin{tikzpicture} present but \end{tikzpicture} missing — close it.
  const beginIdx = trimmed.indexOf("\\begin{tikzpicture}");
  if (beginIdx !== -1) {
    let body = trimmed.slice(beginIdx);
    // Drop any trailing incomplete line (no semicolon = command was cut off mid-way)
    const lines = body.split("\n");
    let lastComplete = lines.length - 1;
    while (lastComplete > 0) {
      const l = lines[lastComplete].trim();
      if (l.endsWith(";") || l.endsWith("{") || l.endsWith("}") || l === "")
        break;
      lastComplete--;
    }
    body = lines.slice(0, lastComplete + 1).join("\n");
    return body + "\n\\end{tikzpicture}";
  }

  // Bare TikZ commands — wrap them
  return `\\begin{tikzpicture}\n${trimmed}\n\\end{tikzpicture}`;
}

/**
 * Fixes common AI TikZ generation mistakes before sending to QuickLaTeX.
 */
function sanitizeTikz(code: string): string {
  const isFullDoc = code.trim().startsWith("\\documentclass");
  let s = code
    // AI sometimes produces literal \n instead of actual newlines
    .replace(/\\n/g, "\n")
    // Extra escaped backslashes: \\\\draw → \\draw (AI double-escapes in JSON context)
    .replace(
      /\\\\(draw|node|fill|filldraw|shade|clip|coordinate|path|foreach|pgf|text|begin|end|tikz|usepackage|usetikzlibrary|def|let|scope|matrix|pic|graph)\b/g,
      "\\$1",
    );

  if (!isFullDoc) {
    // Remove \usepackage lines (QuickLaTeX doesn't support them and they break the scanner)
    // Only remove if it's a snippet; full documents need their preamble.
    s = s.replace(/\\usepackage(\[[^\]]*\])?\{[^}]+\}\s*\n?/g, "");
  }

  return (
    s
      // Stray +- or -+ sequences that aren't valid TikZ
      .replace(/\+\s*-\s*\(/g, "(")
      .replace(/-\s*\+\s*\(/g, "(")
      // Trailing + before semicolons
      .replace(/\+\s*;/g, ";")
      .trim()
  );
}

/**
 * Extracts \usetikzlibrary calls from outside the tikzpicture block so they
 * can be forwarded in the preamble field. Returns them as a comma-joined string
 * (e.g. "angles,quotes,calc") or empty string if none.
 */
function extractLibraries(code: string): string {
  const libs: string[] = [];
  const re = /\\usetikzlibrary\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    libs.push(
      ...m[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return [...new Set(libs)].join(",");
}

/**
 * Renders TikZ code and returns a PNG URL hosted on quicklatex.com.
 * Throws if rendering fails.
 */
export async function renderTikz(code: string): Promise<QuickLaTeXResult> {
  const sanitized = sanitizeTikz(code);
  const formula = wrapTikz(sanitized);
  // Always extract libraries from the original sanitized code (including preamble of full docs)
  const libraries = extractLibraries(sanitized);
  const cacheKey = formula + "|" + libraries;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const res = await fetch("/api/quicklatex", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ formula, libraries }),
  });

  if (!res.ok) throw new Error(`QuickLaTeX proxy error: HTTP ${res.status}`);

  const text = await res.text();
  // QuickLaTeX puts URL, status, and dimensions on the same line:
  //   "https://quicklatex.com/.../ql_xxx.png 0 207 202"
  // Find the line containing the image URL
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const urlLine = lines.find((l) => l.startsWith("http"));
  if (!urlLine) throw new Error("QuickLaTeX returned no image URL");

  // The URL is only the first token — status and dimensions follow on the same line
  const url = urlLine.split(/\s+/)[0];

  // If the URL points to QuickLaTeX's own error image, the render failed
  if (url.includes("/error.png")) {
    const msg = lines
      .filter((l) => !l.startsWith("http") && !/^\d/.test(l))
      .join(" ")
      .trim();
    throw new Error(`QuickLaTeX: ${msg || "render error"}`);
  }

  // Dimensions: last two numbers on the URL line (e.g. "207 202")
  const dimMatch = urlLine.match(/(\d+)\s+(\d+)\s*$/);
  const w = dimMatch ? parseInt(dimMatch[1]) : 400;
  const h = dimMatch ? parseInt(dimMatch[2]) : 300;
  const result: QuickLaTeXResult = {
    url,
    width: isNaN(w) ? 400 : w,
    height: isNaN(h) ? 300 : h,
  };
  cache.set(cacheKey, result);
  return result;
}
