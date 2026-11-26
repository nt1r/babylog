/**
 * 零外部依赖的 Go 与 TS/JS 轻量行级词法扫描器，供中文注释门禁与 OpenSpec 场景引用校验共用。
 * 精确跟踪多行块注释与反引号原始字符串，并为代码行输出剥离注释与字符串字面量后的 `codeOnly` 视图，
 * 避免字符串内的 `/*`、`//`、`t.Run(` 或声明关键字干扰静态规则判断。
 */

/** 扫描代码行剩余字符，更新跨行反引号字符串与多行块注释状态，同时累积剥离字符串与注释后的纯代码片段。 */
function scanRestOfLine(raw, startCol, lineNo, supportSingleQuoteString, state) {
  let { inBlockComment, inBacktick, blockStartLineNo, blockLines } = state;
  let inDouble = false;
  let inSingle = false;
  let codeOnly = '';

  for (let c = startCol; c < raw.length; c++) {
    const ch = raw[c];
    const next = raw[c + 1];

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        blockLines = [];
        c++;
      }
      continue;
    }
    if (inBacktick) {
      if (supportSingleQuoteString && ch === '\\') {
        c++;
        continue;
      }
      if (ch === '`') inBacktick = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        c++;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === '\\') {
        c++;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      break;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      blockStartLineNo = lineNo;
      blockLines = [raw.slice(c)];
      c++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '`') {
      inBacktick = true;
      continue;
    }
    codeOnly += ch;
  }

  return { inBlockComment, inBacktick, blockStartLineNo, blockLines, codeOnly };
}

/**
 * 轻量词法扫描整文件，返回每行的类型与纯代码视图。
 * @param {string} content 文件源码全文
 * @param {{ supportSingleQuoteString: boolean }} options 是否启用单引号多字符字符串转义（TS/JS 传 true，Go 传 false）
 * @returns {Array<{ lineNo: number, raw: string, kind: 'code' | 'line_comment' | 'block_comment' | 'string_cont', blockBody?: string, codeOnly: string }>}
 */
export function classifyLines(content, { supportSingleQuoteString }) {
  const rawLines = content.split(/\r?\n/);
  /** @type {Array<{ lineNo: number, raw: string, kind: 'code' | 'line_comment' | 'block_comment' | 'string_cont', blockBody?: string, codeOnly: string }>} */
  const records = [];

  let inBlockComment = false;
  let inBacktick = false;
  /** @type {string[]} */
  let blockLines = [];
  let blockStartLineNo = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const trimmed = raw.trim();
    const lineNo = i + 1;

    if (inBacktick) {
      let codeOnly = '';
      // 在反引号多行字符串内继续推进直到闭合反引号（TS 支持反斜杠转义，Go 原始字符串不支持转义）
      for (let c = 0; c < raw.length; c++) {
        if (supportSingleQuoteString && raw[c] === '\\') {
          c++;
          continue;
        }
        if (raw[c] === '`') {
          inBacktick = false;
          ({ inBlockComment, inBacktick, blockStartLineNo, blockLines, codeOnly } = scanRestOfLine(
            raw,
            c + 1,
            lineNo,
            supportSingleQuoteString,
            { inBlockComment, inBacktick, blockStartLineNo, blockLines },
          ));
          break;
        }
      }
      records.push({ lineNo, raw, kind: 'string_cont', codeOnly });
      continue;
    }

    if (inBlockComment) {
      blockLines.push(raw);
      const endPos = raw.indexOf('*/');
      if (endPos !== -1) {
        inBlockComment = false;
        const blockBody = blockLines.join('\n');
        blockLines = [];
        let codeOnly = '';
        ({ inBlockComment, inBacktick, blockStartLineNo, blockLines, codeOnly } = scanRestOfLine(
          raw,
          endPos + 2,
          lineNo,
          supportSingleQuoteString,
          { inBlockComment, inBacktick, blockStartLineNo, blockLines },
        ));
        records.push({ lineNo: blockStartLineNo, raw, kind: 'block_comment', blockBody, codeOnly });
      } else {
        records.push({ lineNo, raw, kind: 'block_comment', codeOnly: '' });
      }
      continue;
    }

    if (trimmed.startsWith('//')) {
      records.push({ lineNo, raw, kind: 'line_comment', codeOnly: '' });
      continue;
    }

    if (trimmed.startsWith('/*')) {
      const endPos = raw.indexOf('*/', raw.indexOf('/*') + 2);
      if (endPos !== -1) {
        const blockBody = raw.slice(raw.indexOf('/*'), endPos + 2);
        let codeOnly = '';
        ({ inBlockComment, inBacktick, blockStartLineNo, blockLines, codeOnly } = scanRestOfLine(
          raw,
          endPos + 2,
          lineNo,
          supportSingleQuoteString,
          { inBlockComment, inBacktick, blockStartLineNo, blockLines },
        ));
        records.push({ lineNo, raw, kind: 'block_comment', blockBody, codeOnly });
      } else {
        inBlockComment = true;
        blockStartLineNo = lineNo;
        blockLines = [raw];
        records.push({ lineNo, raw, kind: 'block_comment', codeOnly: '' });
      }
      continue;
    }

    let codeOnly = '';
    ({ inBlockComment, inBacktick, blockStartLineNo, blockLines, codeOnly } = scanRestOfLine(
      raw,
      0,
      lineNo,
      supportSingleQuoteString,
      { inBlockComment, inBacktick, blockStartLineNo, blockLines },
    ));
    records.push({ lineNo, raw, kind: 'code', codeOnly });
  }

  return records;
}
