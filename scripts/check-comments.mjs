#!/usr/bin/env node
/**
 * 零外部依赖的中文注释轻量静态门禁（仅拦截确定性格式违规，不以注释覆盖率或字数为指标）：
 * 1. Go 生产代码（backend/cmd 与 backend/internal 非测试文件）：
 *    - 每个包具备规范中文 `// Package <name>` 包注释；
 *    - 顶层导出符号（导出函数、导出类型的导出方法、导出类型、单行导出 var/const）具备以符号名开头的中文 Go Doc；
 *    - 禁止英文分隔栏与非指令纯英文注释。
 * 2. 前端业务代码与脚本（src/ 排除自动生成文件与 components/ui/，含 vite.config.ts 与 scripts/*.mjs）：
 *    - 禁止英文分隔栏与非指令纯英文注释；
 *    - 导出符号紧上方若编写说明注释须使用 JSDoc，避免误用 // 行注释（无注释的导出保持放行）。
 * 支持 `--self-test` 运行纯内存解析器边界自检（零磁盘 IO、防回归）。
 */
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const CJK_RE = /[\u4e00-\u9fff]/;
const ENGLISH_WORD_RE = /[A-Za-z]{3,}/;
const ENGLISH_BANNER_RE = /^[=\-*#]{3,}.*[A-Za-z]{2,}/;
const TOOL_DIRECTIVE_RE = /^(?:biome-ignore|@ts-|eslint-)/;
const TS_EXPORT_DECL_RE =
  /^export\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|const|type|interface|class|enum)\b/;

/** 递归收集目录下匹配条件的文件路径，收集完毕后统一升序排序。 */
function walkFiles(dir, predicate) {
  /** @type {string[]} */
  const out = [];
  function visit(current) {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile() && predicate(full)) {
        out.push(full);
      }
    }
  }
  visit(dir);
  return out.sort();
}

/** 判断一行注释正文是否为允许的非中文工具指令、JSDoc 类型标注或纯代码/URL 标记。 */
function isAllowedNonCjkComment(commentText) {
  const s = commentText.trim();
  if (!s) return true;
  if (
    /^(?:go:|nolint|cross-table:|Spec:|biome-ignore|@ts-|eslint-|shellcheck|@type\b|@returns\b|@param\b|https?:\/\/)/.test(
      s,
    )
  ) {
    return true;
  }
  return !ENGLISH_WORD_RE.test(s);
}

/**
 * 轻量词法扫描整文件，精准识别每行的起始状态（跳过双引号/单引号/反引号多行字符串与块注释），
 * 避免多行字符串内的 `/*`、`//`、`type`、`export` 干扰注释与声明检查。
 * @returns {Array<{ lineNo: number, raw: string, kind: 'code' | 'line_comment' | 'block_comment' | 'string_cont', blockBody?: string }>}
 */
function classifyLines(content, { supportSingleQuoteString }) {
  const rawLines = content.split(/\r?\n/);
  /** @type {Array<{ lineNo: number, raw: string, kind: 'code' | 'line_comment' | 'block_comment' | 'string_cont', blockBody?: string }>} */
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
      records.push({ lineNo, raw, kind: 'string_cont' });
      // 在反引号多行字符串内继续推进直到闭合反引号（TS 支持反斜杠转义，Go 原始字符串不支持转义）
      for (let c = 0; c < raw.length; c++) {
        if (supportSingleQuoteString && raw[c] === '\\') {
          c++;
          continue;
        }
        if (raw[c] === '`') {
          inBacktick = false;
          ({ inBlockComment, inBacktick, blockStartLineNo, blockLines } = scanRestOfLine(
            raw,
            c + 1,
            lineNo,
            supportSingleQuoteString,
            { inBlockComment, inBacktick, blockStartLineNo, blockLines },
          ));
          break;
        }
      }
      continue;
    }

    if (inBlockComment) {
      blockLines.push(raw);
      const endPos = raw.indexOf('*/');
      if (endPos !== -1) {
        inBlockComment = false;
        records.push({ lineNo: blockStartLineNo, raw, kind: 'block_comment', blockBody: blockLines.join('\n') });
        blockLines = [];
        ({ inBlockComment, inBacktick, blockStartLineNo, blockLines } = scanRestOfLine(
          raw,
          endPos + 2,
          lineNo,
          supportSingleQuoteString,
          { inBlockComment, inBacktick, blockStartLineNo, blockLines },
        ));
      } else {
        records.push({ lineNo, raw, kind: 'block_comment' });
      }
      continue;
    }

    if (trimmed.startsWith('//')) {
      records.push({ lineNo, raw, kind: 'line_comment' });
      continue;
    }

    if (trimmed.startsWith('/*')) {
      const endPos = raw.indexOf('*/', raw.indexOf('/*') + 2);
      if (endPos !== -1) {
        records.push({ lineNo, raw, kind: 'block_comment', blockBody: raw.slice(raw.indexOf('/*'), endPos + 2) });
        ({ inBlockComment, inBacktick, blockStartLineNo, blockLines } = scanRestOfLine(
          raw,
          endPos + 2,
          lineNo,
          supportSingleQuoteString,
          { inBlockComment, inBacktick, blockStartLineNo, blockLines },
        ));
      } else {
        inBlockComment = true;
        blockStartLineNo = lineNo;
        blockLines = [raw];
        records.push({ lineNo, raw, kind: 'block_comment' });
      }
      continue;
    }

    records.push({ lineNo, raw, kind: 'code' });
    ({ inBlockComment, inBacktick, blockStartLineNo, blockLines } = scanRestOfLine(
      raw,
      0,
      lineNo,
      supportSingleQuoteString,
      { inBlockComment, inBacktick, blockStartLineNo, blockLines },
    ));
  }

  return records;
}

