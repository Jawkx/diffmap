import { useEffect, useState } from "react";
import { Button, buttonStyles, Check, colors, Copy, Download } from "maui";
import { style, useStyles } from "purse-styles";
import { formatComments, useComments } from "./comments.ts";
import { useViewerMode } from "./viewerMode.ts";

/** Copies every comment as Markdown to paste to an agent. Hidden until there is one. */
export function CopyCommentsButton(props: {
  title: string;
  source: string | undefined;
}) {
  const { comments } = useComments();
  const offline = useViewerMode() === "export";
  const [copied, setCopied] = useState(false);
  const count = useStyles(buttonStyles.label, countStyle);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  if (comments.length === 0) return undefined;
  return (
    <Button
      onPress={() => {
        const markdown = formatComments({
          title: props.title,
          source: props.source,
          comments,
        });
        if (offline) {
          const url = URL.createObjectURL(
            new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = "diffmap-comments.md";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          return;
        }
        // oxlint-disable-next-line typescript/no-floating-promises -- Press handlers cannot await; the label only changes once the write succeeds.
        void navigator.clipboard.writeText(markdown).then(
          () => setCopied(true),
          (cause) => console.warn("diffmap copy failed", cause),
        );
      }}
    >
      {offline ? (
        <Download size="sm" />
      ) : copied ? (
        <Check size="sm" />
      ) : (
        <Copy size="sm" />
      )}
      {offline ? "Download comments" : copied ? "Copied" : "Copy comments"}
      <span className={count}>{comments.length}</span>
    </Button>
  );
}

const countStyle = style({
  color: colors.gray[11],
  fontVariantNumeric: "tabular-nums",
});
