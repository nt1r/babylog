#!/usr/bin/env node
/**
 * 零外部依赖的 OpenSpec 场景引用、集成测试注释模板与场景索引表一致性校验：
 * 1. 校验集成测试与 CLI 进程测试中每条 `Spec: <capability> / <Requirement> [/ <Scenario1>; <Scenario2>]`
 *    注释均能在 openspec/specs/<capability>/spec.md 中精确找到对应的 Requirement 与 Scenario；
 * 2. 校验全部非前端 Web UI 的后端 OpenSpec Scenario 均至少被一条测试引用（零遗漏）；
 * 3. 校验全部顶层 `func Test*` 具备完整五段中文场景注释块（`Spec:`/`范围：基础设施`、`测试场景：`、`业务背景：`、
 *    `前置数据：` 清单、`测试目标：`），为单场景独立函数（无 `t.Run`）且 `测试目标` 与 `// N.` 中文步骤 1:1 对齐；
 * 4. 校验 docs/testing-guide.md 场景索引表与实际测试函数声明名称及同文件顺序 1:1 双向一致（防索引表漂移）。
 * 支持 `--self-test` 运行纯内存解析器边界自检（零磁盘 IO、防回归）；
 * 支持 `--include-changes` 在开发期归档前将 `openspec/changes/<id>/specs/`（排除 `archive/`）中的活动增量规格纳入本地校验。
 */
import fs from 'node:fs';
import path from 'node:path';
import { classifyLines } from './lib/go-lexer.mjs';

const repoRoot = process.cwd();
const specsRoot = path.resolve(repoRoot, 'openspec', 'specs');
const changesRoot = path.resolve(repoRoot, 'openspec', 'changes');
const integrationRoot = path.resolve(repoRoot, 'backend', 'internal', 'integration');
const cliTestFile = path.resolve(repoRoot, 'backend', 'cmd', 'babylog', 'cli_test.go');
const testingGuideFile = path.resolve(repoRoot, 'docs', 'testing-guide.md');
const SUPPORT_TEST_FILES = new Set(['harness_test.go', 'scenario_test.go']);
const CJK_RE = /[\u4e00-\u9fff]/;

/**
 * 将单个 spec.md 文件中的 Requirement 与 Scenario 合并到指定能力目录中。
 * @param {string} content
 * @param {Map<string, { scenarios: Set<string>, webOnly: boolean }>} reqMap
 */
function mergeSpecContent(content, reqMap) {
  let currentReq = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const reqMatch = rawLine.match(/^###\s+Requirement:\s+(.+?)\s*$/);
    if (reqMatch) {
      currentReq = reqMatch[1];
      if (!reqMap.has(currentReq)) reqMap.set(currentReq, { scenarios: new Set(), webOnly: false });
      continue;
    }
    const scenMatch = rawLine.match(/^####\s+Scenario:\s+(.+?)\s*$/);
    if (scenMatch && currentReq) {
      reqMap.get(currentReq)?.scenarios.add(scenMatch[1]);
      continue;
    }
    // 仅针对前端 Web 界面交互与布局的 Requirement（正文声明 The web application/dashboard SHALL）归维护者手动视觉验收，不纳入后端 Go 自动化必覆盖集。
    if (currentReq && /^The web (?:application|dashboard) SHALL\b/.test(rawLine.trim())) {
      const meta = reqMap.get(currentReq);
      if (meta) meta.webOnly = true;
    }
  }
}

/**
 * 扫描 `<dir>/<capability>/spec.md` 并合并到规格索引表。
 * @param {string} baseDir
 * @param {Map<string, Map<string, { scenarios: Set<string>, webOnly: boolean }>>} catalog
 */
function loadSpecsFromDir(baseDir, catalog) {
  if (!fs.existsSync(baseDir)) return;
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const specFile = path.join(baseDir, entry.name, 'spec.md');
    if (!fs.existsSync(specFile)) continue;
    let reqMap = catalog.get(entry.name);
    if (!reqMap) {
      reqMap = new Map();
      catalog.set(entry.name, reqMap);
    }
    mergeSpecContent(fs.readFileSync(specFile, 'utf8'), reqMap);
  }
}

