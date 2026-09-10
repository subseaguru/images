/**
 * Server entry point: reads the environment, builds the app and listens over HTTP or HTTPS.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import { DEFAULT_DATA_DIR, DEFAULT_SEED_DIR, readPackageVersion } from "./paths.js";

function envFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}

/** Generates (once) and caches a self-signed certificate that covers localhost and every LAN IP. */
async function loadOrCreateCertificate(certDir: string): Promise<{ key: string; cert: string }> {
  const keyPath = path.join(certDir, "key.pem");
  const certPath = path.join(certDir, "cert.pem");
  if (existsSync(keyPath) && existsSync(certPath)) {
    return { key: await readFile(keyPath, "utf8"), cert: await readFile(certPath, "utf8") };
  }
  const { generate } = await import("selfsigned");
  const altNames: { type: 2 | 7; value?: string; ip?: string }[] = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    ...lanAddresses().map((ip) => ({ type: 7 as const, ip })),
  ];
  const pems = await generate([{ name: "commonName", value: "localhost" }], {
    algorithm: "sha256",
    keySize: 2048,
    notAfterDate: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000),
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames },
    ],
  });
  await mkdir(certDir, { recursive: true });
  await writeFile(keyPath, pems.private, { mode: 0o600 });
  await writeFile(certPath, pems.cert);
  console.log(`Created self-signed certificate in ${certDir}`);
  return { key: pems.private, cert: pems.cert };
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  const dataDir = path.resolve(process.env.DATA_DIR ?? DEFAULT_DATA_DIR);
  const seedDir = path.resolve(process.env.SEED_DIR ?? DEFAULT_SEED_DIR);
  const useHttps = envFlag(process.env.HTTPS);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid PORT: ${process.env.PORT}`);

  const { app } = createApp({
    dataDir,
    seedDir,
    version: readPackageVersion(),
    envApiKey: process.env.ANTHROPIC_API_KEY,
  });

  const server = useHttps
    ? https.createServer(await loadOrCreateCertificate(path.join(dataDir, "cert")), app)
    : http.createServer(app);
  // Question generation can take minutes; never cut a request off for taking long.
  server.requestTimeout = 0;
  server.headersTimeout = 120_000;
  server.keepAliveTimeout = 65_000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const scheme = useHttps ? "https" : "http";
  const hosts = host === "0.0.0.0" || host === "::" ? ["localhost", ...lanAddresses()] : [host];
  console.log("NCLEX Voice Quiz is running. Open:");
  for (const h of hosts) console.log(`  ${scheme}://${h}:${actualPort}`);
  console.log(`Data directory: ${dataDir}`);
  console.log("Hint: voice answering in the browser needs a secure context - use the localhost URL or run with HTTPS=1.");

  let closing = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    console.log(`\nReceived ${signal}, shutting down.`);
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
