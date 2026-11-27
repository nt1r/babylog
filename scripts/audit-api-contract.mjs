#!/usr/bin/env node
/**
 * 零外部依赖的前后端 API 契约只读审计工具：
 * 1. 解析 backend/internal/httpapi/ 注册的全部 HTTP 接口（方法 + 归一化路径），核对 src/lib/ 是否均存在实际调用；
 * 2. 扫描后端领域模型响应结构体的 json 标签字段，核对 src/ 运行时代码（排除纯类型声明与注释）是否存在消费引用，
 *    并对 OpenSpec 显式约定的保留字段单独分组展示，避免误删契约字段。
 *
 * 用法：
 *   node scripts/audit-api-contract.mjs            # 输出完整审计报告（只读，退出码 0）
 *   node scripts/audit-api-contract.mjs --strict   # 存在未引用接口或未豁免未消费响应字段时退出码 1
 *   node scripts/audit-api-contract.mjs --self-test # 运行纯内存解析器自检
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const RECORD_CATEGORIES = ['feeding', 'sleep', 'care', 'health'];

/**
 * OpenSpec 主规格明确要求返回、前端当前仅保留类型声明的响应字段白名单。
 * 键格式为 `<package>.<Struct>.<json_field>`，值为对应规格出处。
 */
const OPENSPEC_RESERVED_FIELDS = new Map([
  ['baby.Profile.created_at', 'openspec/specs/baby-profile/spec.md（宝宝档案响应契约字段）'],
  ['dashboard.PeriodActiveDays.care_days', 'openspec/specs/dashboard-insights/spec.md（周期活跃天数四类分项）'],
]);

/** 仅用于反序列化请求体或内部配置的 Go 结构体后缀，不作为响应字段消费检查目标。 */
const REQUEST_ONLY_STRUCT_RE = /(?:Input|Request|Filter|Options|Config)$/;

/** 递归枚举目录下满足条件的文件并按路径升序返回。 */
function walkFiles(dir, predicate) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, predicate));
    } else if (entry.isFile() && predicate(full)) {
      out.push(full);
    }
  }
  return out.sort();
}

/** 归一化路径参数与尾部斜杠，将 `:babyId` / `${id}` 等统一折叠为 `:param` 以便跨栈比对。 */
export function normalizeApiPath(rawPath) {
  const withoutQuery = rawPath.split('?')[0] ?? rawPath;
  const normalized = withoutQuery
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/:[A-Za-z0-9_]+/g, ':param')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return normalized || '/';
}

/** 拼接路由前缀与子路径，保留规范的单斜杠分隔。 */
function joinRoutePath(prefix, subPath) {
  const base = prefix.replace(/\/$/, '');
  if (!subPath) return base || '/';
  const child = subPath.startsWith('/') ? subPath : `/${subPath}`;
  return `${base}${child}`.replace(/\/+/g, '/');
}

/**
 * 从 router.go 与各 handler 源码解析全部已注册的 Gin HTTP 路由（含 Group 嵌套、registerRoutes 与泛型 CRUD 注册）。
 * @param {string} routerSource
 * @param {Record<string, string>} handlerSources 文件名到源码的映射
 * @returns {Array<{ method: string, path: string, normalized: string, source: string }>}
 */
