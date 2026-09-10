/**
 * Turning study material (HTML pages, PDFs, uploaded files) into plain text for the generator.
 */

export const FETCH_TIMEOUT_MS = 20_000;
export const FETCH_MAX_BYTES = 10 * 1024 * 1024;

/** Error carrying an HTTP status so the API layer can forward it as-is. */
export class ExtractError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly code: string = "extract_failed",
  ) {
    super(message);
    this.name = "ExtractError";
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  deg: "°",
  micro: "µ",
  times: "×",
  plusmn: "±",
  frac12: "½",
  frac14: "¼",
  eacute: "é",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function collapseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const BLOCK_TAGS =
  "p|div|br|hr|h[1-6]|li|ul|ol|tr|td|th|table|thead|tbody|section|article|header|footer|nav|aside|main|blockquote|pre|dd|dt|dl|figure|figcaption|form|fieldset|address|details|summary";

export function extractTextFromHtml(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? collapseWhitespace(decodeEntities(titleMatch[1] ?? "")).replace(/\n+/g, " ") : "";
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n")
    .replace(/<[^>]+>/g, " ");
  return { title, text: collapseWhitespace(decodeEntities(stripped)) };
}

/** Reads a body stream, aborting once it exceeds `FETCH_MAX_BYTES`. */
async function readBodyCapped(response: Response, controller: AbortController): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > FETCH_MAX_BYTES) {
    controller.abort();
    throw new ExtractError("The page is larger than 10 MB.", 413, "source_too_large");
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > FETCH_MAX_BYTES) {
      controller.abort();
      throw new ExtractError("The page is larger than 10 MB.", 413, "source_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function fetchUrlText(
  url: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ title: string; text: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ExtractError("Enter a valid http:// or https:// URL.", 400, "invalid_url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ExtractError("Only http and https URLs are supported.", 400, "invalid_url");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(parsed, {
        signal: controller.signal,
        redirect: "follow",
        headers: { accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5" },
      });
    } catch (err) {
      const reason = controller.signal.aborted ? "timed out after 20 s" : (err as Error).message;
      throw new ExtractError(`Could not fetch ${parsed.href}: ${reason}`, 502, "fetch_failed");
    }
    if (!response.ok) {
      throw new ExtractError(`Could not fetch ${parsed.href}: HTTP ${response.status}`, 502, "fetch_failed");
    }
    const body = await readBodyCapped(response, controller);
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("application/pdf") || looksLikePdf(body)) {
      return { title: "", text: await extractPdfText(body) };
    }
    const raw = body.toString("utf8");
    if (contentType.includes("html") || /<html[\s>]|<body[\s>]|<\/p>|<div[\s>]/i.test(raw.slice(0, 4096))) {
      return extractTextFromHtml(raw);
    }
    return { title: "", text: collapseWhitespace(raw) };
  } finally {
    clearTimeout(timer);
  }
}

export function looksLikePdf(buffer: Uint8Array): boolean {
  return buffer.length >= 5 && Buffer.from(buffer.subarray(0, 5)).toString("latin1") === "%PDF-";
}

/** Heuristic: NUL bytes or a high share of invalid UTF-8 mean this is not a text file. */
export function looksBinary(buffer: Uint8Array): boolean {
  const sample = buffer.subarray(0, 8192);
  if (sample.includes(0)) return true;
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(sample);
  let bad = 0;
  for (const ch of decoded) if (ch === "�") bad += 1;
  return decoded.length > 0 && bad / decoded.length > 0.05;
}

export async function extractPdfText(buffer: Uint8Array): Promise<string> {
  // pdf-parse pulls in pdf.js; load it lazily so plain startup and tests stay fast.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return collapseWhitespace(result.text);
  } catch (err) {
    throw new ExtractError(`Could not read the PDF: ${(err as Error).message}`, 400, "pdf_failed");
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
