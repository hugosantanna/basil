import * as vscode from 'vscode';
import { parseMathBlocks } from './mathParser';
import { renderLatex, getKatexCss } from './katexRenderer';

export class MathHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const config = vscode.workspace.getConfiguration('basil.hoverPreview');
    if (!config.get<boolean>('enabled', true)) return null;

    const blocks = parseMathBlocks(document);
    const block = blocks.find(b => b.range.contains(position));
    if (!block) return null;

    const result = renderLatex(block.latex, block.displayMode);
    if (result.error) {
      const errorMd = new vscode.MarkdownString(`**LaTeX Error:** ${result.error}`);
      return new vscode.Hover(errorMd, block.range);
    }

    const katexCss = getKatexCss();
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;
    md.value = `<style>${katexCss}</style><div style="padding: 8px; background: var(--vscode-editor-background);">${result.html}</div>`;

    return new vscode.Hover(md, block.range);
  }
}
