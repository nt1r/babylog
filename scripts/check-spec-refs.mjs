#!/usr/bin/env node
/**
 * 零外部依赖的 OpenSpec 场景引用与集成测试中文场景注释模板校验：
 * 1. 校验 backend/internal/integration/*_test.go 中每条 `Spec: <capability> / <Requirement> [/ <Scenario1>; <Scenario2>]`
 *    注释均能在 openspec/specs/<capability>/spec.md 中精确找到对应的 Requirement 与 Scenario；
 * 2. 校验业务与安全集成测试的顶层 `func Test*` 均具备完整中文场景注释块（`Spec:` 或 `范围：基础设施`、`场景：`、`前置：`、`目标：`）；
 * 3. 单函数（无 `t.Run`）严格校验顶部 `目标：` 从 1 连续递增并与函数体内 `// N.` 分段注释一一对应；
 *    聚合函数（含 `t.Run`）校验子测试内不再重启 `// N.` 数字前缀以免与顶层目标编号冲突。
 * 支持 `--self-test` 运行纯内存解析器边界自检（零磁盘 IO、防回归）。
 */
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const specsRoot = path.resolve(repoRoot, 'openspec', 'specs');
const integrationRoot = path.resolve(repoRoot, 'backend', 'internal', 'integration');
const SUPPORT_TEST_FILES = new Set(['harness_test.go', 'scenario_test.go']);

