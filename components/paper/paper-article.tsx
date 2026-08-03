import Image from "next/image";
import type { ReactNode } from "react";

type PaperArticleProps = {
  markdown: string;
};

type Block =
  | { type: "heading"; level: 1 | 2; text: string }
  | { type: "image"; alt: string; src: string }
  | { type: "paragraph"; text: string; lead: boolean }
  | { type: "quote"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; text: string }
  | { type: "rule" };

export function PaperArticle({ markdown }: PaperArticleProps) {
  const blocks = parseMarkdown(markdown).filter(
    (block) =>
      block.type !== "image" ||
      !block.src.includes("paper-loop-graph-engineering-cover")
  );

  return (
    <article className="paper-article">
      <header className="paper-article__header">
        <h1 className="sr-only">
          Loop Graph Engineering: The Operating System for AI-Run Companies
        </h1>
        <Image
          alt="Loop Graph Engineering: The Operating System for AI-Run Companies"
          className="paper-article__cover"
          height={900}
          priority
          sizes="(max-width: 1024px) 100vw, 1024px"
          src="/paper/paper-loop-graph-engineering-cover-v3.png"
          width={1600}
        />
        <p>
          How Hermes turns company signals into decisions—and Loopgraph turns
          those decisions into governed, measurable operations.
        </p>
        <div className="paper-article__meta">
          <span>Loopgraph</span>
          <span aria-hidden="true">·</span>
          <span>August 2026</span>
          <span aria-hidden="true">·</span>
          <span>18 min read</span>
        </div>
      </header>

      <div className="paper-article__body">
        {blocks.map((block, index) => renderBlock(block, index))}
      </div>

      <footer className="paper-article__footer">
        <p>
          The future company will not be one enormous agent. It will be a
          living graph of governed loops.
        </p>
        <a
          href="https://github.com/mrrkrieg/loopgraph"
          rel="noreferrer"
          target="_blank"
        >
          Review Loopgraph on GitHub
          <span aria-hidden="true">↗</span>
        </a>
      </footer>
    </article>
  );
}

function renderBlock(block: Block, index: number) {
  switch (block.type) {
    case "heading":
      if (block.level === 1) {
        return null;
      }
      return (
        <h2
          className={
            block.text === "Architecture note"
              ? "paper-article__note-heading"
              : undefined
          }
          key={index}
        >
          {renderInline(block.text)}
        </h2>
      );
    case "image":
      return (
        <figure className="paper-article__figure" key={index}>
          <Image
            alt={block.alt}
            height={900}
            sizes="(max-width: 640px) 672px, (max-width: 1024px) 100vw, 960px"
            src={block.src}
            width={1600}
          />
          <figcaption>{block.alt}</figcaption>
        </figure>
      );
    case "paragraph":
      return (
        <p className={block.lead ? "paper-article__lead" : undefined} key={index}>
          {renderInline(block.text)}
        </p>
      );
    case "quote":
      return (
        <blockquote key={index}>
          <p>{renderInline(block.text)}</p>
        </blockquote>
      );
    case "list":
      return (
        <ul key={index}>
          {block.items.map((item) => (
            <li key={item}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case "code":
      return (
        <pre key={index}>
          <code>{block.text}</code>
        </pre>
      );
    case "rule":
      return <hr key={index} />;
  }
}

function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: Block[] = [];
  let paragraphCount = 0;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();

    if (!line) {
      index += 1;
      continue;
    }

    if (line === "---") {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (line.startsWith("# ")) {
      blocks.push({ type: "heading", level: 1, text: line.slice(2) });
      index += 1;
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push({ type: "heading", level: 2, text: line.slice(3) });
      index += 1;
      continue;
    }

    const imageMatch = line.match(/^!\[(.+?)\]\((.+?)\)$/);
    if (imageMatch) {
      blocks.push({
        type: "image",
        alt: imageMatch[1],
        src: `/paper/${imageMatch[2].split("/").pop()}`
      });
      index += 1;
      continue;
    }

    if (line.startsWith("> ")) {
      blocks.push({ type: "quote", text: line.slice(2) });
      index += 1;
      continue;
    }

    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("- ")) {
        items.push(lines[index].trim().slice(2));
        index += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    if (line.startsWith("`") && line.endsWith("`")) {
      blocks.push({ type: "code", text: line.slice(1, -1) });
      index += 1;
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (
        !next ||
        next === "---" ||
        next.startsWith("# ") ||
        next.startsWith("## ") ||
        next.startsWith("![") ||
        next.startsWith("> ") ||
        next.startsWith("- ") ||
        (next.startsWith("`") && next.endsWith("`"))
      ) {
        break;
      }
      paragraphLines.push(next);
      index += 1;
    }

    paragraphCount += 1;
    blocks.push({
      type: "paragraph",
      text: paragraphLines.join(" "),
      lead: paragraphCount <= 5
    });
  }

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={index}>{part.slice(1, -1)}</code>;
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return <em key={index}>{part.slice(1, -1)}</em>;
      }
      return part;
    });
}