export function parseBackendRoutes(routerSource, handlerSources) {
  /** @type {Map<string, string>} */
  const groupPrefixes = new Map();
  /** @type {Array<{ method: string, path: string, normalized: string, source: string }>} */
  const routes = [];
  /** @type {Array<{ prefix: string, handlerFile: string }>} */
  const delegatedRegistrations = [];

  /** 记录路由条目并生成归一化签名。 */
  function addRoute(method, fullPath, source) {
    routes.push({
      method,
      path: fullPath,
      normalized: `${method} ${normalizeApiPath(fullPath)}`,
      source,
    });
  }

  // 解析 router.go 中的 Group 链与直接注册的路由
  for (const rawLine of routerSource.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;

    const groupMatch = line.match(/^(\w+)\s*:=\s*(\w+)\.Group\("([^"]*)"/);
    if (groupMatch) {
      const [, varName, parentVar, seg] = groupMatch;
      const parentPrefix = parentVar === 'r' ? '' : (groupPrefixes.get(parentVar) ?? '');
      groupPrefixes.set(varName, joinRoutePath(parentPrefix, seg));
      continue;
    }

    const directRoute = line.match(/^(\w+)\.(GET|POST|PUT|PATCH|DELETE)\("([^"]*)"/);
    if (directRoute) {
      const [, groupVar, method, seg] = directRoute;
      const prefix = groupPrefixes.get(groupVar) ?? '';
      addRoute(method, joinRoutePath(prefix, seg), 'router.go');
      continue;
    }

    const delegateVar = line.match(/^(\w+)\.registerRoutes\((\w+)\)/);
    if (delegateVar) {
      const [, handlerVar, groupVar] = delegateVar;
      delegatedRegistrations.push({
        prefix: groupPrefixes.get(groupVar) ?? '',
        handlerFile: handlerVar,
      });
      continue;
    }

    const delegateInline = line.match(/^(\w+)\.registerRoutes\((\w+)\.Group\("([^"]*)"\)\)/);
    if (delegateInline) {
      const [, handlerVar, parentVar, seg] = delegateInline;
      const parentPrefix = groupPrefixes.get(parentVar) ?? '';
      delegatedRegistrations.push({
        prefix: joinRoutePath(parentPrefix, seg),
        handlerFile: handlerVar,
      });
    }
  }

  // 根据 handler 变量名映射其对应的 *_handler.go 文件
  /** @type {Record<string, string>} */
  const varToFile = {};
  for (const match of routerSource.matchAll(/(\w+)\s*:=\s*new([A-Z]\w+)Handler\(/g)) {
    const varName = match[1];
    const stem = match[2].replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    const candidate = `${stem}_handler.go`;
    if (handlerSources[candidate]) {
      varToFile[varName] = candidate;
    }
  }

  for (const reg of delegatedRegistrations) {
    const fileName = varToFile[reg.handlerFile];
    const src = fileName ? handlerSources[fileName] : undefined;
    if (!src) continue;

    // 仅提取 registerRoutes 方法体内的路由注册，避免误匹配其他函数中的注释或辅助代码
    const bodyMatch = src.match(/func\s+\([^)]+\)\s+registerRoutes\([^)]*\)\s*\{([\s\S]*?)^\}/m);
    if (!bodyMatch) continue;
    const body = bodyMatch[1];

    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//')) continue;

      const direct = line.match(/^\w+\.(GET|POST|PUT|PATCH|DELETE)\("([^"]*)"/);
      if (direct) {
        const [, method, seg] = direct;
        addRoute(method, joinRoutePath(reg.prefix, seg), fileName);
        continue;
      }

      const crudMatch = line.match(/^registerRecordRoutes\(\w+,\s*"([^"]+)"/);
      if (crudMatch) {
        const base = joinRoutePath(reg.prefix, crudMatch[1]);
        addRoute('GET', base, fileName);
        addRoute('POST', base, fileName);
        addRoute('PUT', `${base}/:id`, fileName);
        addRoute('DELETE', `${base}/:id`, fileName);
      }
    }
  }

  return routes;
}

/**
 * 清除 TS/JS 注释但保留换行，跳过字符串与模板字面量，防止注释里的示例路径造成误命中。
 * @param {string} source
 * @returns {string}
 */
