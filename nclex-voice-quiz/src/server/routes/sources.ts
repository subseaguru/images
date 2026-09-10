import path from "node:path";
import express, { Router } from "express";
import type { StudySource } from "../../shared/types.js";
import { extractPdfText, extractTextFromHtml, fetchUrlText, looksBinary, looksLikePdf } from "../sources/extract.js";
import type { SourceStore } from "../sources/store.js";
import { badRequest, bodyObject, HttpError, notFound, queryString, requiredString } from "./http.js";

export const UPLOAD_LIMIT = "25mb";
export const MAX_SOURCE_CHARS = 2_000_000;

/** Well-known binary document/archive/media formats we cannot turn into text. */
const BINARY_EXTENSIONS = new Set([
  ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".odt", ".odp", ".ods", ".rtf", ".pages", ".key",
  ".zip", ".gz", ".tar", ".7z", ".rar", ".epub", ".mobi",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".svg",
  ".mp3", ".mp4", ".m4a", ".mov", ".avi", ".wav", ".exe", ".dll", ".bin", ".dmg", ".iso",
]);

function unsupported(name: string): HttpError {
  return new HttpError(
    415,
    `${name} is not a supported format. Upload a .txt, .md, .csv, .html or .pdf file.`,
    "unsupported_file_type",
  );
}

export function sourcesRouter(deps: { sources: SourceStore; fetchImpl?: typeof globalThis.fetch }): Router {
  const router = Router();
  const { sources } = deps;

  function checkLength(text: string): string {
    if (!text) throw badRequest("No text could be extracted from that source.", "empty_source");
    if (text.length > MAX_SOURCE_CHARS) {
      throw new HttpError(413, `The source is too long (max ${MAX_SOURCE_CHARS} characters).`, "source_too_large");
    }
    return text;
  }

  router.get("/sources", (_req, res) => {
    res.json({ sources: sources.list() });
  });

  router.post("/sources", async (req, res) => {
    const body = bodyObject(req);
    const name = requiredString(body.name, "name", 300);
    const text = checkLength(requiredString(body.text, "text", MAX_SOURCE_CHARS));
    const source: StudySource = await sources.add({ name, kind: "text", text });
    res.status(201).json(source);
  });

  router.post("/sources/url", async (req, res) => {
    const body = bodyObject(req);
    const url = requiredString(body.url, "url", 2000);
    const fetched = await fetchUrlText(url, deps.fetchImpl);
    const text = checkLength(fetched.text);
    const source = await sources.add({ name: fetched.title || url, kind: "url", text, url });
    res.status(201).json(source);
  });

  router.put(
    "/sources/upload",
    express.raw({ type: () => true, limit: UPLOAD_LIMIT }),
    async (req, res) => {
      const name = (queryString(req.query.name) ?? "").trim() || "upload.txt";
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest("The uploaded file is empty.", "empty_upload");
      const ext = path.extname(name).toLowerCase();
      let text: string;
      if (ext === ".pdf" || looksLikePdf(body)) {
        text = await extractPdfText(body);
      } else if (BINARY_EXTENSIONS.has(ext) || looksBinary(body)) {
        throw unsupported(name);
      } else {
        const raw = body.toString("utf8");
        text = ext === ".html" || ext === ".htm" || ext === ".xhtml" ? extractTextFromHtml(raw).text : raw;
      }
      const source = await sources.add({ name, kind: "file", text: checkLength(text.trim()) });
      res.status(201).json(source);
    },
  );

  router.get("/sources/:id", async (req, res) => {
    const found = await sources.get(String(req.params.id));
    if (!found) throw notFound("Study source not found.", "source_not_found");
    res.json(found);
  });

  router.delete("/sources/:id", async (req, res) => {
    const deleted = await sources.delete(String(req.params.id));
    if (!deleted) throw notFound("Study source not found.", "source_not_found");
    res.json({ ok: true });
  });

  return router;
}
