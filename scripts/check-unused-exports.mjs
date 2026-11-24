#!/usr/bin/env node
/**
 * 零外部依赖的前端未使用导出（死导出）静态检查：
 * 直接扫描 src/ 下的 TypeScript / TSX 文件（含类型与值导出），
 * 校验每个业务模块的导出符号是否至少被一个其他模块引用（豁免路由入口、自动生成文件、ui 原语库及启动脚本）。
 */
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const srcRoot = path.resolve(repoRoot, 'src');
const RESOLVE_EXTS = ['.ts', '.tsx', '.mts', '.js', '.jsx'];

/** 递归枚举 src/ 下全部 TS/TSX 源文件。 */
function listSourceFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx|mts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** 豁免文件：框架入口、自动生成文件、基础设计原语库及独立启动脚本。 */
function isExemptFromCheck(filePath) {
  const rel = path.relative(srcRoot, filePath).split(path.sep).join('/');
  if (rel.startsWith('..') || rel.endsWith('.d.ts')) return true;
  if (rel === 'main.tsx' || rel === 'routeTree.gen.ts') return true;
  if (rel.startsWith('routes/') || rel.startsWith('components/ui/') || rel.startsWith('scripts/')) {
    return true;
  }
  return false;
}

/**
 * 清除 // 与 /* *\/ 注释但保留换行符以维持行号准确；
 * 同时跳过单/双引号字符串与模板字面量，防止误删字符串内 URL（如 https://）。
 */
function stripCommentsPreserveLines(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        const c = source[i];
        out += c;
        i++;
        if (c === '\\' && i < n) {
          out += source[i];
          i++;
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/** 将 @/ 别名或相对导入路径解析为工作区内的绝对文件路径，外部依赖返回 null。 */
function resolveLocalModule(specifier, fromFile) {
  let base;
  if (specifier.startsWith('@/')) {
    base = path.join(srcRoot, specifier.slice(2));
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }

  if (fs.existsSync(base) && fs.statSync(base).isFile()) {
    return base;
  }
  for (const ext of RESOLVE_EXTS) {
    const withExt = `${base}${ext}`;
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
      return withExt;
    }
  }
  for (const ext of RESOLVE_EXTS) {
    const idx = path.join(base, `index${ext}`);
    if (fs.existsSync(idx) && fs.statSync(idx).isFile()) {
      return idx;
    }
  }
  return null;
}

/** 计算给定字符偏移对应的 1-based 行号。 */
function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

/** 解析大括号内的命名导入/导出列表（支持 `type` 前缀与 `a as b` 别名）。 */
function parseNamedList(inner, pickOriginal) {
  /** @type {string[]} */
  const names = [];
  for (const raw of inner.split(',')) {
    const item = raw.trim().replace(/^type\s+/, '');
    if (!item) continue;
    const parts = item.split(/\s+as\s+/);
    const chosen = pickOriginal ? parts[0]?.trim() : (parts[1] ?? parts[0])?.trim();
    if (chosen && /^[A-Za-z_$][\w$]*$/.test(chosen)) {
      names.push(chosen);
    }
  }
  return names;
}

const files = listSourceFiles(srcRoot);
/** @type {Map<string, Set<string>>} */
const referencedExports = new Map();
/** @type {Set<string>} */
const wildcardReferencedFiles = new Set();
/** @type {Map<string, Array<{ name: string; line: number }>>} */
const declaredExports = new Map();

function markUsed(targetFile, name) {
  let set = referencedExports.get(targetFile);
  if (!set) {
    set = new Set();
    referencedExports.set(targetFile, set);
  }
  set.add(name);
}

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const clean = stripCommentsPreserveLines(raw);

  // 1. 收集所有静态 import 语句
  const importRe = /^\s*import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  for (const m of clean.matchAll(importRe)) {
    const clause = m[1].trim();
    const target = resolveLocalModule(m[2], file);
    if (!target || target === file) continue;

    if (/^\*\s+as\s+/.test(clause)) {
      wildcardReferencedFiles.add(target);
      continue;
    }

    const braceMatch = clause.match(/\{([\s\S]*?)\}/);
    if (braceMatch) {
      for (const name of parseNamedList(braceMatch[1], true)) {
        markUsed(target, name);
      }
    }

    const beforeBrace = clause.split('{')[0].replace(/,\s*$/, '').trim();
    if (beforeBrace && !beforeBrace.startsWith('*')) {
      markUsed(target, 'default');
    }
  }

  // 2. 收集 re-export（export { ... } from '...' / export * from '...'）
  const reExportNamedRe = /^\s*export\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/gm;
  for (const m of clean.matchAll(reExportNamedRe)) {
    const target = resolveLocalModule(m[2], file);
    if (!target || target === file) continue;
    for (const name of parseNamedList(m[1], true)) {
      markUsed(target, name);
    }
  }

  const reExportStarRe = /^\s*export\s+(?:type\s+)?\*(?:\s+as\s+[A-Za-z_$][\w$]*)?\s+from\s+['"]([^'"]+)['"]/gm;
  for (const m of clean.matchAll(reExportStarRe)) {
    const target = resolveLocalModule(m[1], file);
    if (!target || target === file) continue;
    wildcardReferencedFiles.add(target);
  }

  // 3. 收集动态 import('...')
  const dynImportRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of clean.matchAll(dynImportRe)) {
    const target = resolveLocalModule(m[1], file);
    if (target && target !== file) {
      wildcardReferencedFiles.add(target);
    }
  }

  if (isExemptFromCheck(file)) continue;

  // 4. 收集本文件声明的顶层导出符号
  /** @type {Array<{ name: string; line: number }>} */
  const exportsList = [];

  const declRe =
    /^export\s+(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of clean.matchAll(declRe)) {
    exportsList.push({ name: m[1], line: lineAt(clean, m.index ?? 0) });
  }

  const defaultRe = /^export\s+default\b/gm;
  for (const m of clean.matchAll(defaultRe)) {
    exportsList.push({ name: 'default', line: lineAt(clean, m.index ?? 0) });
  }

  const localNamedExportRe = /^export\s+(?:type\s+)?\{([\s\S]*?)\}(?:\s+from\s+['"]([^'"]+)['"])?/gm;
  for (const m of clean.matchAll(localNamedExportRe)) {
    const line = lineAt(clean, m.index ?? 0);
    for (const name of parseNamedList(m[1], false)) {
      exportsList.push({ name, line });
    }
  }

  declaredExports.set(file, exportsList);
}

/** @type {Array<{ file: string; line: number; name: string }>} */
const unused = [];
for (const [file, exportsList] of declaredExports.entries()) {
  if (wildcardReferencedFiles.has(file)) continue;
  const used = referencedExports.get(file) ?? new Set();
  for (const exp of exportsList) {
    if (!used.has(exp.name)) {
      unused.push({
        file: path.relative(repoRoot, file),
        line: exp.line,
        name: exp.name,
      });
    }
  }
}

if (unused.length > 0) {
  console.error('Found unused exports in src/ (remove export keyword or unused symbol):');
  for (const item of unused) {
    console.error(`  ${item.file}:${item.line} - ${item.name}`);
  }
  process.exit(1);
}
