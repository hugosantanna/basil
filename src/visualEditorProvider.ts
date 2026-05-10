import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class VisualEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'basil.visualEditor';

  constructor(private readonly context: vscode.ExtensionContext) {}

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new VisualEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      VisualEditorProvider.viewType,
      provider,
      {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true },
      }
    );
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const docDir = path.dirname(document.uri.fsPath);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
        vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', 'katex', 'dist')),
        vscode.Uri.file(docDir),
      ],
    };

    const baseUri = webviewPanel.webview.asWebviewUri(vscode.Uri.file(docDir)).toString();

    let initialUpdateSent = false;

    const parseBibFiles = (): Record<string, { author: string; year: string; title: string }> => {
      const text = document.getText();
      const citations: Record<string, { author: string; year: string; title: string }> = {};
      const bibNames: string[] = [];

      const bibMatch = /\\bibliography\{([^}]+)\}/.exec(text);
      if (bibMatch) bibMatch[1].split(',').forEach(b => bibNames.push(b.trim()));
      const addbibRe = /\\addbibresource\{([^}]+)\}/g;
      let m;
      while ((m = addbibRe.exec(text)) !== null) bibNames.push(m[1]);

      for (const bibName of bibNames) {
        const bibFile = bibName.endsWith('.bib') ? bibName : bibName + '.bib';
        const bibPath = path.resolve(docDir, bibFile);
        try {
          const content = fs.readFileSync(bibPath, 'utf-8');
          const entryRe = /@\w+\{([^,]+),([^]*?)(?=\n@|\n*$)/g;
          let em;
          while ((em = entryRe.exec(content)) !== null) {
            const key = em[1].trim();
            const body = em[2];
            const authorM = /author\s*=\s*\{([^}]+)\}/i.exec(body);
            const yearM = /year\s*=\s*\{?(\d{4})\}?/i.exec(body);
            const titleM = /title\s*=\s*\{([^}]+)\}/i.exec(body);
            if (authorM || yearM) {
              const rawAuthor = authorM ? authorM[1] : '';
              const authors = rawAuthor.split(/\s+and\s+/);
              let formatted: string;
              if (authors.length === 1) {
                formatted = authors[0].split(',')[0].trim();
              } else if (authors.length === 2) {
                formatted = authors[0].split(',')[0].trim() + ' and ' + authors[1].split(',')[0].trim();
              } else {
                formatted = authors[0].split(',')[0].trim() + ' et al.';
              }
              citations[key] = {
                author: formatted,
                year: yearM ? yearM[1] : '',
                title: titleM ? titleM[1] : '',
              };
            }
          }
        } catch {}
      }
      return citations;
    };

    const sendUpdate = () => {
      webviewPanel.webview.postMessage({
        type: 'update',
        text: document.getText(),
        baseUri,
        citations: parseBibFiles(),
      });
    };

    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'ready') {
        sendUpdate();
        initialUpdateSent = true;
      }
      if (msg.type === 'edit') {
        const edit = new vscode.WorkspaceEdit();
        const startPos = document.positionAt(msg.start);
        const endPos = document.positionAt(msg.end);
        edit.replace(document.uri, new vscode.Range(startPos, endPos), msg.newText);
        await vscode.workspace.applyEdit(edit);
      }
    });

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview, baseUri);

    setTimeout(() => {
      if (!initialUpdateSent) {
        sendUpdate();
        initialUpdateSent = true;
      }
    }, 200);

    const changeDocSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        sendUpdate();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocSub.dispose();
    });
  }

  private getHtml(webview: vscode.Webview, _baseUri: string): string {
    const mediaUri = (file: string) =>
      webview.asWebviewUri(
        vscode.Uri.file(path.join(this.context.extensionPath, 'media', file))
      );

    const katexUri = (file: string) =>
      webview.asWebviewUri(
        vscode.Uri.file(
          path.join(this.context.extensionPath, 'node_modules', 'katex', 'dist', file)
        )
      );

    const cssUri = mediaUri('visual-editor.css');
    const jsUri = mediaUri('visual-editor.js');
    const katexCssUri = katexUri('katex.min.css');
    const katexJsUri = katexUri('katex.min.js');

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             img-src ${webview.cspSource} data: https:;
             font-src ${webview.cspSource};
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${katexCssUri}">
  <link rel="stylesheet" href="${cssUri}">
  <title>LaTeX Visual Editor</title>
</head>
<body>
  <div id="content" spellcheck="false" contenteditable="false">
    <div class="empty">Loading...</div>
  </div>
  <script nonce="${nonce}" src="${katexJsUri}"></script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