/** 扫描代码行内字符，更新跨行反引号字符串与多行块注释状态。 */
function scanRestOfLine(raw, startCol, lineNo, supportSingleQuoteString, state) {
  let { inBlockComment, inBacktick, blockStartLineNo, blockLines } = state;
  let inDouble = false;
  let inSingle = false;

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
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === '`') {
      inBacktick = true;
    }
  }

  return { inBlockComment, inBacktick, blockStartLineNo, blockLines };
}

/**
 * 校验连续单行 // 注释块与独立块注释：
 * - 英文分隔栏（如 `// === UI ===`）逐行拦截；
 * - 非指令注释按连续块整体判断是否含中文，避免多行中文注释中的单行代码/枚举示例误报。
 */
function checkCommentBlocks(rel, classified, errors) {
  for (let i = 0; i < classified.length; i++) {
    const cur = classified[i];
    if (cur.kind === 'block_comment' && cur.blockBody) {
      const innerLines = cur.blockBody
        .replace(/^\/\*\*?/, '')
        .replace(/\*\/$/, '')
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*\*?\s*/, '').trim())
        .filter(Boolean);
      const prose = innerLines.filter((l) => !isAllowedNonCjkComment(l));
      if (prose.length > 0 && !CJK_RE.test(prose.join(' '))) {
        errors.push(`${rel}:${cur.lineNo} - 检测到纯英文块注释，请统一使用中文说明意图`);
      }
      continue;
    }

    if (cur.kind !== 'line_comment') continue;

    let end = i;
    while (end + 1 < classified.length && classified[end + 1].kind === 'line_comment') {
      end++;
    }
    /** @type {string[]} */
    const proseTexts = [];
    for (let k = i; k <= end; k++) {
      const commentText = classified[k].raw.trim().slice(2).trim();
      if (ENGLISH_BANNER_RE.test(commentText) && !CJK_RE.test(commentText)) {
        errors.push(`${rel}:${classified[k].lineNo} - 禁止使用英文分隔栏注释，请改为中文`);
        continue;
      }
      if (!isAllowedNonCjkComment(commentText)) {
        proseTexts.push(commentText);
      }
    }
    if (proseTexts.length > 0 && !CJK_RE.test(proseTexts.join(' '))) {
      errors.push(`${rel}:${cur.lineNo} - 检测到纯英文行注释，请统一使用中文说明意图`);
    }
    i = end;
  }
}

/** 判断 Go 注释行是否为编译器或静态检查指令（不计入 Go Doc 正文）。 */
function isGoDirectiveComment(trimmed) {
  return /^\/\/(?:go:|nolint\b)/.test(trimmed);
}

/** 提取某 Go 声明行紧上方连续的 // 文档注释块（自动跳过 //go: 与 //nolint 指令）。 */
function readPrecedingGoDoc(classified, declIndex) {
  let end = declIndex - 1;
  while (end >= 0 && classified[end].kind === 'line_comment' && isGoDirectiveComment(classified[end].raw.trim())) {
    end--;
  }
  if (end < 0 || classified[end].kind !== 'line_comment') {
    return null;
  }
  let start = end;
  while (start > 0) {
    const prev = classified[start - 1];
    if (prev.kind !== 'line_comment' || isGoDirectiveComment(prev.raw.trim())) break;
    start--;
  }
  return classified.slice(start, end + 1).map((item) => item.raw.trim());
}

