import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { getFiletypeFromFileName } from "@pierre/diffs";
import { bundledLanguagesInfo } from "shiki/langs";
import type { Changes, Rev } from "./changes.js";
import { readSourceReference } from "./definitions.js";
import { DiffmapExportError } from "./errors.js";
import { extractTitle } from "./extractDocument.js";
import {
  collectFences,
  parseViewerDocument,
  type ViewerDocument,
  type ViewerNode,
} from "./parseViewer.js";
import { snapshotDocument } from "./snapshot.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

export type ExportSnapshot = {
  title: string;
  document: ViewerDocument;
  changes: Record<Rev, Changes>;
  files: Record<string, string>;
};

/** Write one offline HTML viewer. Existing files are never overwritten. */
export async function exportMarkdownFile(input: {
  filePath: string;
  workspaceRoot: string;
  outputPath?: string;
}) {
  try {
    const filePath = path.resolve(input.filePath);
    const root = path.resolve(input.workspaceRoot);
    const outputPath =
      input.outputPath === undefined
        ? filePath.replace(/\.[^/.]+$/, "") + ".html"
        : path.resolve(input.outputPath);
    if (path.extname(outputPath).toLowerCase() !== ".html")
      throw new Error("The output path must end in .html.");
    // Check before doing an expensive build; wx below also protects against races.
    if (
      await fs.stat(outputPath).then(
        () => true,
        () => false,
      )
    )
      throw new Error(`Output already exists: ${outputPath}`);
    const source = await fs.readFile(filePath, "utf8");
    const document = parseViewerDocument(source, filePath);
    if (document instanceof Error) return document;
    if (collectFences(document.nodes).some((fence) => fence.kind === "html"))
      throw new Error(
        "Raw HTML is not supported in offline exports. Use Markdown instead.",
      );
    await prepareNodes(document.nodes, filePath, root);
    // These reference objects are shared with the document's stacks and diagrams.
    // Resolve with the same TypeScript service as the local viewer, then freeze lines.
    for (const reference of document.references) {
      if (reference.kind !== "file" || reference.rev !== undefined) continue;
      const params = new URLSearchParams({ path: reference.path });
      if (reference.symbol !== undefined)
        params.set("symbol", reference.symbol);
      if (reference.start !== undefined)
        params.set("start", String(reference.start));
      if (reference.end !== undefined) params.set("end", String(reference.end));
      const resolved = readSourceReference(root, params);
      if (resolved instanceof Error) return resolved;
      delete reference.symbol;
      reference.start = resolved.start;
      reference.end = resolved.end;
    }
    const captured = await snapshotDocument(root, document);
    if (captured instanceof Error) return captured;
    const snapshot: ExportSnapshot = {
      title: extractTitle(source),
      document,
      ...captured,
    };
    const html = await bundleHtml(snapshot);
    await fs.writeFile(outputPath, html, { flag: "wx" });
    return { file: outputPath, bytes: Buffer.byteLength(html) };
  } catch (cause) {
    return new DiffmapExportError({
      reason:
        cause instanceof Error
          ? cause.message
          : "Could not export the document.",
      cause,
    });
  }
}

const imageTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
};

async function prepareNodes(
  nodes: ViewerNode[],
  filePath: string,
  root: string,
): Promise<void> {
  for (const node of nodes) {
    if (node.type === "html")
      throw new Error(
        "Raw HTML is not supported in offline exports. Use Markdown instead.",
      );
    if (node.type !== "element") continue;
    if (node.tag === "img" && node.attrs.src !== undefined) {
      const src = node.attrs.src;
      if (
        !/^data:image\/(?:png|jpeg|gif|webp|avif|x-icon);base64,[a-z0-9+/=\s]+$/i.test(
          src,
        )
      ) {
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src))
          throw new Error(
            `Image ${src} cannot be embedded. Use a local PNG, JPEG, GIF, WebP, AVIF, or ICO image.`,
          );
        const imagePath = await fs.realpath(
          path.resolve(path.dirname(filePath), decodeURIComponent(src)),
        );
        const relative = path.relative(await fs.realpath(root), imagePath);
        if (
          relative.startsWith(`..${path.sep}`) ||
          relative === ".." ||
          path.isAbsolute(relative)
        )
          throw new Error(`Image ${src} escapes the workspace.`);
        const mime = imageTypes[path.extname(imagePath).toLowerCase()];
        if (mime === undefined)
          throw new Error(
            `Unsupported image ${src}. Use PNG, JPEG, GIF, WebP, AVIF, or ICO.`,
          );
        node.attrs.src = `data:${mime};base64,${(await fs.readFile(imagePath)).toString("base64")}`;
      }
    }
    await prepareNodes(node.children, filePath, root);
  }
}

