import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { chromium } from "playwright-core";
import { exportMarkdownFile } from "./export.js";

const exec = promisify(execFile);

test(
  "export captures a walkthrough in one movable HTML file",
  { timeout: 120_000 },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "diffmap-export-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const root = path.join(dir, "repo");
    await fs.mkdir(root);
    const git = (...args: string[]) => exec("git", args, { cwd: root });
    await git("init", "--quiet");
    await git("config", "user.name", "Diffmap test");
    await git("config", "user.email", "diffmap@example.test");
    const old = 'export function greet() {\n  return "before export";\n}\n';
    const next =
      'export function greet() {\n  return "captured source";\n}\n// </script><script>globalThis.exportEscaped = true</script>\n// <!-- <script> another closing tag </script>\n';
    await fs.writeFile(path.join(root, "source.ts"), old);
    await fs.writeFile(
      path.join(root, "tsconfig.json"),
      '{"compilerOptions":{"target":"esnext"},"include":["*.ts"]}',
    );
    await git("add", ".");
    await git("commit", "--quiet", "-m", "Before");
    await fs.writeFile(path.join(root, "source.ts"), next);
    await git("add", ".");
    await git("commit", "--quiet", "-m", "Capture source");
    const sha = (await git("rev-parse", "HEAD")).stdout.trim();
    await fs.writeFile(
      path.join(root, "source.ts"),
      next.replace("captured source", "captured workspace") +
        "// uncommitted snapshot\n",
    );
    await fs.writeFile(
      path.join(root, "pixel.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const markdown = [
      "# Offline export $&",
      "## Source",
      "Open [[source.ts#greet]].",
      "```callstack",
      " greet() [[source.ts#greet]]",
      "```",
      "```1:3:source.ts",
      "fallback excerpt",
      "```",
      "## Diagram",
      "```mermaid [Offline flow]",
      "flowchart LR",
      " A[Start] --> B[greet]",
      " %% ref node:B [[source.ts#greet]]",
      "```",
      "## Animation",
      "```services",
      "service Client",
      "service API [[source.ts#greet]]",
      "  state requests = 0",
      'start "Ready offline"',
      'step "Request captured"',
      "  Client -> API: greet",
      "  API.requests = 1",
      "```",
      "## Code",
      "```ts",
      'const dangerous = "</script><script>globalThis.exportEscaped = true</script>";',
      'const comment = "<!-- <script> another closing tag </script>";',
      "```",
      "![Embedded pixel](pixel.png)",
      "## Committed changes",
      `Open [[${sha}:source.ts#L1-L3]].`,
      "```changes",
      sha,
      "source.ts",
      "```",
      "## Working changes",
      "```changes",
      "",
      "source.ts",
      "```",
    ].join("\n");
    const filePath = path.join(root, "spec.md");
    await fs.writeFile(filePath, markdown);
    const exported = await exportMarkdownFile({
      filePath,
      workspaceRoot: root,
      outputPath: path.join(dir, "review.html"),
    });
    if (exported instanceof Error) throw exported;
    const html = await fs.readFile(exported.file, "utf8");
    assert.equal(Buffer.byteLength(html), exported.bytes);
    assert.match(html, /<title>Offline export \$&amp;<\/title>/);
    assert.doesNotMatch(html, /<script[^>]+src=/);
    assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/);
    assert.equal((html.match(/<\/script/gi) ?? []).length, 2);
    assert.match(html, /data:image\/png;base64,/);
    assert.match(html, /captured source/);
    assert.match(html, /uncommitted snapshot/);
    assert.match(html, /before export/);
    const overwrite = await exportMarkdownFile({
      filePath,
      workspaceRoot: root,
      outputPath: exported.file,
    });
    assert.ok(overwrite instanceof Error);
    assert.match(overwrite.message, /already exists/);
    // Delete Git, the Markdown, and its assets. Only the relocated HTML survives.
    await fs.rm(root, { recursive: true });
    const moved = path.join(dir, "moved.html");
    await fs.rename(exported.file, moved);

    await t.test(
      "opens directly from disk without any external requests",
      {
        skip: !process.env.DIFFMAP_TEST_BROWSER,
        timeout: 45_000,
      },
      async () => {
        const browser = await chromium.launch({
          executablePath: process.env.DIFFMAP_TEST_BROWSER,
        });
        try {
          const context = await browser.newContext({
            offline: true,
            viewport: { width: 1440, height: 1000 },
            reducedMotion: "reduce",
          });
          const page = await context.newPage();
          page.setDefaultTimeout(10_000);
          const errors: string[] = [];
          const requests: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
          });
          page.on("request", (request) => requests.push(request.url()));
          await page.goto(pathToFileURL(moved).href);
          await page
            .getByRole("heading", { name: "Offline export $&", exact: true })
            .waitFor();
          await page.locator('[data-diffmap-kind="mermaid"] svg').waitFor();
          await page.waitForFunction(() =>
            [...document.images].every(
              (image) => image.complete && image.naturalWidth > 0,
            ),
          );
          await page.waitForFunction(
            () =>
              document.querySelector(
                '[data-diffmap-kind="code"] span[style*="color"]',
              ) !== null,
          );
          assert.equal(
            await page.evaluate(() => "exportEscaped" in globalThis),
            false,
          );
          assert.equal(
            await page.getByRole("button", { name: "Close server" }).count(),
            0,
          );
          await page
            .getByRole("button", { name: "Next step", exact: true })
            .click();
          await page.getByText("Request captured", { exact: true }).waitFor();
          await page
            .locator('[data-diffmap-kind="mermaid"] [data-source-index]')
            .click();
          await page.locator("aside diffs-container").first().waitFor();
          await page.waitForFunction(() =>
            [...document.querySelectorAll("aside diffs-container")].some(
              (node) =>
                node.shadowRoot?.textContent?.includes("captured workspace"),
            ),
          );
          assert.match(
            await page.locator("aside").last().innerText(),
            /source.ts/,
          );
          await page
            .locator('[data-diffmap-kind="page"] button')
            .filter({ hasText: "Review" })
            .first()
            .click();
          await page.waitForFunction(() =>
            [...document.querySelectorAll("aside diffs-container")].some(
              (node) => node.shadowRoot?.textContent?.includes("before export"),
            ),
          );
          await page.emulateMedia({ colorScheme: "dark" });
          await page.waitForFunction(
            () => document.documentElement.dataset.theme === "dark",
          );
          await page.emulateMedia({ colorScheme: "light" });
          await page.waitForFunction(
            () => document.documentElement.dataset.theme === "light",
          );
          // Comments stay with the reader; their download must work without clipboard access.
          await page.evaluate(() => {
            localStorage.setItem(
              `diffmap-comments:${window.location.pathname}`,
              JSON.stringify([
                {
                  id: "offline-comment",
                  body: "Review feedback",
                  anchor: {
                    kind: "text",
                    quote: "Open",
                    prefix: "",
                    suffix: "",
                    offset: 0,
                    display: "Open",
                    section: "Source",
                  },
                },
              ]),
            );
          });
          await page.reload();
          const downloading = page.waitForEvent("download");
          await page.getByRole("button", { name: /Download comments/ }).click();
          const download = await downloading;
          assert.equal(download.suggestedFilename(), "diffmap-comments.md");
          const downloaded = await download.path();
          assert.ok(downloaded);
          assert.match(
            await fs.readFile(downloaded, "utf8"),
            /Review feedback/,
          );
          assert.deepEqual(errors, []);
          assert.deepEqual(
            requests.filter(
              (url) =>
                url !== pathToFileURL(moved).href && !url.startsWith("data:"),
            ),
            [],
          );
        } finally {
          await browser.close();
        }
      },
    );
  },
);