/** 校验单个 Go 生产文件内容并更新所在包注释统计。 */
function inspectGoContent(rel, dir, content, pkgStats, errors) {
  const classified = classifyLines(content, { supportSingleQuoteString: false });
  checkCommentBlocks(rel, classified, errors);

  for (let i = 0; i < classified.length; i++) {
    const item = classified[i];
    if (item.kind !== 'code') continue;

    const raw = item.raw;
    const lineNo = item.lineNo;

    // 1. 包声明与包注释（严格匹配列 0 顶层声明）
    const pkgMatch = raw.match(/^package\s+(\w+)/);
    if (pkgMatch) {
      const pkgName = pkgMatch[1];
      const cur = pkgStats.get(dir) ?? { pkgName, hasDoc: false, sampleFile: rel };
      const doc = readPrecedingGoDoc(classified, i);
      if (doc) {
        cur.hasDoc = true;
        if (!new RegExp(`^//\\s*Package\\s+${pkgName}\\b`).test(doc[0])) {
          errors.push(`${rel}:${lineNo} - Go 包注释须以 "// Package ${pkgName} ..." 开头`);
        }
        if (!CJK_RE.test(doc.join(' '))) {
          errors.push(`${rel}:${lineNo} - Go 包注释须使用中文说明包职责`);
        }
      }
      pkgStats.set(dir, cur);
      continue;
    }

    // 2. 顶层导出符号 Go Doc 校验（严格匹配列 0，避免误伤函数内局部大写常量/类型；支持泛型接收者）
    let exportedSym = null;
    const methodMatch = raw.match(/^func\s+\(\s*(?:\w+\s+)?\*?([A-Z]\w*)(?:\[[^\]]+\])?\s*\)\s+([A-Z]\w*)\b/);
    if (methodMatch) {
      exportedSym = methodMatch[2];
    } else {
      const declMatch = raw.match(/^(?:func|type|var|const)\s+([A-Z]\w*)\b/);
      if (declMatch) {
        exportedSym = declMatch[1];
      }
    }

    if (exportedSym) {
      const doc = readPrecedingGoDoc(classified, i);
      if (!doc) {
        errors.push(`${rel}:${lineNo} - Go 导出符号 ${exportedSym} 缺少中文 Go Doc 注释`);
      } else {
        if (!new RegExp(`^//\\s*${exportedSym}\\b`).test(doc[0])) {
          errors.push(`${rel}:${lineNo} - Go Doc 注释须以符号名 "${exportedSym}" 开头`);
        }
        if (!CJK_RE.test(doc.join(' '))) {
          errors.push(`${rel}:${lineNo} - Go 导出符号 ${exportedSym} 的注释须使用中文`);
        }
      }
    }
  }
}

/** 校验单个 TS/TSX/JS 文件的英文注释残留及导出符号误用 // 替代 JSDoc。 */
function inspectTsContent(rel, content, errors) {
  const classified = classifyLines(content, { supportSingleQuoteString: true });
  checkCommentBlocks(rel, classified, errors);

  for (let i = 1; i < classified.length; i++) {
    const item = classified[i];
    if (item.kind !== 'code' || !TS_EXPORT_DECL_RE.test(item.raw)) continue;

    // 向上跳过工具指令行（biome-ignore / @ts- / eslint-）再判断是否紧贴非指令 // 注释
    let prevIdx = i - 1;
    while (
      prevIdx >= 0 &&
      classified[prevIdx].kind === 'line_comment' &&
      TOOL_DIRECTIVE_RE.test(classified[prevIdx].raw.trim().slice(2).trim())
    ) {
      prevIdx--;
    }
    if (prevIdx >= 0 && classified[prevIdx].kind === 'line_comment') {
      errors.push(`${rel}:${item.lineNo} - TS/TSX 导出符号的文档注释请使用 JSDoc (/** ... */) 而非 // 行注释`);
    }
  }
}

