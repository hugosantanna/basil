(function () {
  var vscode = acquireVsCodeApi();
  var currentSource = '';
  var macros = {};
  var baseUri = '';
  var bodyOffset = 0;
  var bodyEnd = 0;
  var mathStore = {};
  var mathIdCounter = 0;
  var blockStore = {};
  var citations = {};
  var blockIdCounter = 0;
  var rendering = false;
  var editingBlock = null;
  var titleInfo = null, authorInfo = null, dateInfo = null;

  var DEFAULT_MACROS = {
    '\\R':'\\mathbb{R}','\\N':'\\mathbb{N}','\\Z':'\\mathbb{Z}',
    '\\Q':'\\mathbb{Q}','\\C':'\\mathbb{C}','\\E':'\\mathbb{E}',
    '\\P':'\\mathbb{P}','\\Var':'\\operatorname{Var}',
    '\\Cov':'\\operatorname{Cov}','\\Corr':'\\operatorname{Corr}',
    '\\plim':'\\operatorname{plim}',
    '\\argmin':'\\operatorname*{arg\\,min}',
    '\\argmax':'\\operatorname*{arg\\,max}',
    '\\ind':'\\mathbb{1}',
    '\\iid':'\\overset{\\text{iid}}{\\sim}',
    '\\pto':'\\overset{p}{\\to}',
    '\\dto':'\\overset{d}{\\to}',
    '\\asto':'\\overset{a.s.}{\\to}',
  };

  // =============================================
  // MESSAGES
  // =============================================
  var ownEdit = false;

  window.addEventListener('message', function (e) {
    if (e.data.type === 'update') {
      if (e.data.baseUri) baseUri = e.data.baseUri;
      if (e.data.citations) citations = e.data.citations;
      if (ownEdit) { ownEdit = false; return; }
      if (editingBlock) return;
      currentSource = e.data.text;
      vscode.setState({ source: currentSource, baseUri: baseUri });
      render();
    }
  });

  // =============================================
  // RENDER
  // =============================================
  function render() {
    rendering = true;
    var c = document.getElementById('content');
    try {
      mathStore = {}; mathIdCounter = 0;
      blockStore = {}; blockIdCounter = 0;
      c.innerHTML = renderDocument(currentSource);
      renderAllMath();
      attachBlockHandlers();
    } catch (e) {
      c.innerHTML = '<div class="render-error">Render error: ' + esc(e.message) + '</div>';
    }
    rendering = false;
  }

  // =============================================
  // BLOCK CLICK-TO-EDIT
  // =============================================
  function attachBlockHandlers() {
    var blocks = document.querySelectorAll('.ve-block');
    for (var i = 0; i < blocks.length; i++) {
      (function(el) {
        el.addEventListener('click', function(e) {
          if (el === editingBlock) return;
          e.stopPropagation();
          openBlockEditor(el);
        });
      })(blocks[i]);
    }
  }

  function openBlockEditor(el) {
    if (editingBlock && editingBlock !== el) closeBlockEditor(editingBlock);
    var rendered = el.querySelector('.ve-rendered');
    var editor = el.querySelector('.ve-editor');
    var ta = el.querySelector('.ve-source');
    rendered.style.display = 'none';
    editor.style.display = 'block';
    el.classList.add('editing');
    editingBlock = el;
    autoSize(ta);
    ta.addEventListener('input', function() { autoSize(ta); });
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function closeBlockEditor(el) {
    if (!el) return;
    var rendered = el.querySelector('.ve-rendered');
    var editor = el.querySelector('.ve-editor');
    var ta = el.querySelector('.ve-source');
    var bid = el.getAttribute('data-block-id');
    var srcStart = parseInt(el.getAttribute('data-src-start'));
    var srcEnd = parseInt(el.getAttribute('data-src-end'));

    rendered.style.display = '';
    editor.style.display = 'none';
    el.classList.remove('editing');
    if (editingBlock === el) editingBlock = null;

    var newText = ta.value;
    var oldText = currentSource.substring(srcStart, srcEnd);
    if (newText !== oldText) {
      ownEdit = true;
      var before = currentSource.substring(0, srcStart);
      var after = currentSource.substring(srcEnd);
      currentSource = before + newText + after;
      vscode.setState({ source: currentSource, baseUri: baseUri });
      vscode.postMessage({ type: 'edit', start: 0, end: (before + oldText + after).length, newText: currentSource });
      render();
    }
  }

  document.addEventListener('click', function(e) {
    if (editingBlock && !editingBlock.contains(e.target)) {
      closeBlockEditor(editingBlock);
    }
  });

  function autoSize(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  // =============================================
  // DOCUMENT PARSER
  // =============================================
  function renderDocument(source) {
    var parts = splitDocument(source);
    macros = Object.assign({}, DEFAULT_MACROS, extractMacros(parts.preamble));
    bodyOffset = parts.bodyOffset;
    bodyEnd = parts.bodyEnd;
    titleInfo = extractCmdInfo(parts.preamble, 'title');
    authorInfo = extractCmdInfo(parts.preamble, 'author');
    dateInfo = extractCmdInfo(parts.preamble, 'date');

    var body = parts.body;
    if (!body) return '<div class="empty">No document body found.</div>';

    var html = '';
    html += renderPreambleBlock(parts.preamble);
    if (titleInfo && body.indexOf('\\maketitle') !== -1) {
      html += renderTitleBlock();
    }

    html += processBlocks(body, bodyOffset);
    return html;
  }

  function renderPreambleBlock(preamble) {
    // Strip \title, \author, \date from the preamble source shown in this block
    // (they get their own editable blocks via renderTitleBlock)
    var setupPreamble = preamble
      .replace(/\\title\s*(?:\[[^\]]*\])?\s*\{[^]*?\}[ \t]*/g, function(m, off) { return ' '.repeat(m.length); })
      .replace(/\\author\s*(?:\[[^\]]*\])?\s*\{[^]*?\}[ \t]*/g, function(m) { return ' '.repeat(m.length); })
      .replace(/\\date\s*(?:\[[^\]]*\])?\s*\{[^]*?\}[ \t]*/g, function(m) { return ' '.repeat(m.length); });

    // But we still store the REAL source for editing — the user edits the actual preamble
    var bid = 'blk-' + (blockIdCounter++);
    var fullPreamble = preamble + '\\begin{document}';
    blockStore[bid] = fullPreamble;

    var docclass = '';
    var dcm = /\\documentclass(?:\[([^\]]*)\])?\{([^}]+)\}/.exec(preamble);
    if (dcm) docclass = dcm[2] + (dcm[1] ? ' [' + dcm[1] + ']' : '');

    var pkgs = [];
    var pkgRe = /\\usepackage(?:\[([^\]]*)\])?\{([^}]+)\}/g;
    var pm;
    while ((pm = pkgRe.exec(preamble)) !== null) {
      pm[2].split(',').forEach(function(p) { pkgs.push(p.trim()); });
    }

    var cmds = [];
    var cmdRe = /\\(?:re)?newcommand\s*\{?(\\[a-zA-Z]+)\}?/g;
    while ((pm = cmdRe.exec(preamble)) !== null) cmds.push(pm[1]);
    var dmoRe = /\\DeclareMathOperator\*?\s*\{?(\\[a-zA-Z]+)\}?/g;
    while ((pm = dmoRe.exec(preamble)) !== null) cmds.push(pm[1]);

    var summary = '<div class="preamble-summary">';
    summary += '<span class="preamble-label">Preamble</span>';
    if (docclass) summary += '<span class="preamble-detail">' + esc(docclass) + '</span>';
    if (pkgs.length) summary += '<span class="preamble-detail">' + pkgs.length + ' packages</span>';
    if (cmds.length) summary += '<span class="preamble-detail">' + cmds.length + ' commands</span>';
    summary += '</div>';

    return '<div class="ve-block ve-preamble-block" data-block-id="' + bid + '" data-src-start="0" data-src-end="' + fullPreamble.length + '">' +
      '<div class="ve-rendered">' + summary + '</div>' +
      '<div class="ve-editor" style="display:none"><textarea class="ve-source">' + esc(fullPreamble) + '</textarea></div></div>';
  }

  function splitDocument(src) {
    var bm = /\\begin\{document\}/.exec(src);
    var em = /\\end\{document\}/.exec(src);
    if (!bm) return { preamble: '', body: src, bodyOffset: 0, bodyEnd: src.length };
    var bi = bm.index + bm[0].length;
    var ei = em ? em.index : src.length;
    return { preamble: src.substring(0, bm.index), body: src.substring(bi, ei), bodyOffset: bi, bodyEnd: ei };
  }

  function extractCmdInfo(text, cmd) {
    var m = new RegExp('\\\\' + cmd + '\\s*(?:\\[[^\\]]*\\])?\\s*\\{').exec(text);
    if (!m) return null;
    var bs = m.index + m[0].length - 1;
    var c = braceContent(text, bs);
    if (c === null) return null;
    var fullCmd = text.substring(m.index, bs + 1 + c.length + 1);
    return {
      content: c,
      fullCmd: fullCmd,
      cmdStart: m.index,
      cmdEnd: bs + 1 + c.length + 1,
      contentStart: bs + 1,
      contentEnd: bs + 1 + c.length,
    };
  }

  function extractMacros(pre) {
    var r = {}, m;
    var re = /\\(?:re)?newcommand\s*\{?(\\[a-zA-Z]+)\}?\s*(?:\[\d+\])?\s*\{/g;
    while ((m = re.exec(pre)) !== null) { var d = braceContent(pre, m.index + m[0].length - 1); if (d !== null) r[m[1]] = d; }
    var dmo = /\\DeclareMathOperator\*?\s*\{?(\\[a-zA-Z]+)\}?\s*\{([^}]+)\}/g;
    while ((m = dmo.exec(pre)) !== null) r[m[1]] = '\\operatorname{' + m[2] + '}';
    return r;
  }

  // =============================================
  // TITLE BLOCK (preamble fields, click-to-edit)
  // =============================================
  function renderTitleBlock() {
    var h = '<div class="title-block">';
    var allThanks = [];

    if (titleInfo) {
      var tt = renderTitleWithThanks(titleInfo.content, allThanks.length);
      h += makePreambleBlock('doc-title', 'h1', titleInfo, tt.html);
      allThanks = allThanks.concat(tt.footnotes);
    }

    if (authorInfo) {
      var at = renderTitleWithThanks(authorInfo.content, allThanks.length);
      h += makePreambleBlock('doc-author', 'div', authorInfo, at.html);
      allThanks = allThanks.concat(at.footnotes);
    }

    if (dateInfo) {
      var dd = dateInfo.content.trim() === '\\today' ? new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}) : processInline(dateInfo.content);
      h += makePreambleBlock('doc-date', 'div', dateInfo, dd);
    }

    if (allThanks.length > 0) {
      h += '<div class="title-footnotes">';
      var markers = ['*', '†', '‡', '§', '¶', '‖'];
      for (var i = 0; i < allThanks.length; i++) {
        var mark = markers[i % markers.length];
        h += '<div class="title-footnote"><span class="fn-marker">' + mark + '</span> ' + processInline(allThanks[i]) + '</div>';
      }
      h += '</div>';
    }

    h += '</div>';
    return h;
  }

  function renderTitleWithThanks(text, startIdx) {
    startIdx = startIdx || 0;
    var footnotes = [];
    var markers = ['*', '†', '‡', '§', '¶', '‖'];
    var placeholders = [];
    var processed = '';
    var pos = 0;
    while (pos < text.length) {
      var tm = text.substring(pos).match(/^\\thanks\s*\{/);
      if (tm) {
        var braceStart = pos + tm[0].length - 1;
        var content = braceContent(text, braceStart);
        if (content !== null) {
          var mark = markers[(startIdx + footnotes.length) % markers.length];
          footnotes.push(content);
          var ph = '%%THANKS' + placeholders.length + '%%';
          placeholders.push('<sup class="thanks-mark">' + mark + '</sup>');
          processed += ph;
          pos = braceStart + content.length + 2;
          continue;
        }
      }
      processed += text[pos];
      pos++;
    }
    var html = processInline(processed);
    for (var i = 0; i < placeholders.length; i++) {
      html = html.replace('%%THANKS' + i + '%%', placeholders[i]);
    }
    return { html: html, footnotes: footnotes };
  }

  function makePreambleBlock(cls, tag, info, rendered) {
    var bid = 'blk-' + (blockIdCounter++);
    blockStore[bid] = info.fullCmd;
    return '<div class="ve-block ve-preamble" data-block-id="' + bid + '" data-src-start="' + info.cmdStart + '" data-src-end="' + info.cmdEnd + '">' +
      '<div class="ve-rendered"><' + tag + ' class="' + cls + '">' + rendered + '</' + tag + '></div>' +
      '<div class="ve-editor" style="display:none"><textarea class="ve-source">' + esc(info.fullCmd) + '</textarea></div></div>';
  }

  // =============================================
  // BLOCK PROCESSOR — splits body into blocks
  // =============================================
  function processBlocks(text, base) {
    var html = '';
    var pos = 0;

    while (pos < text.length) {
      // Skip whitespace/blank lines between blocks
      var ws = skipWs(text, pos);
      if (ws >= text.length) break;
      pos = ws;

      // Skip full-line comments so they do not become empty blocks.
      if (text[pos] === '%' && (pos === 0 || text[pos - 1] !== '\\')) {
        pos = skipComment(text, pos);
        continue;
      }

      // Determine block type
      var blockStart = pos;
      var blockRendered, blockEnd;

      // \maketitle — skip
      var mkM = mat(text, pos, /^\\maketitle\b\s*/);
      if (mkM) { pos += mkM[0].length; continue; }

      // Skip commands that produce no output
      var skM = mat(text, pos, /^\\(?:clearpage|newpage|pagebreak|bigskip|medskip|smallskip|noindent|indent|centering|raggedright|raggedleft|singlespacing|doublespacing|onehalfspacing|normalsize|small|footnotesize|scriptsize|tiny|large|Large|LARGE|huge|Huge|protect|relax|allowbreak)\b\s*/);
      if (skM) { pos += skM[0].length; continue; }

      // \vspace{}, \hspace{}, etc.
      var spM = mat(text, pos, /^\\(?:vspace|hspace|addvspace|setlength|setcounter|addtocounter|stepcounter)\*?\s*\{/);
      if (spM) { var sb = pos + spM[0].length - 1; var sc = braceContent(text, sb); pos = sc !== null ? sb + sc.length + 2 : pos + spM[0].length; pos = skipWs(text, pos); continue; }

      // \label{} — skip
      var lbM = mat(text, pos, /^\\label\s*\{/);
      if (lbM) { var lb = pos + lbM[0].length - 1; var lc = braceContent(text, lb); pos = lc !== null ? lb + lc.length + 2 : pos + lbM[0].length; continue; }

      // \begin{environment}
      var envM = mat(text, pos, /^\\begin\{(\w+\*?)\}(\[[^\]]*\])?/);
      if (envM) {
        var en = envM[1], ebs = pos + envM[0].length;
        var ee = findEndEnv(text, ebs, en);
        if (ee !== -1) {
          var ec = text.substring(ebs, ee);
          var fullSrc = text.substring(pos, ee + ('\\end{' + en + '}').length);
          blockEnd = ee + ('\\end{' + en + '}').length;
          blockRendered = renderEnvironment(en, ec, envM[2] || '', fullSrc);
          html += wrapBlock(currentSource.substring(base + blockStart, base + blockEnd), blockRendered, base + blockStart, base + blockEnd);
          pos = blockEnd;
          continue;
        }
      }

      // \section{...}
      var secM = mat(text, pos, /^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*\{/);
      if (secM) {
        var sl = secM[1], sbs = pos + secM[0].length - 1;
        var st = braceContent(text, sbs);
        if (st !== null) {
          blockEnd = sbs + st.length + 2;
          var tags = {part:'h1',chapter:'h1',section:'h2',subsection:'h3',subsubsection:'h4',paragraph:'h5',subparagraph:'h6'};
          blockRendered = '<' + (tags[sl]||'h2') + ' class="section-heading section-' + sl + '">' + processInline(st) + '</' + (tags[sl]||'h2') + '>';
          html += wrapBlock(currentSource.substring(base + blockStart, base + blockEnd), blockRendered, base + blockStart, base + blockEnd);
          pos = blockEnd;
          continue;
        }
      }

      // $$...$$
      if (text[pos] === '$' && text[pos+1] === '$') {
        var dde = text.indexOf('$$', pos + 2);
        if (dde !== -1) {
          blockEnd = dde + 2;
          var ddSrc = text.substring(pos, blockEnd);
          blockRendered = renderMathDisplay(text.substring(pos+2, dde));
          html += wrapBlock(ddSrc, blockRendered, base + blockStart, base + blockEnd);
          pos = blockEnd;
          continue;
        }
      }

      // \[...\]
      if (text[pos] === '\\' && text[pos+1] === '[') {
        var sqe = text.indexOf('\\]', pos + 2);
        if (sqe !== -1) {
          blockEnd = sqe + 2;
          var sqSrc = text.substring(pos, blockEnd);
          blockRendered = renderMathDisplay(text.substring(pos+2, sqe));
          html += wrapBlock(sqSrc, blockRendered, base + blockStart, base + blockEnd);
          pos = blockEnd;
          continue;
        }
      }

      // \input{}, \include{}
      var inM = mat(text, pos, /^\\(?:input|include)\s*\{/);
      if (inM) { var ib = pos + inM[0].length - 1; var ic = braceContent(text, ib); if (ic !== null) { blockEnd = ib + ic.length + 2; html += wrapBlock(text.substring(blockStart, blockEnd), '<div class="input-marker">[Input: ' + esc(ic) + ']</div>', base + blockStart, base + blockEnd); pos = blockEnd; continue; } }

      // \bibliography etc — skip
      var biM = mat(text, pos, /^\\(?:bibliography|bibliographystyle|pagestyle|thispagestyle)\s*\{/);
      if (biM) { var bb = pos + biM[0].length - 1; var bc = braceContent(text, bb); pos = bc !== null ? bb + bc.length + 2 : pos + biM[0].length; continue; }

      // Paragraph — collect text until next block-level element or double newline
      var paraEnd = findParaEnd(text, pos);
      var paraText = text.substring(pos, paraEnd);
      if (paraText.trim()) {
        var cleanPara = stripComments(paraText);
        if (cleanPara.trim()) {
          blockRendered = '<p>' + processInline(cleanPara.trim()) + '</p>';
          html += wrapBlock(currentSource.substring(base + pos, base + paraEnd), blockRendered, base + pos, base + paraEnd);
        }
      }
      pos = paraEnd;
    }

    return html;
  }

  function wrapBlock(source, rendered, srcStart, srcEnd) {
    var bid = 'blk-' + (blockIdCounter++);
    blockStore[bid] = source;
    return '<div class="ve-block" data-block-id="' + bid + '" data-src-start="' + srcStart + '" data-src-end="' + srcEnd + '">' +
      '<div class="ve-rendered">' + rendered + '</div>' +
      '<div class="ve-editor" style="display:none"><textarea class="ve-source">' + esc(source) + '</textarea></div></div>';
  }

  function findParaEnd(text, start) {
    var pos = start;
    while (pos < text.length) {
      if (text[pos] === '%' && (pos === 0 || text[pos - 1] !== '\\')) {
        pos = skipComment(text, pos);
        continue;
      }
      // Double newline = paragraph break
      if (text[pos] === '\n') {
        var nlEnd = pos;
        var nlCount = 0;
        while (nlEnd < text.length && /[\s]/.test(text[nlEnd])) { if (text[nlEnd] === '\n') nlCount++; nlEnd++; }
        if (nlCount >= 2) return nlEnd;
        pos = nlEnd;
        continue;
      }
      // Structural command = new block
      if (text[pos] === '\\') {
        if (mat(text, pos, /^\\begin\{/)) return pos;
        if (mat(text, pos, /^\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*\{/)) return pos;
        if (mat(text, pos, /^\\(?:input|include)\s*\{/)) return pos;
        if (text[pos+1] === '[') {
          // Check if this is display math \[...\] at start of line
          var lineStart = pos;
          while (lineStart > start && text[lineStart-1] !== '\n') lineStart--;
          if (text.substring(lineStart, pos).trim() === '') return pos;
        }
      }
      if (text[pos] === '$' && text[pos+1] === '$') {
        var lineStart2 = pos;
        while (lineStart2 > start && text[lineStart2-1] !== '\n') lineStart2--;
        if (text.substring(lineStart2, pos).trim() === '') return pos;
      }
      pos++;
    }
    return text.length;
  }

  function stripComments(text) {
    return text.split('\n').map(function(l) {
      for (var i = 0; i < l.length; i++) if (l[i] === '%' && (i === 0 || l[i-1] !== '\\')) return l.substring(0, i);
      return l;
    }).join('\n');
  }

  // =============================================
  // ENVIRONMENT RENDERERS
  // =============================================
  var MATH_ENVS = ['equation','equation*','align','align*','gather','gather*','multline','multline*','flalign','flalign*','alignat','alignat*','eqnarray','eqnarray*','math','displaymath'];
  var TIKZ_ENVS = ['tikzpicture','pgfpicture'];

  function renderEnvironment(en, content, opts, fullSrc) {
    if (MATH_ENVS.indexOf(en) !== -1) {
      var w = '\\begin{' + en + '}' + content + '\\end{' + en + '}';
      return renderMathDisplay(w);
    }
    if (TIKZ_ENVS.indexOf(en) !== -1) return renderTikzPreview();
    if (en === 'abstract') return '<div class="abstract"><div class="abstract-title">Abstract</div><div class="abstract-body">' + renderInnerBlocks(content) + '</div></div>';
    if (en === 'figure' || en === 'figure*') return renderFigure(content);
    if (en === 'table' || en === 'table*') return renderTableEnv(content);
    if (en === 'tabular' || en === 'tabular*' || en === 'tabularx') return renderTabular(content);
    if (en === 'itemize') return renderList(content, 'ul');
    if (en === 'enumerate') return renderList(content, 'ol');
    if (en === 'description') return renderDescList(content);
    if (en === 'quote' || en === 'quotation') return '<blockquote class="latex-quote">' + renderInnerBlocks(content) + '</blockquote>';
    if (en === 'center') return '<div class="center">' + renderInnerBlocks(content) + '</div>';
    if (en === 'verbatim' || en === 'lstlisting') return '<pre class="verbatim">' + esc(content) + '</pre>';
    if (en === 'minipage') return '<div class="minipage">' + renderInnerBlocks(content) + '</div>';

    var thms = ['theorem','lemma','proposition','corollary','definition','remark','example','proof','assumption','conjecture','observation','claim','fact','hypothesis','notation'];
    if (thms.indexOf(en) !== -1) {
      var lbl = en.charAt(0).toUpperCase() + en.slice(1);
      var isPf = en === 'proof';
      return '<div class="theorem-env ' + en + '-env"><span class="theorem-label">' + (isPf ? 'Proof.' : lbl + '.') + '</span> ' + renderInnerBlocks(content) + (isPf ? ' <span class="qed">&#9633;</span>' : '') + '</div>';
    }
    return '<div class="unknown-env">' + renderInnerBlocks(content) + '</div>';
  }

  function renderInnerBlocks(content) {
    var cleaned = stripComments(content);
    var paras = cleaned.split(/\n\s*\n/);
    var html = '';
    for (var i = 0; i < paras.length; i++) {
      var p = paras[i].trim();
      if (p) html += '<p>' + processInline(p) + '</p>';
    }
    return html;
  }

  function renderMathDisplay(latex) {
    var id = 'math-' + (mathIdCounter++);
    mathStore[id] = cleanMath(latex);
    return '<div class="math-rendered math-display" data-math-id="' + id + '"></div>';
  }

  function renderTikzPreview() {
    return '<div class="tikz-preview">' +
      '<svg class="tikz-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><polyline points="7,14 10,17 17,12"/></svg>' +
      '<div class="tikz-placeholder">TikZ Figure</div>' +
      '<div class="tikz-hint">Click to edit source</div></div>';
  }

  function renderInlineMath(latex) {
    var id = 'math-' + (mathIdCounter++);
    mathStore[id] = latex;
    return '<span class="math-inline" data-math-id="' + id + '"></span>';
  }

  function cleanMath(l) { return l.replace(/\\label\{[^}]*\}/g, '').replace(/\\tag\{[^}]*\}/g, '').replace(/\\nonumber/g, '').replace(/\\notag/g, ''); }

  function renderAllMath() {
    if (typeof katex === 'undefined') return;
    var inl = document.querySelectorAll('.math-inline[data-math-id]');
    for (var i = 0; i < inl.length; i++) { var il = mathStore[inl[i].getAttribute('data-math-id')]; if (!il) continue; try { katex.render(cleanMath(il), inl[i], { displayMode: false, throwOnError: false, macros: Object.assign({}, macros), trust: true, strict: false }); } catch (e) { inl[i].textContent = il; inl[i].classList.add('math-error'); } }
    var dsp = document.querySelectorAll('.math-display[data-math-id]');
    for (var j = 0; j < dsp.length; j++) { var dl = mathStore[dsp[j].getAttribute('data-math-id')]; if (!dl) continue; try { katex.render(dl, dsp[j], { displayMode: true, throwOnError: false, macros: Object.assign({}, macros), trust: true, strict: false }); } catch (e) { dsp[j].innerHTML = '<span class="math-error">' + esc(e.message) + '</span>'; } }
  }

  // =============================================
  // FIGURES, TABLES, LISTS
  // =============================================
  function renderFigure(c) {
    var h = '<div class="figure">';
    var im = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/.exec(c);
    if (im) { var s = baseUri ? baseUri + '/' + im[1] : im[1]; h += '<div class="figure-img"><img src="' + escA(s) + '" alt="' + escA(im[1]) + '"></div>'; }
    var cm = /\\caption\s*\{/.exec(c); if (cm) { var ct = braceContent(c, c.indexOf('{', cm.index)); if (ct) h += '<div class="figure-caption"><strong>Figure:</strong> ' + processInline(ct) + '</div>'; }
    return h + '</div>';
  }

  function renderTableEnv(c) {
    var h = '<div class="table-env">';
    var cm = /\\caption\s*\{/.exec(c); if (cm) { var ct = braceContent(c, c.indexOf('{', cm.index)); if (ct) h += '<div class="table-caption"><strong>Table:</strong> ' + processInline(ct) + '</div>'; }
    var tm = /\\begin\{(tabular\*?|tabularx)\}\s*(?:\{[^}]*\})?(?:\{[^}]*\})?/.exec(c);
    if (tm) { var ts = tm.index + tm[0].length, te = findEndEnv(c, ts, tm[1]); if (te !== -1) h += renderTabular(c.substring(ts, te)); }
    return h + '</div>';
  }

  function renderTabular(c) {
    var rows = c.split(/\\\\/), h = '<table class="latex-table">', first = true;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r].replace(/\\(?:hline|toprule|midrule|bottomrule|cline\{[^}]*\}|cmidrule(?:\([^)]*\))?\{[^}]*\}|arraystretch)/g, '').trim();
      if (!row) continue;
      var cells = splitCells(row), tag = first ? 'th' : 'td';
      h += '<tr>';
      for (var c2 = 0; c2 < cells.length; c2++) {
        var cell = cells[c2].trim();
        var mc = cell.match(/\\multicolumn\{(\d+)\}\{[^}]*\}\{([\s\S]*)\}/);
        h += mc ? '<' + tag + ' colspan="' + mc[1] + '">' + processInline(mc[2]) + '</' + tag + '>' : '<' + tag + '>' + processInline(cell) + '</' + tag + '>';
      }
      h += '</tr>';
      first = false;
    }
    return h + '</table>';
  }

  function splitCells(r) { var c = [], cu = '', d = 0; for (var i = 0; i < r.length; i++) { if (r[i] === '{') d++; if (r[i] === '}') d--; if (r[i] === '&' && d === 0) { c.push(cu); cu = ''; } else cu += r[i]; } c.push(cu); return c; }

  function renderList(c, tag) {
    var h = '<' + tag + ' class="latex-list">';
    var items = c.split(/\\item\s*(?:\[[^\]]*\])?\s*/);
    for (var i = 0; i < items.length; i++) if (items[i].trim()) h += '<li>' + processInline(stripComments(items[i]).trim()) + '</li>';
    return h + '</' + tag + '>';
  }

  function renderDescList(c) {
    var h = '<dl class="latex-list">';
    var items = c.split(/\\item\s*/);
    for (var i = 0; i < items.length; i++) {
      if (!items[i].trim()) continue;
      var bm = items[i].match(/^\[([^\]]*)\]\s*/);
      if (bm) { h += '<dt>' + processInline(bm[1]) + '</dt><dd>' + processInline(stripComments(items[i].substring(bm[0].length)).trim()) + '</dd>'; }
      else h += '<dd>' + processInline(stripComments(items[i]).trim()) + '</dd>';
    }
    return h + '</dl>';
  }

  // =============================================
  // CITATION FORMATTING
  // =============================================
  function fmtCite(keys, style) {
    var parts = keys.split(',');
    var rendered = [];
    for (var i = 0; i < parts.length; i++) {
      var key = parts[i].trim();
      var c = citations[key];
      var display;
      if (c) {
        if (style === 'author') display = c.author;
        else if (style === 'text') display = c.author + ' (' + c.year + ')';
        else display = c.author + ', ' + c.year;
      } else {
        display = key;
      }
      rendered.push('<span class="cite-key" title="' + escA(key) + '">' + esc(display) + '</span>');
    }
    var inner = rendered.join('; ');
    if (style === 'paren') return '<span class="citation">(' + inner + ')</span>';
    return '<span class="citation">' + inner + '</span>';
  }

  // =============================================
  // INLINE PROCESSING
  // =============================================
  function processInline(text) {
    var h = '', p = 0;
    while (p < text.length) {
      if (text[p] === '$' && (p === 0 || text[p-1] !== '\\') && text[p+1] !== '$') { var e = findDollar(text, p+1); if (e !== -1) { h += renderInlineMath(text.substring(p+1, e)); p = e+1; continue; } }
      if (text[p] === '\\' && text[p+1] === '(') { var pe = text.indexOf('\\)', p+2); if (pe !== -1) { h += renderInlineMath(text.substring(p+2, pe)); p = pe+2; continue; } }
      if (text[p] === '\\') { var cr = processInlineCmd(text, p); if (cr) { h += cr.html; p = cr.end; continue; } }
      var ch = text[p];
      if (ch === '~') { h += '&nbsp;'; p++; }
      else if (ch === '-' && text[p+1] === '-') { if (text[p+2] === '-') { h += '&mdash;'; p += 3; } else { h += '&ndash;'; p += 2; } }
      else if (ch === '`' && text[p+1] === '`') { h += '“'; p += 2; }
      else if (ch === '\'' && text[p+1] === '\'') { h += '”'; p += 2; }
      else if (ch === '\n') { h += ' '; p++; }
      else { h += esc(ch); p++; }
    }
    return h;
  }

  function processInlineCmd(text, pos) {
    if (text[pos] !== '\\') return null;
    var em = mat(text, pos, /^\\([%$&#_{}\~\^])/);
    if (em) { var e = em[1]; if (e === '~') return { html: '&tilde;', end: pos+2 }; if (e === '^') return { html: '&circ;', end: pos+2 }; return { html: esc(e), end: pos + em[0].length }; }
    if (text[pos+1] === '\\') { var be = pos+2; if (text[be] === '[') { var bc = text.indexOf(']', be); if (bc !== -1) be = bc+1; } return { html: '<br>', end: be }; }
    var cm = mat(text, pos, /^\\([a-zA-Z@]+)\*?/); if (!cm) return null;
    var cn = cm[1], ce = pos + cm[0].length;
    var brace = {
      textbf:function(c){return'<strong>'+processInline(c)+'</strong>';},textit:function(c){return'<em>'+processInline(c)+'</em>';},emph:function(c){return'<em>'+processInline(c)+'</em>';},underline:function(c){return'<u>'+processInline(c)+'</u>';},textsc:function(c){return'<span class="smallcaps">'+processInline(c)+'</span>';},texttt:function(c){return'<code>'+processInline(c)+'</code>';},text:function(c){return processInline(c);},mbox:function(c){return processInline(c);},
      cite:function(c){return fmtCite(c,'paren');},citep:function(c){return fmtCite(c,'paren');},citet:function(c){return fmtCite(c,'text');},citeauthor:function(c){return fmtCite(c,'author');},autocite:function(c){return fmtCite(c,'paren');},
      ref:function(c){return'<span class="reference">'+esc(c)+'</span>';},eqref:function(c){return'<span class="reference">('+esc(c)+')</span>';},autoref:function(c){return'<span class="reference">'+esc(c)+'</span>';},Cref:function(c){return'<span class="reference">'+esc(c)+'</span>';},cref:function(c){return'<span class="reference">'+esc(c)+'</span>';},hyperref:function(c){return'<span class="reference">'+processInline(c)+'</span>';},
      footnote:function(c){return'<sup class="footnote" title="'+escA(c)+'">[fn]</sup>';},thanks:function(c){return'<sup class="footnote" title="'+escA(c)+'">*</sup>';},url:function(c){return'<a class="url">'+esc(c)+'</a>';},
      label:function(){return'';},tag:function(){return'';},phantom:function(){return'';},hphantom:function(){return'';},vphantom:function(){return'';}
    };
    if (brace.hasOwnProperty(cn)) { var np = skipWs(text, ce); if (text[np] === '[') { var cb = text.indexOf(']', np); if (cb !== -1) np = cb+1; } np = skipWs(text, np); if (text[np] === '{') { var bc2 = braceContent(text, np); if (bc2 !== null) return { html: brace[cn](bc2), end: np+bc2.length+2 }; } if (['label','tag','phantom','hphantom','vphantom'].indexOf(cn) !== -1) return { html: '', end: ce }; }
    if (cn === 'href') { var hn = skipWs(text, ce); if (text[hn] === '{') { var hu = braceContent(text, hn); if (hu !== null) { var hn2 = skipWs(text, hn+hu.length+2); if (text[hn2] === '{') { var ht = braceContent(text, hn2); if (ht !== null) return { html: '<a class="url">' + processInline(ht) + '</a>', end: hn2+ht.length+2 }; } } } }
    if (cn === 'includegraphics') { var ig = skipWs(text, ce); if (text[ig] === '[') { var igb = text.indexOf(']', ig); if (igb !== -1) ig = igb+1; } ig = skipWs(text, ig); if (text[ig] === '{') { var igp = braceContent(text, ig); if (igp !== null) { var igs = baseUri ? baseUri+'/'+igp : igp; return { html: '<img src="'+escA(igs)+'" alt="'+escA(igp)+'" style="max-width:100%">', end: ig+igp.length+2 }; } } }
    var space = {quad:'&emsp;',qquad:'&emsp;&emsp;',enspace:'&ensp;',thinspace:'&thinsp;',hfill:'<span class="hfill"></span>'};
    if (space.hasOwnProperty(cn)) return { html: space[cn], end: ce };
    var skip = ['noindent','indent','centering','raggedright','raggedleft','par','newline','protect','relax','bibliographystyle','pagestyle','thispagestyle','pagenumbering','setstretch','spacing','singlespacing','doublespacing','onehalfspacing'];
    if (skip.indexOf(cn) !== -1) { var sn = skipWs(text, ce); if (text[sn] === '{') { var sc2 = braceContent(text, sn); if (sc2 !== null) return { html: '', end: sn+sc2.length+2 }; } return { html: '', end: ce }; }
    { var un = skipWs(text, ce); if (text[un] === '{') { var uc = braceContent(text, un); if (uc !== null) return { html: processInline(uc), end: un+uc.length+2 }; } }
    return { html: '', end: ce };
  }

  // =============================================
  // UTILITIES
  // =============================================
  function braceContent(text, o) {
    if (!text || o >= text.length || text[o] !== '{') return null;
    var d = 0;
    for (var i = o; i < text.length; i++) {
      if (text[i] === '%' && (i === 0 || text[i - 1] !== '\\')) {
        i = skipComment(text, i) - 1;
        continue;
      }
      if (text[i] === '{' && (i === 0 || text[i - 1] !== '\\')) d++;
      if (text[i] === '}' && (i === 0 || text[i - 1] !== '\\')) {
        d--;
        if (d === 0) return text.substring(o + 1, i);
      }
    }
    return text.substring(o + 1);
  }
  function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }
  function escA(s) { return s ? s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }
  function mat(t, p, r) { return r.exec(t.substring(p)); }
  function skipWs(t, p) { while (p < t.length && /[\s]/.test(t[p])) p++; return p; }
  function skipComment(t, p) { while (p < t.length && t[p] !== '\n') p++; return p; }
  function findDollar(t, s) { for (var i = s; i < t.length; i++) { if (t[i] === '$' && t[i-1] !== '\\') return i; if (t[i] === '\n' && t[i+1] === '\n') return -1; } return -1; }
  function findEndEnv(t, s, n) {
    var d = 1, p = s, bt = '\\begin{' + n + '}', et = '\\end{' + n + '}';
    while (p < t.length && d > 0) {
      if (t[p] === '%' && (p === 0 || t[p - 1] !== '\\')) {
        p = skipComment(t, p);
        continue;
      }
      if (t.substring(p, p + bt.length) === bt) {
        d++;
        p += bt.length;
      } else if (t.substring(p, p + et.length) === et) {
        d--;
        if (d === 0) return p;
        p += et.length;
      } else {
        p++;
      }
    }
    return -1;
  }

  // =============================================
  // INIT
  // =============================================
  var state = vscode.getState();
  if (state && state.source) { currentSource = state.source; if (state.baseUri) baseUri = state.baseUri; render(); }
  vscode.postMessage({ type: 'ready' });
})();