export function stripTsComments(source) {
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

/**
 * 在源码中查找指定函数调用（自动跳过可选的嵌套 TS 泛型参数 `<...>`），
 * 返回每次调用括号内的参数文本，避免正则无法匹配 `babyApiRequest<A<B<C>>>(...)` 等嵌套泛型。
 * @param {string} source
 * @param {string} fnName
 * @returns {string[]}
 */
function extractCallArgTexts(source, fnName) {
  /** @type {string[]} */
  const results = [];
  const fnRe = new RegExp(`\\b${fnName}\\b`, 'g');
  let match = fnRe.exec(source);

  while (match !== null) {
    let i = match.index + fnName.length;
    while (i < source.length && /\s/.test(source[i])) i++;

    // 跳过可选的嵌套泛型参数列表 <...>
    if (source[i] === '<') {
      let depth = 0;
      while (i < source.length) {
        if (source[i] === '<') depth++;
        else if (source[i] === '>') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      while (i < source.length && /\s/.test(source[i])) i++;
    }

    if (source[i] === '(') {
      const start = i + 1;
      let parenDepth = 0;
      let quote = null;
      while (i < source.length) {
        const ch = source[i];
        if (quote) {
          if (ch === '\\') {
            i += 2;
            continue;
          }
          if (ch === quote) quote = null;
        } else if (ch === "'" || ch === '"' || ch === '`') {
          quote = ch;
        } else if (ch === '(') {
          parenDepth++;
        } else if (ch === ')') {
          parenDepth--;
          if (parenDepth === 0) {
            results.push(source.slice(start, i));
            break;
          }
        }
        i++;
      }
    }

    match = fnRe.exec(source);
  }

  return results;
}

/**
 * 从前端 src/lib/*.ts 源码提取所有归一化 API 调用签名（`METHOD /api/...`）。
 * 支持 apiRequest、babyApiRequest、buildBabyApiPath，以及 records.ts 中的四类动态分类展开与三元保存方法。
 * @param {Record<string, string>} libSources 文件名到源码的映射
 * @returns {Set<string>}
 */
export function parseFrontendApiCalls(libSources) {
  /** @type {Set<string>} */
  const calls = new Set();

  /** 根据路径模板是否含动态 `${...category}` 展开为具体路径列表。 */
  function expandCategoryPaths(rawPath) {
    if (/\$\{[^}]*category\}/.test(rawPath)) {
      return RECORD_CATEGORIES.map((cat) => rawPath.replace(/\$\{[^}]*category\}/g, cat));
    }
    return [rawPath];
  }

  for (const rawSrc of Object.values(libSources)) {
    const src = stripTsComments(rawSrc);

    // 1. 直接调用 apiRequest('/api/...') 或 apiRequest<T>(`/api/...`, { method: '...' })
    for (const argsText of extractCallArgTexts(src, 'apiRequest')) {
      const pathMatch = argsText.match(/^\s*(['"`])(\/api\/[^'"`]+)\1/);
      if (!pathMatch) continue;
      const methodMatch = argsText.match(/\bmethod\s*:\s*['"]([A-Z]+)['"]/);
      const method = methodMatch ? methodMatch[1] : 'GET';
      for (const expanded of expandCategoryPaths(pathMatch[2])) {
        calls.add(`${method} ${normalizeApiPath(expanded)}`);
      }
    }

    // 2. 宝宝作用域调用 babyApiRequest<T>(babyId, '/...', { method: '...' })
    for (const argsText of extractCallArgTexts(src, 'babyApiRequest')) {
      const pathMatch = argsText.match(/^\s*[^,]+,\s*(['"`])(\/[^'"`]+)\1/);
      if (!pathMatch) continue;
      const methodMatch = argsText.match(/\bmethod\s*:\s*['"]([A-Z]+)['"]/);
      const method = methodMatch ? methodMatch[1] : 'GET';
      for (const expanded of expandCategoryPaths(pathMatch[2])) {
        calls.add(`${method} ${normalizeApiPath(`/api/babies/:param${expanded}`)}`);
      }
    }

    // 3. 宝宝作用域二进制下载或路径构造 buildBabyApiPath(babyId, '/...')（默认 GET）
    for (const argsText of extractCallArgTexts(src, 'buildBabyApiPath')) {
      const pathMatch = argsText.match(/^\s*[^,]+,\s*(['"`])(\/[^'"`]+)\1/);
      if (!pathMatch) continue;
      for (const expanded of expandCategoryPaths(pathMatch[2])) {
        calls.add(`GET ${normalizeApiPath(`/api/babies/:param${expanded}`)}`);
      }
    }

    // 4. saveRecord 类型的动态三元路径与方法（如 req.id !== undefined ? 'PUT' : 'POST'）
    if (src.includes('saveRecord') && /req\.id\s*!==\s*undefined\s*\?\s*'PUT'\s*:\s*'POST'/.test(src)) {
      for (const cat of RECORD_CATEGORIES) {
        calls.add(`POST /api/babies/:param/records/${cat}`);
        calls.add(`PUT /api/babies/:param/records/${cat}/:param`);
      }
    }
  }

  return calls;
}

/**
 * 解析 Go 源码中全部导出结构体字段的 json 标签（排除 `json:"-"` 及纯请求入参结构体）。
 * @param {string} pkgName
 * @param {string} goSource
 * @returns {Array<{ key: string, pkg: string, structName: string, jsonField: string }>}
 */
export function parseGoResponseJsonFields(pkgName, goSource) {
  /** @type {Array<{ key: string, pkg: string, structName: string, jsonField: string }>} */
  const fields = [];
  const lines = goSource.split('\n');
  let currentStruct = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!currentStruct) {
      const start = line.match(/^type\s+([A-Z]\w*)(?:\[[^\]]+\])?\s+struct\s*\{/);
      if (start) {
        currentStruct = start[1];
      }
      continue;
    }

    if (line === '}') {
      currentStruct = null;
      continue;
    }

    if (REQUEST_ONLY_STRUCT_RE.test(currentStruct)) continue;
    if (!line || line.startsWith('//')) continue;

    const tagMatch = line.match(/`[^`]*json:"([^"]+)"[^`]*`/);
    if (!tagMatch) continue;
    const jsonName = tagMatch[1].split(',')[0];
    if (!jsonName || jsonName === '-') continue;

    fields.push({
      key: `${pkgName}.${currentStruct}.${jsonName}`,
      pkg: pkgName,
      structName: currentStruct,
      jsonField: jsonName,
    });
  }

  return fields;
}

/**
 * 粗粒度剔除前端 TS/TSX 文件中的 interface / type 顶层声明块，保留运行时可执行代码文本，
 * 用于判断 JSON 字段是否仅存在于类型声明而从未在运行期被读取或组装。
 * @param {string} source
 * @returns {string}
 */
export function stripTopLevelTypeBlocks(source) {
  const clean = stripTsComments(source);
  const lines = clean.split('\n');
  /** @type {string[]} */
  const kept = [];
  let braceDepth = 0;
  let skippingBlock = false;

  for (const line of lines) {
    if (!skippingBlock) {
      if (/^\s*(?:export\s+)?interface\s+\w+/.test(line)) {
        const opens = (line.match(/\{/g) ?? []).length;
        const closes = (line.match(/\}/g) ?? []).length;
        braceDepth = opens - closes;
        if (braceDepth > 0) skippingBlock = true;
        continue;
      }
      if (/^\s*(?:export\s+)?type\s+\w+\s*=/.test(line)) {
        const opens = (line.match(/\{/g) ?? []).length;
        const closes = (line.match(/\}/g) ?? []).length;
        braceDepth = opens - closes;
        if (braceDepth > 0) skippingBlock = true;
        continue;
      }
      kept.push(line);
      continue;
    }

    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    braceDepth += opens - closes;
    if (braceDepth <= 0) {
      skippingBlock = false;
      braceDepth = 0;
    }
  }

  return kept.join('\n');
}

/**
 * 执行全仓只读契约审计并返回结构化结果。
 */
function runAudit() {
  const httpapiDir = path.join(repoRoot, 'backend', 'internal', 'httpapi');
  const routerSource = fs.readFileSync(path.join(httpapiDir, 'router.go'), 'utf8');
  /** @type {Record<string, string>} */
  const handlerSources = {};
  for (const file of walkFiles(httpapiDir, (p) => p.endsWith('_handler.go'))) {
    handlerSources[path.basename(file)] = fs.readFileSync(file, 'utf8');
  }
  const backendRoutes = parseBackendRoutes(routerSource, handlerSources);

  const libDir = path.join(repoRoot, 'src', 'lib');
  /** @type {Record<string, string>} */
  const libSources = {};
  for (const file of walkFiles(libDir, (p) => /\.(ts|tsx)$/.test(p))) {
    libSources[path.basename(file)] = fs.readFileSync(file, 'utf8');
  }
  const frontendCalls = parseFrontendApiCalls(libSources);

  const unusedEndpoints = backendRoutes.filter((route) => !frontendCalls.has(route.normalized));

  // 扫描 Go 领域响应结构体字段
  const domainPkgs = ['auth', 'baby', 'records', 'dashboard', 'vaccines'];
  /** @type {Array<{ key: string, pkg: string, structName: string, jsonField: string }>} */
  const goFields = [];
  for (const pkg of domainPkgs) {
    const pkgDir = path.join(repoRoot, 'backend', 'internal', pkg);
    for (const file of walkFiles(pkgDir, (p) => p.endsWith('.go') && !p.endsWith('_test.go'))) {
      goFields.push(...parseGoResponseJsonFields(pkg, fs.readFileSync(file, 'utf8')));
    }
  }

  // 合并全部前端运行时源码文本用于字段消费检索
  const srcDir = path.join(repoRoot, 'src');
  const runtimeCorpus = walkFiles(srcDir, (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith('routeTree.gen.ts'))
    .map((file) => stripTopLevelTypeBlocks(fs.readFileSync(file, 'utf8')))
    .join('\n');

  /** @type {Array<{ key: string, reason: string }>} */
  const reservedFields = [];
  /** @type {Array<{ key: string, jsonField: string }>} */
  const unreferencedFields = [];
  /** @type {Set<string>} */
  const seenKeys = new Set();

  for (const field of goFields) {
    if (seenKeys.has(field.key)) continue;
    seenKeys.add(field.key);

    const tokenRe = new RegExp(`\\b${field.jsonField}\\b`);
    if (tokenRe.test(runtimeCorpus)) continue;

    const reservedReason = OPENSPEC_RESERVED_FIELDS.get(field.key);
    if (reservedReason) {
      reservedFields.push({ key: field.key, reason: reservedReason });
    } else {
      unreferencedFields.push({ key: field.key, jsonField: field.jsonField });
    }
  }

  return {
    backendRoutes,
    frontendCalls,
    unusedEndpoints,
    goFieldCount: seenKeys.size,
    reservedFields,
    unreferencedFields,
  };
}

/** 纯内存解析器自检（零磁盘 IO），防止路由/字段解析逻辑退化。 */
function runSelfTest() {
  assert.equal(
    normalizeApiPath(`/api/babies/\${babyId}/vaccines/:id?tz=Asia/Shanghai`),
    '/api/babies/:param/vaccines/:param',
  );

  const sampleRouter = `
    api := r.Group("/api")
    authGroup := api.Group("/auth")
    authGroup.POST("/login", authH.login)
    ready := api.Group("")
    babyGroup := ready.Group("/babies/:babyId")
    recH := newRecordsHandler(store, logger)
    recH.registerRoutes(babyGroup.Group("/records"))
  `;
  const sampleRecordsHandler = `
func (h *recordsHandler) registerRoutes(group *gin.RouterGroup) {
	group.GET("/defaults", h.getDefaults)
	registerRecordRoutes(group, "/feeding", h, recordCRUD[a, b, c]{})
}
`;
  const routes = parseBackendRoutes(sampleRouter, { 'records_handler.go': sampleRecordsHandler });
  const normalized = new Set(routes.map((r) => r.normalized));
  assert.ok(normalized.has('POST /api/auth/login'));
  assert.ok(normalized.has('GET /api/babies/:param/records/defaults'));
  assert.ok(normalized.has('PUT /api/babies/:param/records/feeding/:param'));
  assert.ok(normalized.has('DELETE /api/babies/:param/records/feeding/:param'));

  const calls = parseFrontendApiCalls({
    'auth.ts': `apiRequest('/api/auth/login', { method: 'POST' });`,
    'records.ts': `
      babyApiRequest<ListResult<RecordOf<C>, DailySummaryOf<C>>>(babyId, \`/records/\${category}\`, { tz: true });
      babyApiRequest(babyId, '/records/defaults', { signal });
      babyApiRequest(babyId, \`/records/\${category}/\${id}\`, { method: 'DELETE' });
    `,
  });
  assert.ok(calls.has('POST /api/auth/login'));
  assert.ok(calls.has('GET /api/babies/:param/records/feeding'));
  assert.ok(calls.has('GET /api/babies/:param/records/defaults'));
  assert.ok(calls.has('DELETE /api/babies/:param/records/feeding/:param'));

  const goFields = parseGoResponseJsonFields(
    'baby',
    `
type Profile struct {
	ID int64 \`json:"id"\`
	CreatedAt string \`json:"created_at"\`
	Internal string \`json:"-"\`
}
type ProfileInput struct {
	Name string \`json:"name"\`
}
`,
  );
  assert.deepEqual(
    goFields.map((f) => f.key),
    ['baby.Profile.id', 'baby.Profile.created_at'],
  );

  const stripped = stripTopLevelTypeBlocks(`
export interface Demo {
  only_in_type: string;
}
export function useDemo(d: Demo) {
  return d.used_at_runtime;
}
`);
  assert.ok(!stripped.includes('only_in_type'));
  assert.ok(stripped.includes('used_at_runtime'));
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntrypoint) {
  const args = new Set(process.argv.slice(2));
  if (args.has('--self-test')) {
    runSelfTest();
    console.log('audit-api-contract: self-test passed');
    process.exit(0);
  }

  const strict = args.has('--strict');
  const result = runAudit();

  console.log(`=== 前后端 API 契约只读审计 ===`);
  console.log(`后端注册接口总数: ${result.backendRoutes.length}`);
  console.log(`前端识别调用签名: ${result.frontendCalls.size}`);
  console.log(`未被引用的后端接口: ${result.unusedEndpoints.length}`);
  for (const ep of result.unusedEndpoints) {
    console.log(`  [未引用接口] ${ep.method} ${ep.path} (${ep.source})`);
  }

  console.log(`后端响应结构体字段总数: ${result.goFieldCount}`);
  console.log(`OpenSpec 契约保留字段（前端暂仅类型声明）: ${result.reservedFields.length}`);
  for (const item of result.reservedFields) {
    console.log(`  [契约保留] ${item.key} — ${item.reason}`);
  }
  console.log(`未豁免的未消费响应字段: ${result.unreferencedFields.length}`);
  for (const item of result.unreferencedFields) {
    console.log(`  [待核对字段] ${item.key}`);
  }

  if (strict && (result.unusedEndpoints.length > 0 || result.unreferencedFields.length > 0)) {
    process.exit(1);
  }
}
