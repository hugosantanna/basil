import * as vscode from 'vscode';
import { InlineMathDecorator } from './inlineDecorator';
import { MathHoverProvider } from './hoverProvider';
import { VisualEditorProvider } from './visualEditorProvider';
import { LaTeXCompletionProvider } from './completionProvider';
import { registerAICommands } from './aiAssistant';

const LATEX_SELECTOR = [
  { language: 'latex' },
  { language: 'tex' },
  { pattern: '**/*.tex' },
];

export function activate(context: vscode.ExtensionContext) {
  const decorator = new InlineMathDecorator(context);
  const hoverProvider = new MathHoverProvider();
  const completionProvider = new LaTeXCompletionProvider();

  context.subscriptions.push(VisualEditorProvider.register(context));
  registerAICommands(context);

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      LATEX_SELECTOR,
      completionProvider,
      '\\', '{',
    )
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(LATEX_SELECTOR, hoverProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('basil.toggleInlinePreview', () => {
      decorator.toggle();
      const state = decorator['enabled'] ? 'enabled' : 'disabled';
      vscode.window.showInformationMessage(`Inline math preview ${state}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('basil.toggleHoverPreview', () => {
      const config = vscode.workspace.getConfiguration('basil.hoverPreview');
      const current = config.get<boolean>('enabled', true);
      config.update('enabled', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Hover math preview ${!current ? 'enabled' : 'disabled'}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('basil.openVisualEditor', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editor.document.fileName.endsWith('.tex')) {
        vscode.window.showWarningMessage('Open a .tex file first');
        return;
      }
      await vscode.commands.executeCommand(
        'vscode.openWith',
        editor.document.uri,
        VisualEditorProvider.viewType
      );
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => decorator.scheduleUpdate())
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      const ed = vscode.window.activeTextEditor;
      if (ed && e.document === ed.document) {
        decorator.scheduleUpdate();
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(() => decorator.scheduleUpdate())
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('basil')) {
        decorator.scheduleUpdate();
      }
    })
  );

  decorator.scheduleUpdate();

  context.subscriptions.push({ dispose: () => decorator.dispose() });
}

export function deactivate() {}
