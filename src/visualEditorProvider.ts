import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import * as crypto from 'crypto';

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

    const parseBibFiles = (): Record<string, { author: string; year: string; title: string; journal: string }> => {
      const text = document.getText();
      const citations: Record<string, { author: string; year: string; title: string; journal: string }> = {};
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
            const journalM = /journal\s*=\s*\{([^}]+)\}/i.exec(body);
            if (authorM || yearM) {
              const rawAuthor = authorM ? authorM[1] : '';
              const authors = rawAuthor.split(/\s+and\s+/);
              const cleanName = (s: string) => latexToUnicode(s.split(',')[0].trim());
              let formatted: string;
              if (authors.length === 1) {
                formatted = cleanName(authors[0]);
              } else if (authors.length === 2) {
                formatted = cleanName(authors[0]) + ' and ' + cleanName(authors[1]);
              } else {
                formatted = cleanName(authors[0]) + ' et al.';
              }
              citations[key] = {
                author: formatted,
                year: yearM ? yearM[1] : '',
                title: latexToUnicode(titleM ? titleM[1] : ''),
                journal: latexToUnicode(journalM ? journalM[1] : ''),
              };
            }
          }
        } catch {}
      }
      return citations;
    };

    const cacheDir = path.join(this.context.globalStorageUri.fsPath, 'fig-cache');
    try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}

    const convertPdfFigures = (): Record<string, string> => {
      const text = document.getText();
      const figMap: Record<string, string> = {};
      const re = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        let figPath = m[1];
        const ext = figPath.split('.').pop()?.toLowerCase() || '';
        if (ext !== 'pdf' && ext !== 'eps') {
          if (!ext || !['png','jpg','jpeg','gif','svg','bmp','webp'].includes(ext)) {
            for (const tryExt of ['pdf', 'png', 'jpg', 'jpeg']) {
              if (fs.existsSync(path.resolve(docDir, figPath + '.' + tryExt))) {
                figPath = figPath + '.' + tryExt;
                break;
              }
            }
          } else {
            continue;
          }
        }
        const absPath = path.resolve(docDir, figPath);
        if (!fs.existsSync(absPath)) continue;

        const hash = crypto.createHash('sha256').update(absPath).digest('hex').substring(0, 32);
        const pngPath = path.join(cacheDir, hash + '.png');

        try {
          const srcStat = fs.statSync(absPath);
          let needConvert = true;
          if (fs.existsSync(pngPath)) {
            const cacheStat = fs.statSync(pngPath);
            if (cacheStat.mtimeMs >= srcStat.mtimeMs) needConvert = false;
          }
          if (needConvert) {
            if (process.platform === 'darwin') {
              execSync(`sips -s format png "${absPath}" --out "${pngPath}" 2>/dev/null`, { timeout: 10000 });
            } else {
              execSync(`convert -density 150 "${absPath}[0]" "${pngPath}" 2>/dev/null`, { timeout: 10000 });
            }
          }
          if (fs.existsSync(pngPath)) {
            figMap[figPath] = webviewPanel.webview.asWebviewUri(vscode.Uri.file(pngPath)).toString();
          }
        } catch {}
      }
      return figMap;
    };

    webviewPanel.webview.options = {
      ...webviewPanel.webview.options,
      localResourceRoots: [
        ...(webviewPanel.webview.options.localResourceRoots || []),
        vscode.Uri.file(cacheDir),
      ],
    };

    const resolveInputFiles = (): Record<string, string> => {
      const text = document.getText();
      const inputs: Record<string, string> = {};
      const re = /\\input\s*\{([^}]+)\}/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        let filePath = m[1];
        if (!filePath.endsWith('.tex')) filePath += '.tex';
        const absPath = path.resolve(docDir, filePath);
        try {
          inputs[m[1]] = fs.readFileSync(absPath, 'utf-8');
        } catch {}
      }
      return inputs;
    };

    const sendUpdate = () => {
      webviewPanel.webview.postMessage({
        type: 'update',
        text: document.getText(),
        baseUri,
        citations: parseBibFiles(),
        figureUris: convertPdfFigures(),
        inputFiles: resolveInputFiles(),
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

function latexToUnicode(s: string): string {
  const accents: Record<string, Record<string, string>> = {
    '"': { a:'ä',e:'ë',i:'ï',o:'ö',u:'ü',A:'Ä',E:'Ë',I:'Ï',O:'Ö',U:'Ü' },
    "'": { a:'á',e:'é',i:'í',o:'ó',u:'ú',A:'Á',E:'É',I:'Í',O:'Ó',U:'Ú',c:'ć',n:'ń',s:'ś',z:'ź' },
    '`': { a:'à',e:'è',i:'ì',o:'ò',u:'ù',A:'À',E:'È',I:'Ì',O:'Ò',U:'Ù' },
    '~': { a:'ã',n:'ñ',o:'õ',A:'Ã',N:'Ñ',O:'Õ' },
    '^': { a:'â',e:'ê',i:'î',o:'ô',u:'û',A:'Â',E:'Ê',I:'Î',O:'Ô',U:'Û' },
    'v': { c:'č',s:'š',z:'ž',C:'Č',S:'Š',Z:'Ž',r:'ř',e:'ě' },
    'c': { c:'ç',C:'Ç',s:'ş',S:'Ş' },
    'H': { o:'ő',u:'ű',O:'Ő',U:'Ű' },
  };
  return s
    .replace(/\{\\([\"\'`~^vcH])\{?(\w)\}?\}/g, (_, acc, ch) => accents[acc]?.[ch] || ch)
    .replace(/\\([\"\'`~^vcH])\{(\w)\}/g, (_, acc, ch) => accents[acc]?.[ch] || ch)
    .replace(/\\([\"\'`~^vcH])(\w)/g, (_, acc, ch) => accents[acc]?.[ch] || ch)
    .replace(/\\ss\b/g, 'ß')
    .replace(/\\o\b/g, 'ø').replace(/\\O\b/g, 'Ø')
    .replace(/\\aa\b/g, 'å').replace(/\\AA\b/g, 'Å')
    .replace(/\\ae\b/g, 'æ').replace(/\\AE\b/g, 'Æ')
    .replace(/\\oe\b/g, 'œ').replace(/\\OE\b/g, 'Œ')
    .replace(/\{|\}/g, '');
}
