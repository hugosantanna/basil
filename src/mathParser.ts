import * as vscode from 'vscode';

export interface MathBlock {
  range: vscode.Range;
  latex: string;
  displayMode: boolean;
}

const MATH_PATTERNS: { regex: RegExp; displayMode: boolean }[] = [
  { regex: /\$\$([^$]+?)\$\$/g, displayMode: true },
  { regex: /\\\[(.+?)\\\]/gs, displayMode: true },
  { regex: /\\begin\{(equation|align|gather|multline|flalign|alignat)\*?\}([\s\S]*?)\\end\{\1\*?\}/g, displayMode: true },
  { regex: /(?<![\\$])\$(?!\$)(.+?)(?<![\\$])\$(?!\$)/g, displayMode: false },
  { regex: /\\\((.+?)\\\)/gs, displayMode: false },
];

export function parseMathBlocks(document: vscode.TextDocument): MathBlock[] {
  const text = document.getText();
  const blocks: MathBlock[] = [];
  const occupied = new Set<number>();

  for (const pattern of MATH_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const startOffset = match.index;
      const endOffset = match.index + match[0].length;

      let overlap = false;
      for (let i = startOffset; i < endOffset; i++) {
        if (occupied.has(i)) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;

      for (let i = startOffset; i < endOffset; i++) {
        occupied.add(i);
      }

      const innerLatex = match[match.length > 2 ? 2 : 1];
      if (!innerLatex || innerLatex.trim().length === 0) continue;

      const startPos = document.positionAt(startOffset);
      const endPos = document.positionAt(endOffset);

      blocks.push({
        range: new vscode.Range(startPos, endPos),
        latex: innerLatex.trim(),
        displayMode: pattern.displayMode,
      });
    }
  }

  return blocks;
}

export function isInsideComment(document: vscode.TextDocument, position: vscode.Position): boolean {
  const line = document.lineAt(position.line).text;
  const commentIdx = line.indexOf('%');
  if (commentIdx === -1) return false;
  if (commentIdx === 0) return true;
  return line[commentIdx - 1] !== '\\' && commentIdx < position.character;
}
