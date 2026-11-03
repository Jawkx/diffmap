import { readSourceReference } from "./definitions.js";
import { readChanges, readDocumentChanges } from "./git.js";
import { collectFences, type ViewerDocument } from "./parseViewer.js";

/** Capture the sources a viewer needs when it has no filesystem or Git. */
export async function snapshotDocument(root: string, document: ViewerDocument) {
  const changes = await readDocumentChanges(root, document);
  if (changes instanceof Error) return changes;
  for (const { rev } of document.changeCards) {
    if (changes.has(rev)) continue;
    const loaded = await readChanges(root, rev);
    if (loaded instanceof Error) return loaded;
    changes.set(rev, loaded);
  }
  const paths = new Set<string>();
  for (const reference of document.references) {
    if (reference.kind === "file" && reference.rev === undefined)
      paths.add(reference.path);
  }
  for (const fence of collectFences(document.nodes)) {
    if (fence.kind === "file") paths.add(fence.path);
  }
  const files: Record<string, string> = Object.create(null);
  for (const filePath of paths) {
    const read = readSourceReference(
      root,
      new URLSearchParams({ path: filePath }),
    );
    if (read instanceof Error) return read;
    files[filePath] = read.contents;
  }
  return { changes: Object.fromEntries(changes), files };
}
