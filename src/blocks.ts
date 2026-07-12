export type BlockLang = "dataview" | "dql" | "dataviewjs";

export interface DataviewBlock {
  lang: BlockLang;
  query: string;
  /** 0-based line range of the fenced code block, inclusive of the fence markers. */
  startLine: number;
  endLine: number;
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*(\S+)?\s*$/;

/** Find every ```dataview / ```dql / ```dataviewjs fenced block in a markdown document. */
export function findDataviewBlocks(text: string): DataviewBlock[] {
  const lines = text.split(/\r\n|\n/);
  const blocks: DataviewBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const open = FENCE_RE.exec(lines[i]);
    if (!open) {
      i++;
      continue;
    }
    const fenceChar = open[2][0];
    const lang = (open[3] ?? "").toLowerCase();
    const isDataviewLang = lang === "dataview" || lang === "dql" || lang === "dataviewjs";

    let j = i + 1;
    const bodyLines: string[] = [];
    while (j < lines.length) {
      const closeMatch = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[j]);
      if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= open[2].length) break;
      bodyLines.push(lines[j]);
      j++;
    }

    if (isDataviewLang) {
      blocks.push({
        lang: lang as BlockLang,
        query: bodyLines.join("\n"),
        startLine: i,
        endLine: Math.min(j, lines.length - 1),
      });
    }

    i = j + 1;
  }

  return blocks;
}