test("export reports unsupported or missing dependencies without writing a file", async (t) => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "diffmap-export-errors-"),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "spec.md");
  const output = path.join(dir, "spec.html");
  for (const [source, error] of [
    ["# Test\n![Remote](https://example.test/image.png)", /local PNG/],
    ["# Test\n![Missing](missing.png)", /ENOENT/],
    ["# Test\n<div>Raw HTML</div>", /Raw HTML/],
    ["# Test\n```html\n<div>Raw HTML</div>\n```", /Raw HTML/],
    ["# Test\n[[missing.ts#symbol]]", /Could not read/],
    ["# Test\n```changes\nabcdef0\n```", /git|repository/i],
  ] as const) {
    await fs.writeFile(filePath, source);
    const result = await exportMarkdownFile({ filePath, workspaceRoot: dir });
    assert.ok(result instanceof Error, source);
    assert.match(result.message, error);
    await assert.rejects(fs.stat(output));
  }
  await fs.writeFile(
    path.join(dir, "source.ts"),
    "export const present = 1;\n",
  );
  await fs.writeFile(filePath, "# Test\n[[source.ts#missing]]");
  const missing = await exportMarkdownFile({ filePath, workspaceRoot: dir });
  assert.ok(missing instanceof Error);
  assert.match(missing.message, /missing.*not found/);
  await fs.writeFile(filePath, "# Test\n[[source.ts#L99-L100]]");
  const range = await exportMarkdownFile({ filePath, workspaceRoot: dir });
  assert.ok(range instanceof Error);
  assert.match(range.message, /Invalid line range/);
});
