# Self-contained HTML export

`diffmap export spec.md --output review.html` captures a walkthrough in one
file. A recipient opens it directly in a browser, without installing Diffmap,
running a server, or connecting to GitHub.

## Scope

Keep the existing interactive viewer: diagrams, service animations, source
links, excerpts, change cards, theme controls, and code highlighting. Capture
only the files and revisions the document uses. Changes in the working tree
become a fixed snapshot. Arbitrary Git ranges and token definition navigation
remain local-viewer features.

The first version embeds local raster images. Remote images, SVG images, and
raw HTML produce an export error so the resulting file has no hidden resource
dependencies. Ordinary external links remain links. Existing output files are
never overwritten.

## ✅ Phase 1: Capture document dependencies

Gist sharing previously collected Git changes and referenced files inside its
upload function. The shared snapshot collector is now [[e2cbb37:src/snapshot.ts#L6-L33]] so
sharing and export use the same snapshot behavior.

[[e2cbb37:src/export.ts#L30-L95]] parses the Markdown at export time and
resolves source symbols to line ranges using the local TypeScript resolver.
The exported viewer does not need a Markdown parser or a TypeScript service.

```changes
e2cbb37
src/cli.ts
src/export.ts
src/snapshot.ts
src/share.ts
```

## ✅ Phase 2: Package the viewer

The export bundles [[e2cbb37:src/export/main.tsx]] and the snapshot into one inline script with
inline styles. The existing file and changes contexts supply source
panels without requests. An export viewer mode hides local server controls
and keeps the revision selection limited to document links and change cards.

The generated HTML safely contains source text such as closing script tags.
Only syntax grammars used by the captured document and files are bundled.
Beautiful Mermaid's Google Fonts imports are removed in export mode, so
diagrams use the existing system fonts without requests.

```changes
e2cbb37
src/export.ts
src/export/main.tsx
src/viewer/ViewerApp.tsx
src/viewer/MermaidBlock.tsx
src/viewer/CopyCommentsButton.tsx
```

## ✅ Phase 3: Verify offline behavior

[[e2cbb37:src/export.test.ts]] exports a fixture with a symbol reference, excerpt,
Mermaid diagram, service diagram, local image, code block, and captured Git
changes. It deletes the source repository and moves the HTML before opening
it via `file://` with networking disabled. The Chromium check covers source
selection, switching between workspace and committed diffs, diagram interaction,
theme switching, syntax highlighting, comment downloads, and zero external
requests. Other tests cover missing resources, invalid symbols, and safe
embedding of HTML-like source text.

The shared diff panel remounts its code viewer when its revision changes.
Pierre caches items by file id and version, so retaining the viewer previously
showed stale contents when the same file appeared in two revisions.

Browser comments are local to the reader and do not modify the HTML file.
The export offers a Markdown download for feedback. Durable
comment exchange and exports containing arbitrary HTML are separate work.

```changes
e2cbb37
src/export.test.ts
src/viewer/SourceDiffPanel.tsx
fixtures/offline-export.md
```

## References

- [[e2cbb37:src/share.ts#L21-L87]]
- [[e2cbb37:src/viewer/ViewerApp.tsx#L39-L222]]
- [[src/viewer/changesSource.ts]]
- [[src/viewer/sourceNavigation.ts]]
