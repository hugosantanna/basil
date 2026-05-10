import * as vscode from 'vscode';

const SYSTEM_PROMPT = `You are a LaTeX writing assistant for academic papers in economics and social sciences. You have deep expertise in LaTeX, econometrics, and academic writing conventions.

When asked to write or edit LaTeX:
- Output ONLY the LaTeX code, no explanation or markdown fences
- Use standard packages (amsmath, amssymb, graphicx, etc.)
- Follow academic conventions for equations, theorems, tables
- Use proper citation commands (\\cite, \\citet, \\citep)
- Write clear, precise academic prose

When asked to explain or review:
- Be concise and specific
- Reference equation numbers, section names, or line content`;

async function getModel(): Promise<vscode.LanguageModelChat | undefined> {
  const models = await vscode.lm.selectChatModels();
  if (models.length === 0) {
    vscode.window.showErrorMessage('No AI model available. Install the Claude or Copilot extension.');
    return undefined;
  }
  return models[0];
}

async function streamResponse(
  model: vscode.LanguageModelChat,
  messages: vscode.LanguageModelChatMessage[],
  token: vscode.CancellationToken
): Promise<string> {
  const response = await model.sendRequest(messages, {}, token);
  let result = '';
  for await (const chunk of response.stream) {
    result += chunk;
  }
  return result;
}

function getDocumentContext(document: vscode.TextDocument): string {
  const text = document.getText();
  if (text.length > 12000) {
    const preambleEnd = text.indexOf('\\begin{document}');
    if (preambleEnd !== -1) {
      const preamble = text.substring(0, preambleEnd + '\\begin{document}'.length);
      const bodyStart = preambleEnd + '\\begin{document}'.length;
      const body = text.substring(bodyStart);
      if (body.length > 10000) {
        return preamble + body.substring(0, 5000) + '\n\n[... middle truncated ...]\n\n' + body.substring(body.length - 5000);
      }
      return text;
    }
    return text.substring(0, 6000) + '\n\n[... truncated ...]\n\n' + text.substring(text.length - 6000);
  }
  return text;
}

export function registerAICommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('basil.aiDraft', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const prompt = await vscode.window.showInputBox({
        prompt: 'What should Claude write?',
        placeHolder: 'e.g., "Write an introduction about minimum wage effects"',
      });
      if (!prompt) return;

      const model = await getModel();
      if (!model) return;

      const docContext = getDocumentContext(editor.document);
      const messages = [
        vscode.LanguageModelChatMessage.Assistant(SYSTEM_PROMPT),
        vscode.LanguageModelChatMessage.User(
          `Here is the current LaTeX document:\n\n${docContext}\n\n---\n\nThe cursor is at line ${editor.selection.active.line + 1}.\n\nRequest: ${prompt}\n\nWrite the LaTeX code to insert at the cursor position. Output ONLY the LaTeX, nothing else.`
        ),
      ];

      const cancel = new vscode.CancellationTokenSource();

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Basil: Drafting...', cancellable: true },
        async (_progress, progressToken) => {
          progressToken.onCancellationRequested(() => cancel.cancel());
          try {
            const result = await streamResponse(model, messages, cancel.token);
            const cleaned = result.replace(/^```latex\n?/g, '').replace(/\n?```$/g, '').trim();
            editor.edit(editBuilder => {
              editBuilder.insert(editor.selection.active, cleaned);
            });
          } catch (e: any) {
            if (e.message?.includes('cancel')) return;
            vscode.window.showErrorMessage('AI error: ' + e.message);
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('basil.aiEdit', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('Select some LaTeX text first');
        return;
      }

      const selectedText = editor.document.getText(editor.selection);

      const prompt = await vscode.window.showInputBox({
        prompt: 'How should Claude edit this?',
        placeHolder: 'e.g., "Make this more concise" or "Add standard errors to this table"',
      });
      if (!prompt) return;

      const model = await getModel();
      if (!model) return;

      const docContext = getDocumentContext(editor.document);
      const messages = [
        vscode.LanguageModelChatMessage.Assistant(SYSTEM_PROMPT),
        vscode.LanguageModelChatMessage.User(
          `Here is the current LaTeX document:\n\n${docContext}\n\n---\n\nThe user selected this text:\n\n${selectedText}\n\nRequest: ${prompt}\n\nOutput the edited version of the selected text. Output ONLY the replacement LaTeX, nothing else.`
        ),
      ];

      const cancel = new vscode.CancellationTokenSource();

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Basil: Editing...', cancellable: true },
        async (_progress, progressToken) => {
          progressToken.onCancellationRequested(() => cancel.cancel());
          try {
            const result = await streamResponse(model, messages, cancel.token);
            const cleaned = result.replace(/^```latex\n?/g, '').replace(/\n?```$/g, '').trim();
            editor.edit(editBuilder => {
              editBuilder.replace(editor.selection, cleaned);
            });
          } catch (e: any) {
            if (e.message?.includes('cancel')) return;
            vscode.window.showErrorMessage('AI error: ' + e.message);
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('basil.aiExplain', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('Select some LaTeX text first');
        return;
      }

      const selectedText = editor.document.getText(editor.selection);
      const model = await getModel();
      if (!model) return;

      const messages = [
        vscode.LanguageModelChatMessage.Assistant(SYSTEM_PROMPT),
        vscode.LanguageModelChatMessage.User(
          `Explain this LaTeX in plain language. What does it produce? If it's math, explain the notation. Be concise (2-4 sentences).\n\n${selectedText}`
        ),
      ];

      const cancel = new vscode.CancellationTokenSource();

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Basil: Thinking...', cancellable: true },
        async (_progress, progressToken) => {
          progressToken.onCancellationRequested(() => cancel.cancel());
          try {
            const result = await streamResponse(model, messages, cancel.token);
            vscode.window.showInformationMessage(result, { modal: true });
          } catch (e: any) {
            if (e.message?.includes('cancel')) return;
            vscode.window.showErrorMessage('AI error: ' + e.message);
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('basil.aiFixError', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
      if (diagnostics.length === 0) {
        vscode.window.showInformationMessage('No errors found in this file');
        return;
      }

      const errorSummary = diagnostics
        .slice(0, 10)
        .map(d => `Line ${d.range.start.line + 1}: ${d.message}`)
        .join('\n');

      const model = await getModel();
      if (!model) return;

      const docContext = getDocumentContext(editor.document);
      const messages = [
        vscode.LanguageModelChatMessage.Assistant(SYSTEM_PROMPT),
        vscode.LanguageModelChatMessage.User(
          `Here is a LaTeX document with errors:\n\n${docContext}\n\n---\n\nErrors:\n${errorSummary}\n\nProvide the corrected full document. Output ONLY the LaTeX, nothing else.`
        ),
      ];

      const cancel = new vscode.CancellationTokenSource();

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Basil: Fixing errors...', cancellable: true },
        async (_progress, progressToken) => {
          progressToken.onCancellationRequested(() => cancel.cancel());
          try {
            const result = await streamResponse(model, messages, cancel.token);
            const cleaned = result.replace(/^```latex\n?/g, '').replace(/\n?```$/g, '').trim();
            const fullRange = new vscode.Range(
              editor.document.positionAt(0),
              editor.document.positionAt(editor.document.getText().length)
            );
            editor.edit(editBuilder => {
              editBuilder.replace(fullRange, cleaned);
            });
          } catch (e: any) {
            if (e.message?.includes('cancel')) return;
            vscode.window.showErrorMessage('AI error: ' + e.message);
          }
        }
      );
    })
  );
}
