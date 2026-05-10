import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class LaTeXCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): vscode.CompletionItem[] | undefined {
    const lineText = document.lineAt(position).text;
    const linePrefix = lineText.substring(0, position.character);

    // After \begin{ or \end{ → environment names
    const envMatch = linePrefix.match(/\\(?:begin|end)\{([a-zA-Z*]*)$/);
    if (envMatch) return this.environmentCompletions(envMatch[1]);

    // After \cite{ or \citep{ etc. → citation keys
    const citeMatch = linePrefix.match(/\\(?:cite[tp]?|citeauthor|citeyear|autocite|textcite)\{([^}]*)$/);
    if (citeMatch) return this.citationCompletions(document, citeMatch[1]);

    // After \ref{ or \eqref{ etc. → label keys
    const refMatch = linePrefix.match(/\\(?:ref|eqref|autoref|[Cc]ref|pageref|nameref)\{([^}]*)$/);
    if (refMatch) return this.referenceCompletions(document, refMatch[1]);

    // After \usepackage{ → package names
    const pkgMatch = linePrefix.match(/\\usepackage(?:\[.*?\])?\{([^}]*)$/);
    if (pkgMatch) return this.packageCompletions(pkgMatch[1]);

    // After \documentclass{ → class names
    const clsMatch = linePrefix.match(/\\documentclass(?:\[.*?\])?\{([^}]*)$/);
    if (clsMatch) return this.documentClassCompletions(clsMatch[1]);

    // After \ → command completions
    const cmdMatch = linePrefix.match(/\\([a-zA-Z]*)$/);
    if (cmdMatch) return this.commandCompletions(cmdMatch[1]);

    return undefined;
  }

  private environmentCompletions(prefix: string): vscode.CompletionItem[] {
    const envs: [string, string, string][] = [
      ['equation', 'Numbered equation', '\\begin{equation}\n\t$1\n\\end{equation}'],
      ['equation*', 'Unnumbered equation', '\\begin{equation*}\n\t$1\n\\end{equation*}'],
      ['align', 'Aligned equations (numbered)', '\\begin{align}\n\t$1 &= $2\n\\end{align}'],
      ['align*', 'Aligned equations', '\\begin{align*}\n\t$1 &= $2\n\\end{align*}'],
      ['gather', 'Gathered equations', '\\begin{gather}\n\t$1\n\\end{gather}'],
      ['gather*', 'Gathered equations (unnumbered)', '\\begin{gather*}\n\t$1\n\\end{gather*}'],
      ['multline', 'Multi-line equation', '\\begin{multline}\n\t$1\n\\end{multline}'],
      ['figure', 'Figure environment', '\\begin{figure}[${1:htbp}]\n\t\\centering\n\t\\includegraphics[width=${2:0.8}\\textwidth]{${3:filename}}\n\t\\caption{${4:Caption}}\n\t\\label{fig:${5:label}}\n\\end{figure}'],
      ['table', 'Table environment', '\\begin{table}[${1:htbp}]\n\t\\centering\n\t\\caption{${2:Caption}}\n\t\\label{tab:${3:label}}\n\t\\begin{tabular}{${4:lcc}}\n\t\t\\hline\n\t\t$5 \\\\\\\\\n\t\t\\hline\n\t\\end{tabular}\n\\end{table}'],
      ['tabular', 'Tabular', '\\begin{tabular}{${1:lcc}}\n\t\\hline\n\t$2 \\\\\\\\\n\t\\hline\n\\end{tabular}'],
      ['itemize', 'Bullet list', '\\begin{itemize}\n\t\\item $1\n\\end{itemize}'],
      ['enumerate', 'Numbered list', '\\begin{enumerate}\n\t\\item $1\n\\end{enumerate}'],
      ['description', 'Description list', '\\begin{description}\n\t\\item[$1] $2\n\\end{description}'],
      ['abstract', 'Abstract', '\\begin{abstract}\n\t$1\n\\end{abstract}'],
      ['theorem', 'Theorem', '\\begin{theorem}\n\t$1\n\\end{theorem}'],
      ['lemma', 'Lemma', '\\begin{lemma}\n\t$1\n\\end{lemma}'],
      ['proposition', 'Proposition', '\\begin{proposition}\n\t$1\n\\end{proposition}'],
      ['corollary', 'Corollary', '\\begin{corollary}\n\t$1\n\\end{corollary}'],
      ['definition', 'Definition', '\\begin{definition}\n\t$1\n\\end{definition}'],
      ['remark', 'Remark', '\\begin{remark}\n\t$1\n\\end{remark}'],
      ['example', 'Example', '\\begin{example}\n\t$1\n\\end{example}'],
      ['proof', 'Proof', '\\begin{proof}\n\t$1\n\\end{proof}'],
      ['assumption', 'Assumption', '\\begin{assumption}\n\t$1\n\\end{assumption}'],
      ['cases', 'Cases (math)', '\\begin{cases}\n\t$1 & \\text{if } $2 \\\\\\\\\n\t$3 & \\text{otherwise}\n\\end{cases}'],
      ['matrix', 'Matrix', '\\begin{matrix}\n\t$1\n\\end{matrix}'],
      ['pmatrix', 'Parenthesized matrix', '\\begin{pmatrix}\n\t$1\n\\end{pmatrix}'],
      ['bmatrix', 'Bracketed matrix', '\\begin{bmatrix}\n\t$1\n\\end{bmatrix}'],
      ['tikzpicture', 'TikZ picture', '\\begin{tikzpicture}\n\t$1\n\\end{tikzpicture}'],
      ['minipage', 'Minipage', '\\begin{minipage}{${1:\\textwidth}}\n\t$2\n\\end{minipage}'],
      ['center', 'Centered content', '\\begin{center}\n\t$1\n\\end{center}'],
      ['quote', 'Block quote', '\\begin{quote}\n\t$1\n\\end{quote}'],
      ['verbatim', 'Verbatim text', '\\begin{verbatim}\n$1\n\\end{verbatim}'],
      ['lstlisting', 'Code listing', '\\begin{lstlisting}\n$1\n\\end{lstlisting}'],
    ];

    return envs
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, detail, snippet]) => {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
        item.detail = detail;
        item.insertText = new vscode.SnippetString(name + '}');
        item.sortText = '0' + name;
        return item;
      });
  }

  private commandCompletions(prefix: string): vscode.CompletionItem[] {
    const commands: [string, string, string, vscode.CompletionItemKind][] = [
      // Sections
      ['section', 'Section heading', '\\section{$1}', vscode.CompletionItemKind.Function],
      ['subsection', 'Subsection heading', '\\subsection{$1}', vscode.CompletionItemKind.Function],
      ['subsubsection', 'Subsubsection', '\\subsubsection{$1}', vscode.CompletionItemKind.Function],
      ['paragraph', 'Paragraph heading', '\\paragraph{$1}', vscode.CompletionItemKind.Function],
      ['chapter', 'Chapter heading', '\\chapter{$1}', vscode.CompletionItemKind.Function],

      // Text formatting
      ['textbf', 'Bold text', '\\textbf{$1}', vscode.CompletionItemKind.Function],
      ['textit', 'Italic text', '\\textit{$1}', vscode.CompletionItemKind.Function],
      ['emph', 'Emphasized text', '\\emph{$1}', vscode.CompletionItemKind.Function],
      ['underline', 'Underlined text', '\\underline{$1}', vscode.CompletionItemKind.Function],
      ['texttt', 'Monospace text', '\\texttt{$1}', vscode.CompletionItemKind.Function],
      ['textsc', 'Small caps', '\\textsc{$1}', vscode.CompletionItemKind.Function],
      ['textrm', 'Roman text', '\\textrm{$1}', vscode.CompletionItemKind.Function],
      ['textsf', 'Sans-serif text', '\\textsf{$1}', vscode.CompletionItemKind.Function],

      // Environments
      ['begin', 'Begin environment', '\\begin{$1}\n\t$2\n\\end{$1}', vscode.CompletionItemKind.Snippet],

      // References & citations
      ['cite', 'Citation', '\\cite{$1}', vscode.CompletionItemKind.Reference],
      ['citep', 'Parenthetical citation', '\\citep{$1}', vscode.CompletionItemKind.Reference],
      ['citet', 'Textual citation', '\\citet{$1}', vscode.CompletionItemKind.Reference],
      ['citeauthor', 'Cite author only', '\\citeauthor{$1}', vscode.CompletionItemKind.Reference],
      ['autocite', 'Auto citation', '\\autocite{$1}', vscode.CompletionItemKind.Reference],
      ['ref', 'Reference', '\\ref{$1}', vscode.CompletionItemKind.Reference],
      ['eqref', 'Equation reference', '\\eqref{$1}', vscode.CompletionItemKind.Reference],
      ['autoref', 'Auto reference', '\\autoref{$1}', vscode.CompletionItemKind.Reference],
      ['label', 'Label', '\\label{$1}', vscode.CompletionItemKind.Reference],
      ['footnote', 'Footnote', '\\footnote{$1}', vscode.CompletionItemKind.Function],

      // Math
      ['frac', 'Fraction', '\\frac{$1}{$2}', vscode.CompletionItemKind.Function],
      ['dfrac', 'Display fraction', '\\dfrac{$1}{$2}', vscode.CompletionItemKind.Function],
      ['sqrt', 'Square root', '\\sqrt{$1}', vscode.CompletionItemKind.Function],
      ['sum', 'Summation', '\\sum_{${1:i=1}}^{${2:N}}', vscode.CompletionItemKind.Function],
      ['prod', 'Product', '\\prod_{${1:i=1}}^{${2:N}}', vscode.CompletionItemKind.Function],
      ['int', 'Integral', '\\int_{${1:a}}^{${2:b}}', vscode.CompletionItemKind.Function],
      ['lim', 'Limit', '\\lim_{${1:n \\to \\infty}}', vscode.CompletionItemKind.Function],
      ['max', 'Maximum', '\\max_{${1:x}}', vscode.CompletionItemKind.Function],
      ['min', 'Minimum', '\\min_{${1:x}}', vscode.CompletionItemKind.Function],
      ['sup', 'Supremum', '\\sup_{${1:x}}', vscode.CompletionItemKind.Function],
      ['inf', 'Infimum', '\\inf_{${1:x}}', vscode.CompletionItemKind.Function],
      ['left', 'Left delimiter', '\\left$1 $2 \\right$3', vscode.CompletionItemKind.Function],
      ['hat', 'Hat accent', '\\hat{$1}', vscode.CompletionItemKind.Function],
      ['bar', 'Bar accent', '\\bar{$1}', vscode.CompletionItemKind.Function],
      ['tilde', 'Tilde accent', '\\tilde{$1}', vscode.CompletionItemKind.Function],
      ['vec', 'Vector arrow', '\\vec{$1}', vscode.CompletionItemKind.Function],
      ['dot', 'Dot accent', '\\dot{$1}', vscode.CompletionItemKind.Function],
      ['ddot', 'Double dot accent', '\\ddot{$1}', vscode.CompletionItemKind.Function],
      ['widehat', 'Wide hat', '\\widehat{$1}', vscode.CompletionItemKind.Function],
      ['widetilde', 'Wide tilde', '\\widetilde{$1}', vscode.CompletionItemKind.Function],
      ['overline', 'Overline', '\\overline{$1}', vscode.CompletionItemKind.Function],
      ['underbrace', 'Underbrace', '\\underbrace{$1}_{$2}', vscode.CompletionItemKind.Function],
      ['overbrace', 'Overbrace', '\\overbrace{$1}^{$2}', vscode.CompletionItemKind.Function],
      ['mathbb', 'Blackboard bold', '\\mathbb{$1}', vscode.CompletionItemKind.Function],
      ['mathbf', 'Math bold', '\\mathbf{$1}', vscode.CompletionItemKind.Function],
      ['mathcal', 'Calligraphic', '\\mathcal{$1}', vscode.CompletionItemKind.Function],
      ['mathrm', 'Math roman', '\\mathrm{$1}', vscode.CompletionItemKind.Function],
      ['text', 'Text in math', '\\text{$1}', vscode.CompletionItemKind.Function],
      ['operatorname', 'Operator name', '\\operatorname{$1}', vscode.CompletionItemKind.Function],
      ['partial', 'Partial derivative symbol', '\\partial', vscode.CompletionItemKind.Constant],
      ['nabla', 'Nabla/gradient', '\\nabla', vscode.CompletionItemKind.Constant],
      ['infty', 'Infinity', '\\infty', vscode.CompletionItemKind.Constant],
      ['forall', 'For all', '\\forall', vscode.CompletionItemKind.Constant],
      ['exists', 'Exists', '\\exists', vscode.CompletionItemKind.Constant],
      ['implies', 'Implies', '\\implies', vscode.CompletionItemKind.Constant],
      ['iff', 'If and only if', '\\iff', vscode.CompletionItemKind.Constant],
      ['quad', 'Quad space', '\\quad', vscode.CompletionItemKind.Constant],
      ['qquad', 'Double quad space', '\\qquad', vscode.CompletionItemKind.Constant],
      ['cdot', 'Centered dot', '\\cdot', vscode.CompletionItemKind.Constant],
      ['cdots', 'Centered dots', '\\cdots', vscode.CompletionItemKind.Constant],
      ['ldots', 'Low dots', '\\ldots', vscode.CompletionItemKind.Constant],
      ['times', 'Times', '\\times', vscode.CompletionItemKind.Constant],
      ['leq', 'Less or equal', '\\leq', vscode.CompletionItemKind.Constant],
      ['geq', 'Greater or equal', '\\geq', vscode.CompletionItemKind.Constant],
      ['neq', 'Not equal', '\\neq', vscode.CompletionItemKind.Constant],
      ['approx', 'Approximately', '\\approx', vscode.CompletionItemKind.Constant],
      ['sim', 'Similar/distributed as', '\\sim', vscode.CompletionItemKind.Constant],
      ['equiv', 'Equivalent', '\\equiv', vscode.CompletionItemKind.Constant],
      ['subset', 'Subset', '\\subset', vscode.CompletionItemKind.Constant],
      ['subseteq', 'Subset or equal', '\\subseteq', vscode.CompletionItemKind.Constant],
      ['in', 'Element of', '\\in', vscode.CompletionItemKind.Constant],
      ['notin', 'Not element of', '\\notin', vscode.CompletionItemKind.Constant],
      ['cap', 'Intersection', '\\cap', vscode.CompletionItemKind.Constant],
      ['cup', 'Union', '\\cup', vscode.CompletionItemKind.Constant],
      ['to', 'Right arrow', '\\to', vscode.CompletionItemKind.Constant],
      ['rightarrow', 'Right arrow', '\\rightarrow', vscode.CompletionItemKind.Constant],
      ['leftarrow', 'Left arrow', '\\leftarrow', vscode.CompletionItemKind.Constant],
      ['Rightarrow', 'Double right arrow', '\\Rightarrow', vscode.CompletionItemKind.Constant],
      ['Leftarrow', 'Double left arrow', '\\Leftarrow', vscode.CompletionItemKind.Constant],
      ['mapsto', 'Maps to', '\\mapsto', vscode.CompletionItemKind.Constant],

      // Greek letters
      ['alpha', 'α', '\\alpha', vscode.CompletionItemKind.Constant],
      ['beta', 'β', '\\beta', vscode.CompletionItemKind.Constant],
      ['gamma', 'γ', '\\gamma', vscode.CompletionItemKind.Constant],
      ['Gamma', 'Γ', '\\Gamma', vscode.CompletionItemKind.Constant],
      ['delta', 'δ', '\\delta', vscode.CompletionItemKind.Constant],
      ['Delta', 'Δ', '\\Delta', vscode.CompletionItemKind.Constant],
      ['epsilon', 'ε', '\\epsilon', vscode.CompletionItemKind.Constant],
      ['varepsilon', 'ε (variant)', '\\varepsilon', vscode.CompletionItemKind.Constant],
      ['zeta', 'ζ', '\\zeta', vscode.CompletionItemKind.Constant],
      ['eta', 'η', '\\eta', vscode.CompletionItemKind.Constant],
      ['theta', 'θ', '\\theta', vscode.CompletionItemKind.Constant],
      ['Theta', 'Θ', '\\Theta', vscode.CompletionItemKind.Constant],
      ['iota', 'ι', '\\iota', vscode.CompletionItemKind.Constant],
      ['kappa', 'κ', '\\kappa', vscode.CompletionItemKind.Constant],
      ['lambda', 'λ', '\\lambda', vscode.CompletionItemKind.Constant],
      ['Lambda', 'Λ', '\\Lambda', vscode.CompletionItemKind.Constant],
      ['mu', 'μ', '\\mu', vscode.CompletionItemKind.Constant],
      ['nu', 'ν', '\\nu', vscode.CompletionItemKind.Constant],
      ['xi', 'ξ', '\\xi', vscode.CompletionItemKind.Constant],
      ['pi', 'π', '\\pi', vscode.CompletionItemKind.Constant],
      ['Pi', 'Π', '\\Pi', vscode.CompletionItemKind.Constant],
      ['rho', 'ρ', '\\rho', vscode.CompletionItemKind.Constant],
      ['sigma', 'σ', '\\sigma', vscode.CompletionItemKind.Constant],
      ['Sigma', 'Σ', '\\Sigma', vscode.CompletionItemKind.Constant],
      ['tau', 'τ', '\\tau', vscode.CompletionItemKind.Constant],
      ['upsilon', 'υ', '\\upsilon', vscode.CompletionItemKind.Constant],
      ['phi', 'φ', '\\phi', vscode.CompletionItemKind.Constant],
      ['varphi', 'φ (variant)', '\\varphi', vscode.CompletionItemKind.Constant],
      ['Phi', 'Φ', '\\Phi', vscode.CompletionItemKind.Constant],
      ['chi', 'χ', '\\chi', vscode.CompletionItemKind.Constant],
      ['psi', 'ψ', '\\psi', vscode.CompletionItemKind.Constant],
      ['Psi', 'Ψ', '\\Psi', vscode.CompletionItemKind.Constant],
      ['omega', 'ω', '\\omega', vscode.CompletionItemKind.Constant],
      ['Omega', 'Ω', '\\Omega', vscode.CompletionItemKind.Constant],

      // Document structure
      ['includegraphics', 'Include image', '\\includegraphics[width=${1:0.8}\\textwidth]{${2:filename}}', vscode.CompletionItemKind.Function],
      ['caption', 'Caption', '\\caption{$1}', vscode.CompletionItemKind.Function],
      ['usepackage', 'Use package', '\\usepackage{$1}', vscode.CompletionItemKind.Function],
      ['newcommand', 'New command', '\\newcommand{\\${1:name}}{$2}', vscode.CompletionItemKind.Function],
      ['renewcommand', 'Renew command', '\\renewcommand{\\${1:name}}{$2}', vscode.CompletionItemKind.Function],
      ['input', 'Input file', '\\input{$1}', vscode.CompletionItemKind.Function],
      ['include', 'Include file', '\\include{$1}', vscode.CompletionItemKind.Function],
      ['bibliography', 'Bibliography', '\\bibliography{$1}', vscode.CompletionItemKind.Function],
      ['bibliographystyle', 'Bibliography style', '\\bibliographystyle{$1}', vscode.CompletionItemKind.Function],

      // Econometrics-specific
      ['plim', 'Probability limit', '\\plim', vscode.CompletionItemKind.Function],
      ['argmin', 'Arg min', '\\argmin_{$1}', vscode.CompletionItemKind.Function],
      ['argmax', 'Arg max', '\\argmax_{$1}', vscode.CompletionItemKind.Function],
    ];

    return commands
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, detail, snippet, kind]) => {
        const item = new vscode.CompletionItem(name, kind);
        item.detail = detail;
        item.insertText = new vscode.SnippetString(snippet.replace(/^\\[a-zA-Z*]+/, ''));
        item.sortText = '1' + name;
        return item;
      });
  }

  private citationCompletions(document: vscode.TextDocument, prefix: string): vscode.CompletionItem[] {
    const keys = new Set<string>();

    // Scan current document for \bibitem keys
    const text = document.getText();
    const bibitemRe = /\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g;
    let m;
    while ((m = bibitemRe.exec(text)) !== null) keys.add(m[1]);

    // Scan for .bib files referenced in \bibliography{}
    const bibRe = /\\bibliography\{([^}]+)\}/;
    const bibMatch = bibRe.exec(text);
    if (bibMatch) {
      const bibNames = bibMatch[1].split(',').map(s => s.trim());
      const docDir = path.dirname(document.uri.fsPath);
      for (const bibName of bibNames) {
        const bibFile = bibName.endsWith('.bib') ? bibName : bibName + '.bib';
        const bibPath = path.resolve(docDir, bibFile);
        try {
          const bibContent = fs.readFileSync(bibPath, 'utf-8');
          const entryRe = /@\w+\{([^,]+),/g;
          let em;
          while ((em = entryRe.exec(bibContent)) !== null) keys.add(em[1].trim());
        } catch {}
      }
    }

    // Also scan for \addbibresource
    const addbibRe = /\\addbibresource\{([^}]+)\}/g;
    while ((m = addbibRe.exec(text)) !== null) {
      const bibPath = path.resolve(path.dirname(document.uri.fsPath), m[1]);
      try {
        const bibContent = fs.readFileSync(bibPath, 'utf-8');
        const entryRe = /@\w+\{([^,]+),/g;
        let em;
        while ((em = entryRe.exec(bibContent)) !== null) keys.add(em[1].trim());
      } catch {}
    }

    return Array.from(keys)
      .filter(k => k.startsWith(prefix))
      .map(k => {
        const item = new vscode.CompletionItem(k, vscode.CompletionItemKind.Reference);
        item.detail = 'Citation key';
        item.sortText = '0' + k;
        return item;
      });
  }

  private referenceCompletions(document: vscode.TextDocument, prefix: string): vscode.CompletionItem[] {
    const text = document.getText();
    const labels = new Set<string>();
    const labelRe = /\\label\{([^}]+)\}/g;
    let m;
    while ((m = labelRe.exec(text)) !== null) labels.add(m[1]);

    return Array.from(labels)
      .filter(l => l.startsWith(prefix))
      .map(l => {
        const item = new vscode.CompletionItem(l, vscode.CompletionItemKind.Reference);
        item.detail = 'Label';
        const labelPrefix = l.split(':')[0];
        const typeMap: Record<string, string> = { eq: 'Equation', fig: 'Figure', tab: 'Table', sec: 'Section', thm: 'Theorem' };
        if (typeMap[labelPrefix]) item.detail = typeMap[labelPrefix] + ' label';
        item.sortText = '0' + l;
        return item;
      });
  }

  private packageCompletions(prefix: string): vscode.CompletionItem[] {
    const packages = [
      'amsmath', 'amssymb', 'amsthm', 'graphicx', 'hyperref', 'geometry',
      'babel', 'inputenc', 'fontenc', 'tikz', 'pgfplots', 'booktabs',
      'natbib', 'biblatex', 'cleveref', 'xcolor', 'listings', 'algorithm2e',
      'algorithmicx', 'float', 'subcaption', 'caption', 'microtype',
      'enumitem', 'setspace', 'fancyhdr', 'titlesec', 'appendix',
      'multirow', 'array', 'longtable', 'tabularx', 'siunitx',
      'mathtools', 'bm', 'physics', 'dcolumn', 'threeparttable',
      'rotating', 'pdflscape', 'afterpage', 'placeins',
    ];

    return packages
      .filter(p => p.startsWith(prefix))
      .map(p => {
        const item = new vscode.CompletionItem(p, vscode.CompletionItemKind.Module);
        item.detail = 'Package';
        return item;
      });
  }

  private documentClassCompletions(prefix: string): vscode.CompletionItem[] {
    const classes = [
      'article', 'report', 'book', 'letter', 'beamer', 'memoir',
      'standalone', 'minimal', 'amsart', 'revtex4-2', 'elsarticle',
      'IEEEtran', 'acmart', 'tufte-handout', 'tufte-book',
    ];

    return classes
      .filter(c => c.startsWith(prefix))
      .map(c => {
        const item = new vscode.CompletionItem(c, vscode.CompletionItemKind.Class);
        item.detail = 'Document class';
        return item;
      });
  }
}
