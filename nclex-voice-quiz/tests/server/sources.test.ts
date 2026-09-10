import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createApp } from "../../src/server/app.js";
import { PROJECT_ROOT } from "../../src/server/paths.js";
import { collapseWhitespace, decodeEntities, extractPdfText, extractTextFromHtml, fetchUrlText, looksBinary } from "../../src/server/sources/extract.js";
import type { StudySource } from "../../src/shared/types.js";

const SEED_DIR = path.join(PROJECT_ROOT, "tests", "fixtures", "seed");

async function startServer(fetchImpl?: typeof globalThis.fetch) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "nclex-sources-"));
  const { app, stores } = createApp({ dataDir, seedDir: SEED_DIR, version: "test", warn: () => undefined, fetchImpl });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    stores,
    dataDir,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

type Server = Awaited<ReturnType<typeof startServer>>;

async function call<T = unknown>(base: string, url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(base + url, init);
  return { status: res.status, body: (await res.json()) as T };
}

function postJson(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** A minimal one-page PDF with a single text run, built with a correct xref table. */
function tinyPdf(text: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    (() => {
      const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
      return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    })(),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const SAMPLE_HTML = `<!DOCTYPE html><html><head><title> Insulin &amp; Glucose  Basics </title>
<style>body { color: red }</style><script>alert("x")</script></head>
<body><nav>Home</nav><h1>Insulin   types</h1>
<p>Rapid-acting insulin peaks in 1&ndash;3 hours.&nbsp;It is given <b>15 minutes</b> before meals.</p>
<!-- a comment -->
<ul><li>Lispro</li><li>Aspart &#169;</li></ul><noscript>Enable JS</noscript>
<p>Regular insulin peaks in 2&#x2013;4 hours.</p></body></html>`;

describe("extractTextFromHtml", () => {
  it("drops script/style/noscript, decodes entities, collapses whitespace and keeps the title", () => {
    const { title, text } = extractTextFromHtml(SAMPLE_HTML);
    assert.equal(title, "Insulin & Glucose Basics");
    assert.ok(!text.includes("alert"));
    assert.ok(!text.includes("color: red"));
    assert.ok(!text.includes("Enable JS"));
    assert.ok(!text.includes("a comment"));
    assert.ok(!text.includes("<"));
    assert.ok(text.includes("Insulin types"));
    assert.ok(text.includes("Rapid-acting insulin peaks in 1–3 hours. It is given 15 minutes before meals."), text);
    assert.ok(text.includes("Lispro\nAspart ©"), text);
    assert.ok(text.includes("Regular insulin peaks in 2–4 hours."), text);
    assert.ok(!/\n{3}/.test(text));
    assert.ok(!/ {2}/.test(text));
  });

  it("helpers behave on edge cases", () => {
    assert.equal(decodeEntities("&lt;b&gt; &quot;x&quot; &#65; &unknown;"), '<b> "x" A &unknown;');
    assert.equal(collapseWhitespace("  a \t b\r\n\r\n\r\n\r\n c  "), "a b\n\nc");
    assert.equal(extractTextFromHtml("").text, "");
    assert.equal(extractTextFromHtml("plain text without tags").text, "plain text without tags");
    assert.equal(looksBinary(Buffer.from("hello\nworld")), false);
    assert.equal(looksBinary(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])), true);
  });
});