/**
 * 加载全部 OpenSpec 主规格（传 includeChanges=true 时同时合并活动变更中的增量规格），
 * 区分后端自动化测试必覆盖的 Scenario 与仅人工验收的纯 Web UI Requirement。
 * @param {boolean} includeChanges
 * @returns {Map<string, Map<string, { scenarios: Set<string>, webOnly: boolean }>>}
 */
function loadSpecs(includeChanges = false) {
  /** @type {Map<string, Map<string, { scenarios: Set<string>, webOnly: boolean }>>} */
  const catalog = new Map();
  loadSpecsFromDir(specsRoot, catalog);
  if (includeChanges && fs.existsSync(changesRoot)) {
    for (const changeEntry of fs.readdirSync(changesRoot, { withFileTypes: true })) {
      if (!changeEntry.isDirectory() || changeEntry.name === 'archive') continue;
      loadSpecsFromDir(path.join(changesRoot, changeEntry.name, 'specs'), catalog);
    }
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

/** 基于共用 Go 词法扫描结果定位顶层函数体闭合行（列 0 的 `}` 且处于有效代码态）。 */
function findTopLevelFuncEnd(classified, funcIdx) {
  for (let i = funcIdx + 1; i < classified.length; i++) {
    if (classified[i].kind === 'code' && classified[i].raw.startsWith('}')) {
      return i;
    }
  }
  return classified.length;
}

/** 解析场景块注释中「前置数据：」下的条目数，要求至少列出一条结构化 `- ` 前置数据。 */
function countPreconditionBullets(blockLines) {
  let inPre = false;
  let count = 0;
  for (const raw of blockLines) {
    if (/^\s*\*?\s*前置数据：\s*$/.test(raw)) {
      inPre = true;
      continue;
    }
    if (inPre && /^\s*\*?\s*测试目标：/.test(raw)) {
      break;
    }
    if (inPre && /^\s*\*?\s*-\s+\S/.test(raw)) {
      count++;
    }
  }
  return count;
}

/** 解析场景块注释「测试目标：」下的数字编号序列（支持首条与「测试目标：」同行或换行写法）。 */
function parseGoalNumbers(blockLines) {
  /** @type {number[]} */
  const nums = [];
  let inGoals = false;
  for (const raw of blockLines) {
    const goalHeader = raw.match(/^\s*\*?\s*测试目标：\s*(.*)$/);
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

/** 基于共用 Go 词法扫描结果提取函数体内的真实 `t.Run(` 调用及独立整行 `// N.` 分段注释。 */
function inspectFuncBody(bodyClassified) {
  let hasSubtests = false;
  /** @type {Array<{ num: number, text: string, lineNo: number }>} */
  const bodySteps = [];

  for (const item of bodyClassified) {
    if (item.kind === 'line_comment') {
      const stepMatch = item.raw.trim().match(/^\/\/\s*(\d+)\.\s+(.*)$/);
      if (stepMatch) {
        bodySteps.push({
          num: Number(stepMatch[1]),
          text: stepMatch[2].trim(),
          lineNo: item.lineNo,
        });
      }
      continue;
    }
    if (item.codeOnly && /\bt\.Run\s*\(/.test(item.codeOnly)) {
      hasSubtests = true;
    }
  }
  return { hasSubtests, bodySteps };
}

/** 校验单个测试文件内全部顶层 Test* 函数的中文场景注释模板与编号一致性，返回已发现函数名列表（按声明顺序）。 */
function checkIntegrationTemplates(relPath, lines, classified, errors) {
  /** @type {string[]} */
  const testNames = [];
  for (let lineIdx = 0; lineIdx < classified.length; lineIdx++) {
    if (classified[lineIdx].kind !== 'code') continue;
    const m = lines[lineIdx].match(/^func\s+(Test\w+)\s*\(/);
    if (!m || m[1] === 'TestMain') continue;

    const name = m[1];
    testNames.push(name);
    const lineNo = lineIdx + 1;
    const blockLines = extractLeadingBlockComment(lines, lineIdx);
    if (!blockLines) {
      errors.push(
        `${relPath}:${lineNo} (${name}) - 缺少中文场景块注释（须含 Spec:/范围、测试场景、业务背景、前置数据、测试目标）`,
      );
      continue;
    }

    const blockText = blockLines.join('\n');
    const hasSpecOrInfra = /^[ \t]*\*?[ \t]*(?:Spec:[ \t]+\S|范围：[ \t]*基础设施)/m.test(blockText);
    const hasScene = /^[ \t]*\*?[ \t]*测试场景：[ \t]*\S/m.test(blockText);
    const hasBg = /^[ \t]*\*?[ \t]*业务背景：[ \t]*\S/m.test(blockText);
    const hasPre = /^[ \t]*\*?[ \t]*前置数据：/m.test(blockText);
    const hasGoal = /^[ \t]*\*?[ \t]*测试目标：/m.test(blockText);

    if (!hasSpecOrInfra || !hasScene || !hasBg || !hasPre || !hasGoal) {
      errors.push(
        `${relPath}:${lineNo} (${name}) - 中文场景块注释不完整（须同时包含非空 Spec:/范围：基础设施、测试场景：、业务背景：、前置数据：、测试目标：）`,
      );
      continue;
    }

    if (countPreconditionBullets(blockLines) === 0) {
      errors.push(`${relPath}:${lineNo} (${name}) - 场景块注释「前置数据：」下须至少包含一条 "- ..." 结构化清单项`);
      continue;
    }

    const goalNums = parseGoalNumbers(blockLines);
    const expectedSequential = goalNums.map((_, idx) => idx + 1).join(',');
    if (goalNums.length === 0 || goalNums.join(',') !== expectedSequential) {
      errors.push(
        `${relPath}:${lineNo} (${name}) - 场景块注释「测试目标：」编号须从 1 连续递增（当前为 [${goalNums.join(',')}]）`,
      );
      continue;
    }

    const bodyEnd = findTopLevelFuncEnd(classified, lineIdx);
    const { hasSubtests, bodySteps } = inspectFuncBody(classified.slice(lineIdx + 1, bodyEnd));

    if (hasSubtests) {
      errors.push(
        `${relPath}:${lineNo} (${name}) - 集成测试请拆分为单场景独立顶层函数，不使用 t.Run 聚合多主题以免割裂前置数据与目标编号`,
      );
      continue;
    }

    const bodyStepNums = bodySteps.map((s) => s.num);
    if (goalNums.join(',') !== bodyStepNums.join(',')) {
      errors.push(
        `${relPath}:${lineNo} (${name}) - 顶部测试目标编号 [${goalNums.join(',')}] 与方法体内分段注释编号 [${bodyStepNums.join(',')}] 不一致`,
      );
    }

    for (const step of bodySteps) {
      if (!CJK_RE.test(step.text)) {
        errors.push(
          `${relPath}:${step.lineNo} (${name}) - 步骤注释 "// ${step.num}. ${step.text}" 须使用中文说明业务意图`,
        );
      }
    }
  }
  return testNames;
}

/** 校验单个文件内容中的全部 Spec: 引用及（如非底座文件）中文场景注释模板，记录已覆盖的 Scenario。 */
function inspectIntegrationFile(relPath, content, specs, checkTemplates, coveredScenarios, errors) {
  const lines = content.split(/\r?\n/);
  const classified = classifyLines(content, { supportSingleQuoteString: false });
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
    const reqMeta = reqMap.get(requirement);
    if (!reqMeta) {
      errors.push(`${relPath}:${lineNo} - capability "${capability}" 中未找到 Requirement "${requirement}"`);
      continue;
    }

    // 允许仅追溯到 Requirement 级（省略 Scenario 列表），但不自动标记其下全部 Scenario 为已覆盖
    if (!scenarioList) {
      refs++;
      continue;
    }

    for (const scenario of scenarioList
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)) {
      refs++;
      if (!reqMeta.scenarios.has(scenario)) {
        errors.push(`${relPath}:${lineNo} - "${capability} / ${requirement}" 中未找到 Scenario "${scenario}"`);
      } else {
        coveredScenarios.add(`${capability} / ${requirement} / ${scenario}`);
      }
    }
  }

  // 2. 校验业务与安全集成测试中文场景注释块模板及编号一致性
  const testNames = checkTemplates ? checkIntegrationTemplates(relPath, lines, classified, errors) : [];
  return { refs, testNames };
}

/**
 * 解析 docs/testing-guide.md 场景索引表中的（规范化文件名 → 函数与类别列表），校验：
 * 1. 按文件与函数名与实际测试声明保持 1:1 双向一致及同文件顺序一致；
 * 2. 索引表数据行格式合法（避免畸形行被静默忽略）；
 * 3. 单能力 API 集成测试文件内「失败/拒绝」用例始终位于「正常主流程」「边界/变体」之后。
 */
function checkTestingGuideIndex(guideContent, actualByFile, errors) {
  /** @type {Map<string, Array<{ fnName: string, category: string }>>} */
  const indexedByFile = new Map();
  let inIndexSection = false;
  for (const rawLine of guideContent.split(/\r?\n/)) {
    if (/^###\s+4\.3\s+集成测试场景索引表/.test(rawLine)) {
      inIndexSection = true;
      continue;
    }
    if (inIndexSection && /^#{2,3}\s+/.test(rawLine)) {
      break;
    }
    if (!inIndexSection) continue;

    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    // 跳过表头行与 Markdown 分隔线行（兼容左右/居中对齐冒号写法）
    if (/^\|\s*分组\s*\|/.test(line) || /^\|\s*:?-{3,}:?\s*\|/.test(line)) continue;

    const rowMatch = line.match(/^\|\s*[^|]+\|\s*`([^`]+)`\s*\/\s*`(Test\w+)`\s*\|\s*([^|]+?)\s*\|/);
    if (!rowMatch) {
      errors.push(`docs/testing-guide.md 场景索引表存在无法解析的数据行：${line}`);
      continue;
    }
    const fileKey = rowMatch[1];
    const fnName = rowMatch[2];
    const category = rowMatch[3];
    if (!indexedByFile.has(fileKey)) indexedByFile.set(fileKey, []);
    indexedByFile.get(fileKey)?.push({ fnName, category });
  }

  for (const [fileKey, actualFns] of actualByFile.entries()) {
    const entries = indexedByFile.get(fileKey) ?? [];
    const docFns = entries.map((item) => item.fnName);
    if (actualFns.join(',') !== docFns.join(',')) {
      errors.push(
        `docs/testing-guide.md 索引表与 ${fileKey} 实际声明不一致或顺序漂移（代码=[${actualFns.join(', ')}]，文档=[${docFns.join(', ')}]）`,
      );
    }

    // 单能力 API 集成测试文件（不含 CLI 子命令分组文件）内，失败/拒绝场景统一排在正常主流程与边界/变体之后。
    if (!fileKey.startsWith('cmd/')) {
      let seenFailure = false;
      for (const item of entries) {
        if (item.category === '失败/拒绝') {
          seenFailure = true;
        } else if (seenFailure && (item.category === '正常主流程' || item.category === '边界/变体')) {
          errors.push(
            `docs/testing-guide.md 索引表 ${fileKey} 中的 ${item.fnName}（${item.category}）不应排在「失败/拒绝」用例之后`,
          );
        }
      }
    }
  }
  for (const fileKey of indexedByFile.keys()) {
    if (!actualByFile.has(fileKey)) {
      errors.push(`docs/testing-guide.md 索引表引用了不存在的测试文件 "${fileKey}"`);
    }
  }
}

/** 校验全部后端（非 webOnly）OpenSpec Scenario 至少被一条测试的 Spec: 注释覆盖。 */
function checkBackendSpecCoverage(specs, coveredScenarios, errors) {
  for (const [capability, reqMap] of specs.entries()) {
    for (const [requirement, meta] of reqMap.entries()) {
      if (meta.webOnly) continue;
      for (const scenario of meta.scenarios) {
        const key = `${capability} / ${requirement} / ${scenario}`;
        if (!coveredScenarios.has(key)) {
          errors.push(`openspec/specs/${capability}/spec.md - 后端 Scenario "${key}" 缺少集成测试 Spec: 引用`);
        }
      }
    }
  }
}

/** 纯内存解析器边界自检（零磁盘 IO），防止后续调整引入漏报或误报回归。 */
function runSelfTest() {
  const mockSpecs = new Map([
    [
      'demo',
      new Map([
        ['Login', { scenarios: new Set(['Ok']), webOnly: false }],
        ['WebUI', { scenarios: new Set(['Render']), webOnly: true }],
      ]),
    ],
  ]);

  /** @type {string[]} */
  const passErrors = [];
  const passCovered = new Set();
  const okRes = inspectIntegrationFile(
    'demo_ok_test.go',
    [
      'package integration_test',
      '/*',
      ' * Spec: demo / Login / Ok',
      ' * 测试场景：单函数字符串与注释提到 t.Run( 不误判。',
      ' * 业务背景：验证正常登录闭环并确保字符串字面量不触发误报。',
      ' * 前置数据：',
      ' * - 管理员与会话：已初始化管理员，未登录。',
      ' * 测试目标：',
      ' * 1. 验证正常流程。',
      ' */',
      'func TestSingle(t *testing.T) {',
      '\t// 注意：此处不需要 t.Run(',
      '\t_ = `',
      '// 9. raw string fake step',
      't.Run("raw string fake subtest", nil)',
      '`',
      '\t_ = "t.Run(fake)"',
      '\t// 1. 验证登录响应与落库。',
      '}',
    ].join('\n'),
    mockSpecs,
    true,
    passCovered,
    passErrors,
  );
  checkBackendSpecCoverage(mockSpecs, passCovered, passErrors);
  checkTestingGuideIndex(
    '### 4.3 集成测试场景索引表\n| 分组 | 文件与测试函数 | 类别 | 中文场景说明 |\n| --- | --- | --- | --- |\n| 演示 | `demo_ok_test.go` / `TestSingle` | 正常主流程 | 说明 |\n',
    new Map([['demo_ok_test.go', okRes.testNames]]),
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
      ' * 测试场景：缺业务背景与空 Spec。',
      ' * 前置数据：',
      ' * - 无。',
      ' * 测试目标：',
      ' * 1. 第一项。',
      ' */',
      'func TestBad(t *testing.T) {',
      '\t// 1. 断言。',
      '}',
    ].join('\n'),
    mockSpecs,
    true,
    new Set(),
    failErrors,
  );
  const joined = failErrors.join('\n');
  if (!joined.includes('不能为空') || !joined.includes('不完整')) {
    console.error('check-spec-refs --self-test 负向边界用例漏检：', failErrors);
    process.exit(1);
  }

  /** @type {string[]} */
  const extraFailErrors = [];
  inspectIntegrationFile(
    'demo_extra_bad_test.go',
    [
      'package integration_test',
      '/*',
      ' * Spec: demo / Login / Ok',
      ' * 测试场景：前置数据无清单项。',
      ' * 业务背景：验证前置数据必须分条列出。',
      ' * 前置数据：无。',
      ' * 测试目标：',
      ' * 1. 第一项。',
      ' */',
      'func TestNoBullets(t *testing.T) {',
      '\t// 1. 断言。',
      '}',
      '/*',
      ' * Spec: demo / Login / Ok',
      ' * 测试场景：跳号目标。',
      ' * 业务背景：验证目标编号必须连续递增。',
      ' * 前置数据：',
      ' * - 管理员与会话：无。',
      ' * 测试目标：',
      ' * 1. 第一项。',
      ' * 3. 第三项。',
      ' */',
      'func TestSkip(t *testing.T) {',
      '\t// 1. 断言。',
      '}',
      '/*',
      ' * Spec: demo / Login / Ok',
      ' * 测试场景：纯英文步骤注释。',
      ' * 业务背景：验证英文步骤注释被拦截。',
      ' * 前置数据：',
      ' * - 管理员与会话：无。',
      ' * 测试目标：',
      ' * 1. 第一项。',
      ' */',
      'func TestEnglishStep(t *testing.T) {',
      '\t// 1. verify login status.',
      '}',
      '/*',
      ' * Spec: demo / Login / Ok',
      ' * 测试场景：使用 t.Run。',
      ' * 业务背景：验证集成测试拒绝 t.Run 聚合。',
      ' * 前置数据：',
      ' * - 管理员与会话：无。',
      ' * 测试目标：',
      ' * 1. 第一项。',
      ' */',
      'func TestSubtest(t *testing.T) {',
      '\tt.Run("sub", func(t *testing.T) {})',
      '}',
    ].join('\n'),
    mockSpecs,
    true,
    new Set(),
    extraFailErrors,
  );
  checkBackendSpecCoverage(mockSpecs, new Set(), extraFailErrors);
  checkTestingGuideIndex(
    [
      '### 4.3 集成测试场景索引表',
      '| 分组 | 文件与测试函数 | 类别 | 中文场景说明 |',
      '| --- | --- | --- | --- |',
      '| 演示 | `demo_ok_test.go` / `TestWrongOrder` | 正常主流程 | 说明 |',
      '| 演示 | `demo_cat_test.go` / `TestFailFirst` | 失败/拒绝 | 先失败 |',
      '| 演示 | `demo_cat_test.go` / `TestNormalAfterFail` | 正常主流程 | 后正常 |',
      '| 畸形行缺少反引号 |',
    ].join('\n'),
    new Map([
      ['demo_ok_test.go', ['TestSingle']],
      ['demo_cat_test.go', ['TestFailFirst', 'TestNormalAfterFail']],
    ]),
    extraFailErrors,
  );
  const extraJoined = extraFailErrors.join('\n');
  if (
    !extraJoined.includes('结构化清单项') ||
    !extraJoined.includes('连续递增') ||
    !extraJoined.includes('须使用中文说明业务意图') ||
    !extraJoined.includes('不使用 t.Run') ||
    !extraJoined.includes('缺少集成测试 Spec: 引用') ||
    !extraJoined.includes('实际声明不一致或顺序漂移') ||
    !extraJoined.includes('不应排在「失败/拒绝」用例之后') ||
    !extraJoined.includes('存在无法解析的数据行')
  ) {
    console.error('check-spec-refs --self-test 扩展规则漏检：', extraFailErrors);
    process.exit(1);
  }
  const mergedReqMap = new Map();
  mergeSpecContent('### Requirement: Export\nThe system SHALL export.\n#### Scenario: Main\n', mergedReqMap);
  mergeSpecContent(
    '### Requirement: Export\nThe system SHALL export.\n#### Scenario: Delta\n### Requirement: Web\nThe web application SHALL render.\n#### Scenario: View\n',
    mergedReqMap,
  );
  if (
    !mergedReqMap.get('Export')?.scenarios.has('Main') ||
    !mergedReqMap.get('Export')?.scenarios.has('Delta') ||
    !mergedReqMap.get('Web')?.webOnly
  ) {
    console.error('check-spec-refs --self-test 增量规格合并自检失败');
    process.exit(1);
  }
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const includeChanges = process.argv.includes('--include-changes');
const specs = loadSpecs(includeChanges);
/** @type {string[]} */
const errors = [];
const coveredScenarios = new Set();
/** @type {Map<string, string[]>} */
const actualByFile = new Map();
let checkedRefs = 0;
let checkedTests = 0;

if (fs.existsSync(integrationRoot)) {
  for (const entry of fs.readdirSync(integrationRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('_test.go')) continue;
    const fullPath = path.join(integrationRoot, entry.name);
    const relPath = path.relative(repoRoot, fullPath);
    const checkTemplates = !SUPPORT_TEST_FILES.has(entry.name);
    const res = inspectIntegrationFile(
      relPath,
      fs.readFileSync(fullPath, 'utf8'),
      specs,
      checkTemplates,
      coveredScenarios,
      errors,
    );
    checkedRefs += res.refs;
    checkedTests += res.testNames.length;
    if (checkTemplates) {
      actualByFile.set(entry.name, res.testNames);
    }
  }
}

if (fs.existsSync(cliTestFile)) {
  const relPath = path.relative(repoRoot, cliTestFile);
  const res = inspectIntegrationFile(
    relPath,
    fs.readFileSync(cliTestFile, 'utf8'),
    specs,
    true,
    coveredScenarios,
    errors,
  );
  checkedRefs += res.refs;
  checkedTests += res.testNames.length;
  actualByFile.set('cmd/babylog/cli_test.go', res.testNames);
}

checkBackendSpecCoverage(specs, coveredScenarios, errors);
if (fs.existsSync(testingGuideFile)) {
  checkTestingGuideIndex(fs.readFileSync(testingGuideFile, 'utf8'), actualByFile, errors);
}

if (errors.length > 0) {
  console.error('集成测试 OpenSpec 引用、场景索引表或中文场景注释模板校验未通过：');
  for (const err of errors) {
    console.error(`  ${err}`);
  }
  process.exit(1);
}

if (checkedRefs === 0 || checkedTests === 0) {
  console.error(`集成测试校验异常：Spec 引用=${checkedRefs}、集成测试=${checkedTests}，请检查目录路径`);
  process.exit(1);
}

console.log(
  `check-spec-refs: ok (${checkedRefs} Spec refs / ${coveredScenarios.size} unique backend scenarios / ${checkedTests} integration tests)`,
);