/** @returns {Map<string, Map<string, Set<string>>>} capability -> requirement -> scenarios */
function loadSpecs() {
  /** @type {Map<string, Map<string, Set<string>>>} */
  const catalog = new Map();
  if (!fs.existsSync(specsRoot)) return catalog;

  for (const entry of fs.readdirSync(specsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const specFile = path.join(specsRoot, entry.name, 'spec.md');
    if (!fs.existsSync(specFile)) continue;

    /** @type {Map<string, Set<string>>} */
    const reqMap = new Map();
    let currentReq = null;
    for (const rawLine of fs.readFileSync(specFile, 'utf8').split(/\r?\n/)) {
      const reqMatch = rawLine.match(/^###\s+Requirement:\s+(.+?)\s*$/);
      if (reqMatch) {
        currentReq = reqMatch[1];
        if (!reqMap.has(currentReq)) reqMap.set(currentReq, new Set());
        continue;
      }
      const scenMatch = rawLine.match(/^####\s+Scenario:\s+(.+?)\s*$/);
      if (scenMatch && currentReq) {
        reqMap.get(currentReq)?.add(scenMatch[1]);
      }
    }
    catalog.set(entry.name, reqMap);
  }
  return catalog;
}

/** 向上提取紧贴在 func Test* 上方的中文块注释（返回行数组；无则返回 null）。 */
function extractLeadingBlockComment(lines, funcIdx) {
  let end = funcIdx - 1;
  while (end >= 0 && lines[end].trim() === '') end--;
  if (end < 0 || !lines[end].trim().endsWith('*/')) return null;

  let start = end;
  while (start >= 0 && !lines[start].trim().startsWith('/*')) start--;
  if (start < 0) return null;
  return lines.slice(start, end + 1);
}

/**
 * 定位 Go 顶层函数体结束行（依赖 gofmt 规范下顶层函数以列 0 的 `}` 闭合，
 * 同时跳过多行块注释与原始字符串，避免把下一个测试函数的块注释吞进当前函数体）。
 */
function findTopLevelFuncEnd(lines, funcIdx) {
  let inBlock = false;
  let inRawStr = false;
  for (let i = funcIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!inBlock && !inRawStr && raw.startsWith('}')) {
      return i;
    }
    let inDouble = false;
    for (let c = 0; c < raw.length; c++) {
      const ch = raw[c];
      const next = raw[c + 1];
      if (inBlock) {
        if (ch === '*' && next === '/') {
          inBlock = false;
          c++;
        }
        continue;
      }
      if (inRawStr) {
        if (ch === '`') inRawStr = false;
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
      if (ch === '/' && next === '/') break;
      if (ch === '/' && next === '*') {
        inBlock = true;
        c++;
        continue;
      }
      if (ch === '`') inRawStr = true;
      else if (ch === '"') inDouble = true;
    }
  }
  return lines.length;
}

/** 解析场景块注释「目标：」下的数字编号序列（支持首条与「目标：」同行或换行写法）。 */
function parseGoalNumbers(blockLines) {
  /** @type {number[]} */
  const nums = [];
  let inGoals = false;
  for (const raw of blockLines) {
    const goalHeader = raw.match(/^\s*\*?\s*目标：\s*(.*)$/);
    if (goalHeader) {
      inGoals = true;
      const inlineNum = goalHeader[1].match(/^(\d+)\.\s+/);
      if (inlineNum) nums.push(Number(inlineNum[1]));
      continue;
    }
    if (!inGoals) continue;
    const numMatch = raw.match(/^\s*\*?\s*(\d+)\.\s+/);
    if (numMatch) nums.push(Number(numMatch[1]));
  }
  return nums;
}

/** 扫描函数体内的有效代码与整行分段注释，返回是否含真实 `t.Run(` 调用及 `// N.` 编号序列。 */
function inspectFuncBody(bodyLines) {
  let hasSubtests = false;
  /** @type {number[]} */
  const bodyStepNums = [];
  let inBlock = false;

  for (const raw of bodyLines) {
    const trimmed = raw.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true;
      continue;
    }
    if (trimmed.startsWith('//')) {
      const stepMatch = trimmed.match(/^\/\/\s*(\d+)\.\s+/);
      if (stepMatch) bodyStepNums.push(Number(stepMatch[1]));
      continue;
    }
    // 剔除行尾注释后再检测真实 t.Run( 调用，防止注释内提及 t.Run( 触发误判
    const codePart = raw.replace(/\/\/.*$/, '');
    if (/\bt\.Run\s*\(/.test(codePart)) {
      hasSubtests = true;
    }
  }
  return { hasSubtests, bodyStepNums };
}

/** 校验单个集成测试文件内全部顶层 Test* 函数的中文场景注释模板与编号一致性，返回已检验测试函数数。 */
function checkIntegrationTemplates(relPath, lines, errors) {
  let checkedTests = 0;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const m = lines[lineIdx].match(/^func\s+(Test\w+)\s*\(/);
    if (!m || m[1] === 'TestMain') continue;

    checkedTests++;
    const name = m[1];
    const lineNo = lineIdx + 1;
    const blockLines = extractLeadingBlockComment(lines, lineIdx);
    if (!blockLines) {
      errors.push(`${relPath}:${lineNo} (${name}) - 缺少中文场景块注释（须含 Spec:/范围、场景、前置、目标）`);
      continue;
    }

    const blockText = blockLines.join('\n');
    // 要求 Spec: 必须带同行非空内容（使用 [ \t] 防止 \s 跨换行吞掉下一行的 `*`）
    const hasSpecOrInfra = /^[ \t]*\*?[ \t]*(?:Spec:[ \t]+\S|范围：[ \t]*基础设施)/m.test(blockText);
    const hasScene = /^[ \t]*\*?[ \t]*场景：[ \t]*\S/m.test(blockText);
    const hasPre = /^[ \t]*\*?[ \t]*前置：[ \t]*\S/m.test(blockText);
    const hasGoal = /^[ \t]*\*?[ \t]*目标：/m.test(blockText);

    if (!hasSpecOrInfra || !hasScene || !hasPre || !hasGoal) {
      errors.push(
        `${relPath}:${lineNo} (${name}) - 中文场景块注释不完整（须同时包含非空 Spec:/范围：基础设施、场景：、前置：、目标：）`,
      );
      continue;
    }

    const goalNums = parseGoalNumbers(blockLines);
    const expectedSequential = goalNums.map((_, idx) => idx + 1).join(',');
    if (goalNums.length === 0 || goalNums.join(',') !== expectedSequential) {
      errors.push(
        `${relPath}:${lineNo} (${name}) - 场景块注释「目标：」编号须从 1 连续递增（当前为 [${goalNums.join(',')}]）`,
      );
      continue;
    }

    const bodyEnd = findTopLevelFuncEnd(lines, lineIdx);
    const { hasSubtests, bodyStepNums } = inspectFuncBody(lines.slice(lineIdx + 1, bodyEnd));

    if (hasSubtests) {
      if (bodyStepNums.length > 0) {
        errors.push(
          `${relPath}:${lineNo} (${name}) - 含 t.Run 子测试的聚合用例内部请使用无编号中文步骤注释，避免与顶层「目标：」编号冲突（发现 // ${bodyStepNums.join(', ')}.）`,
        );
      }
    } else if (goalNums.join(',') !== bodyStepNums.join(',')) {
      errors.push(
        `${relPath}:${lineNo} (${name}) - 顶部目标编号 [${goalNums.join(',')}] 与方法体内分段注释编号 [${bodyStepNums.join(',')}] 不一致`,
      );
    }
  }
  return checkedTests;
}

/** 校验单个文件内容中的全部 Spec: 引用及（如非底座文件）中文场景注释模板。 */
function inspectIntegrationFile(relPath, content, specs, checkTemplates, errors) {
  const lines = content.split(/\r?\n/);
  let refs = 0;

  // 1. 校验每条 Spec: 注释均格式合法且精确匹配现存 OpenSpec Requirement 与 Scenario（拦截空值与漏空格）
  for (let idx = 0; idx < lines.length; idx++) {
    const match = lines[idx].match(/^\s*\*?\s*Spec:(.*)$/);
    if (!match) continue;

    const lineNo = idx + 1;
    const rawValue = match[1];
    if (!rawValue.startsWith(' ') || rawValue.trim() === '') {
      errors.push(
        `${relPath}:${lineNo} - Spec 注释须为 "Spec: <capability> / <Requirement>[ / <Scenario>; ...]"（冒号后保留空格且不能为空）`,
      );
      continue;
    }

    const parts = rawValue
      .trim()
      .split(' / ')
      .map((s) => s.trim());
    if (parts.length < 2 || parts.length > 3) {
      errors.push(
        `${relPath}:${lineNo} - Spec 注释格式应为 "<capability> / <Requirement>" 或 "<capability> / <Requirement> / <Scenario>[; ...]"`,
      );
      continue;
    }

    const [capability, requirement, scenarioList] = parts;
    const reqMap = specs.get(capability);
    if (!reqMap) {
      errors.push(`${relPath}:${lineNo} - 未找到 OpenSpec capability "${capability}"`);
      continue;
    }
    const scenarios = reqMap.get(requirement);
    if (!scenarios) {
      errors.push(`${relPath}:${lineNo} - capability "${capability}" 中未找到 Requirement "${requirement}"`);
      continue;
    }

    // 允许仅追溯到 Requirement 级（省略 Scenario 列表）
    if (!scenarioList) {
      refs++;
      continue;
    }

    for (const scenario of scenarioList
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)) {
      refs++;
      if (!scenarios.has(scenario)) {
        errors.push(`${relPath}:${lineNo} - "${capability} / ${requirement}" 中未找到 Scenario "${scenario}"`);
      }
    }
  }

  // 2. 校验业务与安全集成测试中文场景注释块模板及编号一致性
  const tests = checkTemplates ? checkIntegrationTemplates(relPath, lines, errors) : 0;
  return { refs, tests };
}

/** 纯内存解析器边界自检（零磁盘 IO），防止后续调整引入漏报或误报回归。 */
function runSelfTest() {
  const mockSpecs = new Map([['demo', new Map([['Login', new Set(['Ok'])]])]]);

  /** @type {string[]} */
  const passErrors = [];
  inspectIntegrationFile(
    'demo_ok_test.go',
    [
      'package integration_test',
      '/*',
      ' * Spec: demo / Login / Ok',
      ' * 场景：单函数注释提到 t.Run( 不误判。',
      ' * 前置：无。',
      ' * 目标：',
      ' * 1. 验证正常流程。',
      ' */',
      'func TestSingle(t *testing.T) {',
      '\t// 注意：此处不需要 t.Run(',
      '\t// 1. 断言。',
      '}',
    ].join('\n'),
    mockSpecs,
    true,
    passErrors,
  );
  if (passErrors.length > 0) {
    console.error('check-spec-refs --self-test 正向边界用例出现误报：', passErrors);
    process.exit(1);
  }

  /** @type {string[]} */
  const failErrors = [];
  inspectIntegrationFile(
    'demo_bad_test.go',
    [
      'package integration_test',
      '/*',
      ' * Spec:',
      ' * 场景：空 Spec 与跳号目标。',
      ' * 前置：无。',
      ' * 目标：',
      ' * 1. 第一项。',
      ' * 3. 第三项。',
      ' */',
      'func TestBad(t *testing.T) {',
      '\t// 1. 断言。',
      '}',
    ].join('\n'),
    mockSpecs,
    true,
    failErrors,
  );
  const joined = failErrors.join('\n');
  if (!joined.includes('不能为空') || !joined.includes('不完整')) {
    console.error('check-spec-refs --self-test 负向边界用例漏检：', failErrors);
    process.exit(1);
  }

  /** @type {string[]} */
  const skipNumErrors = [];
  inspectIntegrationFile(
    'demo_skip_test.go',
    [
      'package integration_test',
      '/*',
      ' * Spec: demo / Login / Ok',
      ' * 场景：跳号目标。',
      ' * 前置：无。',
      ' * 目标：',
      ' * 1. 第一项。',
      ' * 3. 第三项。',
      ' */',
      'func TestSkip(t *testing.T) {',
      '\t// 1. 断言。',
      '}',
    ].join('\n'),
    mockSpecs,
    true,
    skipNumErrors,
  );
  if (!skipNumErrors.join('\n').includes('连续递增')) {
    console.error('check-spec-refs --self-test 跳号目标漏检：', skipNumErrors);
    process.exit(1);
  }
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const specs = loadSpecs();
/** @type {string[]} */
const errors = [];
let checkedRefs = 0;
let checkedTests = 0;

if (fs.existsSync(integrationRoot)) {
  for (const entry of fs.readdirSync(integrationRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('_test.go')) continue;
    const fullPath = path.join(integrationRoot, entry.name);
    const relPath = path.relative(repoRoot, fullPath);
    const res = inspectIntegrationFile(
      relPath,
      fs.readFileSync(fullPath, 'utf8'),
      specs,
      !SUPPORT_TEST_FILES.has(entry.name),
      errors,
    );
    checkedRefs += res.refs;
    checkedTests += res.tests;
  }
}

if (errors.length > 0) {
  console.error('集成测试 OpenSpec 引用或中文场景注释模板校验未通过：');
  for (const err of errors) {
    console.error(`  ${err}`);
  }
  process.exit(1);
}

if (checkedRefs === 0 || checkedTests === 0) {
  console.error(
    `backend/internal/integration/*_test.go 校验异常：Spec 引用=${checkedRefs}、集成测试=${checkedTests}，请检查目录路径`,
  );
  process.exit(1);
}

console.log(`check-spec-refs: ok (${checkedRefs} Spec refs / ${checkedTests} integration tests)`);