describe("fetchUrlText", () => {
  it("rejects non-http URLs and reports fetch failures", async () => {
    await assert.rejects(fetchUrlText("ftp://example.com/x"), (err: { status: number; code: string }) => err.status === 400 && err.code === "invalid_url");
    await assert.rejects(fetchUrlText("not a url"), (err: { code: string }) => err.code === "invalid_url");
    const failing: typeof globalThis.fetch = async () => new Response("nope", { status: 500 });
    await assert.rejects(fetchUrlText("https://example.com/page", failing), (err: { status: number; code: string }) => err.status === 502 && err.code === "fetch_failed");
    const throwing: typeof globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    await assert.rejects(fetchUrlText("https://example.com/page", throwing), (err: { message: string }) => err.message.includes("ECONNREFUSED"));
  });

  it("extracts HTML pages and plain text", async () => {
    const html: typeof globalThis.fetch = async () => new Response(SAMPLE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    const page = await fetchUrlText("https://example.com/insulin", html);
    assert.equal(page.title, "Insulin & Glucose Basics");
    assert.ok(page.text.includes("Lispro"));
    const plain: typeof globalThis.fetch = async () => new Response("just   text\n\n\n\nmore", { headers: { "content-type": "text/plain" } });
    assert.deepEqual(await fetchUrlText("http://example.com/notes.txt", plain), { title: "", text: "just text\n\nmore" });
  });

  it("caps the body at 10 MB", async () => {
    const huge: typeof globalThis.fetch = async () => new Response("x", { headers: { "content-length": String(11 * 1024 * 1024) } });
    await assert.rejects(fetchUrlText("https://example.com/big", huge), (err: { status: number }) => err.status === 413);
  });
});

describe("/api/sources", () => {
  let s: Server;
  let created: StudySource;
  const fakeFetch: typeof globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/insulin")) return new Response(SAMPLE_HTML, { headers: { "content-type": "text/html" } });
    return new Response("missing", { status: 404 });
  };
  before(async () => {
    s = await startServer(fakeFetch);
  });
  after(() => s.close());

  it("starts empty", async () => {
    const { status, body } = await call<{ sources: StudySource[] }>(s.base, "/api/sources");
    assert.equal(status, 200);
    assert.deepEqual(body, { sources: [] });
  });

  it("adds pasted text and returns it with a preview", async () => {
    const text = "Potassium normal range is 3.5 to 5.0 mEq/L. ".repeat(10);
    const { status, body } = await call<StudySource>(s.base, "/api/sources", postJson({ name: "  Lab values  ", text }));
    assert.equal(status, 201);
    created = body;
    assert.match(body.id, /^src-[a-z0-9]+-[a-z0-9]+$/);
    assert.equal(body.name, "Lab values");
    assert.equal(body.kind, "text");
    assert.equal(body.chars, text.trim().length);
    assert.equal(body.preview.length, 200);
    assert.ok(!Number.isNaN(Date.parse(body.addedAt)));

    const full = await call<{ source: StudySource; text: string }>(s.base, `/api/sources/${body.id}`);
    assert.equal(full.status, 200);
    assert.deepEqual(full.body.source, body);
    assert.equal(full.body.text, text.trim());

    // The text file is named after the id, never after the user-supplied name.
    const files = await readdir(path.join(s.dataDir, "sources"));
    assert.ok(files.includes(`${body.id}.txt`));
    assert.ok(files.includes("index.json"));
  });

  it("validates text sources", async () => {
    const noName = await call<{ code: string }>(s.base, "/api/sources", postJson({ text: "abc" }));
    assert.equal(noName.status, 400);
    assert.equal(noName.body.code, "missing_name");
    const noText = await call<{ code: string }>(s.base, "/api/sources", postJson({ name: "x", text: "   " }));
    assert.equal(noText.status, 400);
    assert.equal(noText.body.code, "missing_text");
  });

  it("adds a URL source using the page title", async () => {
    const { status, body } = await call<StudySource>(s.base, "/api/sources/url", postJson({ url: "https://example.com/insulin" }));
    assert.equal(status, 201);
    assert.equal(body.kind, "url");
    assert.equal(body.name, "Insulin & Glucose Basics");
    assert.equal(body.url, "https://example.com/insulin");
    const full = await call<{ text: string }>(s.base, `/api/sources/${body.id}`);
    assert.ok(full.body.text.includes("Lispro"));

    const bad = await call<{ code: string }>(s.base, "/api/sources/url", postJson({ url: "file:///etc/passwd" }));
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, "invalid_url");
    const missing = await call<{ code: string }>(s.base, "/api/sources/url", postJson({ url: "https://example.com/missing" }));
    assert.equal(missing.status, 502);
    assert.equal(missing.body.code, "fetch_failed");
  });

  it("uploads a .txt file as a raw body", async () => {
    const res = await fetch(s.base + "/api/sources/upload?name=notes.txt", {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: "Digoxin toxicity: nausea, visual halos, bradycardia.\n",
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as StudySource;
    assert.equal(body.kind, "file");
    assert.equal(body.name, "notes.txt");
    assert.equal(body.chars, "Digoxin toxicity: nausea, visual halos, bradycardia.".length);
  });

  it("strips HTML uploads and lists newest first", async () => {
    const res = await fetch(s.base + "/api/sources/upload?name=page.html", { method: "PUT", headers: { "content-type": "text/html" }, body: SAMPLE_HTML });
    assert.equal(res.status, 201);
    const body = (await res.json()) as StudySource;
    assert.ok(!body.preview.includes("<"));
    const list = await call<{ sources: StudySource[] }>(s.base, "/api/sources");
    assert.equal(list.body.sources.length, 4);
    assert.equal(list.body.sources[0]?.id, body.id);
    assert.equal(list.body.sources[3]?.id, created.id);
  });

  it("extracts text from PDF uploads", async () => {
    const res = await fetch(s.base + "/api/sources/upload?name=guide.pdf", { method: "PUT", headers: { "content-type": "application/pdf" }, body: new Uint8Array(tinyPdf("Hello NCLEX from PDF")) });
    assert.equal(res.status, 201, await res.text().catch(() => ""));
    const body = (await res.json()) as StudySource;
    assert.ok(body.preview.includes("Hello NCLEX from PDF"), body.preview);
    assert.ok((await extractPdfText(tinyPdf("Second check"))).includes("Second check"));
  });

  it("rejects unsupported binary uploads with 415 and empty uploads with 400", async () => {
    const docx = await fetch(s.base + "/api/sources/upload?name=study.docx", { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]) });
    assert.equal(docx.status, 415);
    assert.equal(((await docx.json()) as { code: string }).code, "unsupported_file_type");
    const sneaky = await fetch(s.base + "/api/sources/upload?name=looks-like-text.txt", { method: "PUT", body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]) });
    assert.equal(sneaky.status, 415);
    const empty = await fetch(s.base + "/api/sources/upload?name=empty.txt", { method: "PUT", headers: { "content-type": "text/plain" }, body: "" });
    assert.equal(empty.status, 400);
  });

  it("deletes sources and 404s afterwards", async () => {
    const del = await call<{ ok: boolean }>(s.base, `/api/sources/${created.id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.deepEqual(del.body, { ok: true });
    const gone = await call<{ code: string }>(s.base, `/api/sources/${created.id}`);
    assert.equal(gone.status, 404);
    assert.equal(gone.body.code, "source_not_found");
    const again = await call(s.base, `/api/sources/${created.id}`, { method: "DELETE" });
    assert.equal(again.status, 404);
    const files = await readdir(path.join(s.dataDir, "sources"));
    assert.ok(!files.includes(`${created.id}.txt`));
    const traversal = await call(s.base, "/api/sources/..%2F..%2Fsettings.json");
    assert.equal(traversal.status, 404);
  });
});
