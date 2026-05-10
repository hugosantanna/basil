import katex from 'katex';

export interface RenderResult {
  html: string;
  error: string | null;
}

const MACRO_DEFINITIONS: Record<string, string> = {
  '\\R': '\\mathbb{R}',
  '\\N': '\\mathbb{N}',
  '\\Z': '\\mathbb{Z}',
  '\\E': '\\mathbb{E}',
  '\\Var': '\\operatorname{Var}',
  '\\Cov': '\\operatorname{Cov}',
  '\\Corr': '\\operatorname{Corr}',
  '\\plim': '\\operatorname{plim}',
  '\\argmin': '\\operatorname*{arg\\,min}',
  '\\argmax': '\\operatorname*{arg\\,max}',
  '\\ind': '\\mathbb{1}',
  '\\iid': '\\overset{\\text{iid}}{\\sim}',
  '\\pto': '\\overset{p}{\\to}',
  '\\dto': '\\overset{d}{\\to}',
  '\\asto': '\\overset{a.s.}{\\to}',
};

export function renderLatex(latex: string, displayMode: boolean): RenderResult {
  try {
    const cleaned = latex
      .replace(/\\label\{[^}]*\}/g, '')
      .replace(/\\tag\{[^}]*\}/g, '')
      .replace(/\\nonumber/g, '')
      .replace(/\\notag/g, '')
      .replace(/&/g, ' \\quad ');

    const html = katex.renderToString(cleaned, {
      displayMode,
      throwOnError: false,
      errorColor: '#cc0000',
      macros: { ...MACRO_DEFINITIONS },
      trust: true,
      strict: false,
      output: 'html',
    });

    return { html, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { html: '', error: message };
  }
}

export function getKatexCss(): string {
  try {
    const katexPath = require.resolve('katex/dist/katex.min.css');
    const fs = require('fs');
    return fs.readFileSync(katexPath, 'utf-8');
  } catch {
    return '';
  }
}