async function bundleHtml(snapshot: ExportSnapshot) {
  const virtualId = "\0virtual:diffmap-export";
  const languagesId = "\0diffmap-export-languages";
  const built = await build({
    configFile: false,
    root: packageRoot,
    publicDir: false,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      react(),
      {
        name: "diffmap-export",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:diffmap-export") return virtualId;
          if (id === "shiki/langs") return languagesId;
        },
        load(id) {
          if (id === virtualId)
            return `export const snapshot = ${JSON.stringify(snapshot)};`;
          if (id === languagesId) return snapshotLanguages(snapshot);
        },
      },
    ],
    resolve: { dedupe: ["react", "react-dom", "purse-styles"] },
    build: {
      write: false,
      cssCodeSplit: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      lib: {
        entry: path.join(packageRoot, "src/export/main.tsx"),
        name: "DiffmapExport",
        formats: ["iife"],
      },
    },
  });
  const outputs = Array.isArray(built) ? built : [built];
  let js = "";
  let css = "";
  for (const result of outputs) {
    if (!("output" in result))
      throw new Error("Expected an in-memory viewer build.");
    for (const entry of result.output) {
      if (entry.type === "chunk") js += entry.code;
      else if (entry.fileName.endsWith(".css")) css += String(entry.source);
      else
        throw new Error(
          `The viewer requires an external asset: ${entry.fileName}`,
        );
    }
  }
  const template = await fs.readFile(
    path.join(packageRoot, "index.html"),
    "utf8",
  );
  // Script/style raw-text elements must not be closed by embedded document contents.
  // Escape closing tags and the HTML comment opener without changing JS strings.
  const script = js
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--");
  const styles = css.replace(/<\/style/gi, "<\\/style");
  return template
    .replace(
      "<title>diffmap</title>",
      () => `<title>${escapeHtml(snapshot.title)}</title>`,
    )
    .replace("</head>", () => `<style>${styles}</style></head>`)
    .replace(
      '<script type="module" src="/src/viewer/main.tsx"></script>',
      () => `<script>${script}</script>`,
    );
}

/** Only these immutable sources can be opened, so other grammars are unnecessary. */
function snapshotLanguages(snapshot: ExportSnapshot) {
  const languages = new Set<string>();
  const files = new Set(Object.keys(snapshot.files));
  for (const changes of Object.values(snapshot.changes)) {
    for (const file of changes.files) {
      files.add(file.path);
      if (file.prevPath !== undefined) files.add(file.prevPath);
    }
  }
  for (const fence of collectFences(snapshot.document.nodes)) {
    if (fence.kind === "code") languages.add(fence.lang);
    if (fence.kind === "diff" && fence.path !== undefined)
      files.add(fence.path);
  }
  for (const file of files) languages.add(getFiletypeFromFileName(file));
  const entries = bundledLanguagesInfo.flatMap((language) => {
    const names = [language.id, ...(language.aliases ?? [])];
    if (!names.some((name) => languages.has(name))) return [];
    return names.map(
      (name) =>
        `${JSON.stringify(name)}: () => import(${JSON.stringify(`shiki/langs/${language.id}.mjs`)})`,
    );
  });
  return `export const bundledLanguages = {${entries.join(",")}};`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