/** 检查 Go 生产代码包注释、顶层导出 Go Doc 与纯英文注释，返回扫描文件数。 */
function checkGoProd(errors) {
  const goFiles = [
    ...walkFiles(path.join(repoRoot, 'backend', 'cmd'), (f) => f.endsWith('.go') && !f.endsWith('_test.go')),
    ...walkFiles(path.join(repoRoot, 'backend', 'internal'), (f) => f.endsWith('.go') && !f.endsWith('_test.go')),
  ];

  /** @type {Map<string, { pkgName: string, hasDoc: boolean, sampleFile: string }>} */
  const pkgStats = new Map();

  for (const full of goFiles) {
    const rel = path.relative(repoRoot, full);
    inspectGoContent(rel, path.dirname(rel), fs.readFileSync(full, 'utf8'), pkgStats, errors);
  }

  for (const [dir, info] of pkgStats.entries()) {
    if (!info.hasDoc) {
      errors.push(`${info.sampleFile} (${dir}) - Go 包 ${info.pkgName} 缺少中文 "// Package ${info.pkgName}" 包注释`);
    }
  }
  return goFiles.length;
}

/** 检查前端业务代码与 Node 脚本，返回扫描文件数。 */
function checkTsAndScripts(errors) {
  const uiDir = `${path.join(repoRoot, 'src', 'components', 'ui')}${path.sep}`;
  const routeTree = path.join(repoRoot, 'src', 'routeTree.gen.ts');

  const files = [
    ...walkFiles(
      path.join(repoRoot, 'src'),
      (f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && f !== routeTree && !f.startsWith(uiDir),
    ),
    ...walkFiles(path.join(repoRoot, 'scripts'), (f) => f.endsWith('.mjs')),
    path.join(repoRoot, 'vite.config.ts'),
  ].filter((f) => fs.existsSync(f));

  for (const full of files) {
    const rel = path.relative(repoRoot, full);
    inspectTsContent(rel, fs.readFileSync(full, 'utf8'), errors);
  }
  return files.length;
}

/** 纯内存解析器边界自检（零磁盘 IO），防止后续调整门禁引入误报或漏报回归。 */
function runSelfTest() {
  /** @type {string[]} */
  const passErrors = [];
  const passPkgStats = new Map();
  inspectGoContent(
    'demo/ok.go',
    'demo',
    [
      '// Package demo 验证局部大写声明与原始字符串不误报。',
      'package demo',
      '',
      '// Run 正常导出方法。',
      '//nolint:unused',
      'func Run() string {',
      '\tconst LocalConst = 1',
      '\ttype LocalRow struct{}',
      '\ts := `',
      '/* unclosed block comment inside raw string',
      '// pure english line inside raw string',
      'type FakeExport int',
      '`',
      '\treturn s',
      '}',
    ].join('\n'),
    passPkgStats,
    passErrors,
  );
  inspectTsContent(
    'src/ok.ts',
    ['const tpl = `', '/* unclosed', 'export const Fake = 1;', '`;', 'export const real = tpl;'].join('\n'),
    passErrors,
  );
  if (passErrors.length > 0) {
    console.error('check-comments --self-test 正向边界用例出现误报：', passErrors);
    process.exit(1);
  }

  /** @type {string[]} */
  const failErrors = [];
  const failPkgStats = new Map();
  inspectGoContent(
    'demo/bad.go',
    'demo',
    ['// Package demo 验证违规拦截。', 'package demo', '', '// === UI ===', 'func MissingDoc() {}'].join('\n'),
    failPkgStats,
    failErrors,
  );
  inspectTsContent(
    'src/bad.ts',
    ['// 误用行注释', '// biome-ignore lint/suspicious/noExplicitAny: test', 'export default function Foo() {}'].join(
      '\n',
    ),
    failErrors,
  );
  const joined = failErrors.join('\n');
  if (!joined.includes('英文分隔栏') || !joined.includes('MissingDoc') || !joined.includes('JSDoc')) {
    console.error('check-comments --self-test 负向边界用例漏检：', failErrors);
    process.exit(1);
  }
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

/** @type {string[]} */
const errors = [];
const goFileCount = checkGoProd(errors);
const tsFileCount = checkTsAndScripts(errors);

if (goFileCount === 0 || tsFileCount === 0) {
  console.error(`中文注释门禁异常：扫描到的目标文件为空（Go=${goFileCount}, TS/JS=${tsFileCount}），请检查目录路径`);
  process.exit(1);
}

if (errors.length > 0) {
  console.error('中文注释门禁校验未通过：');
  for (const err of errors) {
    console.error(`  ${err}`);
  }
  process.exit(1);
}

console.log(`check-comments: ok (${goFileCount} Go / ${tsFileCount} TS+JS files)`);
