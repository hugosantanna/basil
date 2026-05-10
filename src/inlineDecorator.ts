import * as vscode from 'vscode';
import { MathBlock, parseMathBlocks, isInsideComment } from './mathParser';
import { renderLatex } from './katexRenderer';

export class InlineMathDecorator {
  private decorationTypes: vscode.TextEditorDecorationType[] = [];
  private enabled: boolean = true;
  private debounceTimer: NodeJS.Timeout | undefined;

  constructor(private context: vscode.ExtensionContext) {}

  enable(): void {
    this.enabled = true;
    this.updateDecorations();
  }

  disable(): void {
    this.enabled = false;
    this.clearDecorations();
  }

  toggle(): void {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }

  scheduleUpdate(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.updateDecorations(), 300);
  }

  updateDecorations(): void {
    if (!this.enabled) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const doc = editor.document;
    if (!['latex', 'tex'].includes(doc.languageId) && !doc.fileName.endsWith('.tex')) return;

    this.clearDecorations();

    const config = vscode.workspace.getConfiguration('basil.inlinePreview');
    const fontSize = config.get<number>('fontSize', 14);
    const opacity = config.get<number>('opacity', 0.85);

    const blocks = parseMathBlocks(doc);
    const cursorPosition = editor.selection.active;

    for (const block of blocks) {
      if (isInsideComment(doc, block.range.start)) continue;
      if (block.range.contains(cursorPosition)) continue;

      const result = renderLatex(block.latex, block.displayMode);
      if (result.error) continue;

      const svgDataUri = this.htmlToSvgDataUri(result.html, block.displayMode, fontSize);
      if (!svgDataUri) continue;

      const decorationType = vscode.window.createTextEditorDecorationType({
        after: {
          contentIconPath: vscode.Uri.parse(svgDataUri),
          margin: '0 0 0 8px',
        },
        opacity: opacity.toString(),
      });

      const lastLine = block.range.end.line;
      const decoRange = new vscode.Range(lastLine, doc.lineAt(lastLine).text.length, lastLine, doc.lineAt(lastLine).text.length);
      editor.setDecorations(decorationType, [decoRange]);
      this.decorationTypes.push(decorationType);
    }
  }

  private htmlToSvgDataUri(html: string, displayMode: boolean, fontSize: number): string | null {
    const height = displayMode ? fontSize * 2.5 : fontSize * 1.4;
    const width = Math.min(html.length * fontSize * 0.4, 600);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="
          font-size: ${fontSize}px;
          color: #c5c8c6;
          font-family: 'KaTeX_Main', 'Times New Roman', serif;
          display: flex;
          align-items: center;
          height: 100%;
          ${displayMode ? 'justify-content: center;' : ''}
        ">
          ${html}
        </div>
      </foreignObject>
    </svg>`;

    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  private clearDecorations(): void {
    for (const dt of this.decorationTypes) {
      dt.dispose();
    }
    this.decorationTypes = [];
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.clearDecorations();
  }
}
