#!/usr/bin/env node
/**
 * 零外部依赖的 OpenSpec 场景引用一致性检查：
 * 校验 backend/internal/integration/*_test.go 中每条 `Spec: <capability> / <Requirement> [/ <Scenario1>; <Scenario2>]`
 * 注释均能在 openspec/specs/<capability>/spec.md 中精确找到对应的 Requirement 与 Scenario，
 * 防止 OpenSpec 改名或删减场景后，集成测试的追溯注释静默失效。
 */
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const specsRoot = path.resolve(repoRoot, 'openspec', 'specs');
const integrationRoot = path.resolve(repoRoot, 'backend', 'internal', 'integration');

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

const specs = loadSpecs();
/** @type {string[]} */
const errors = [];
let checkedRefs = 0;

if (fs.existsSync(integrationRoot)) {
  for (const entry of fs.readdirSync(integrationRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('_test.go')) continue;
    const fullPath = path.join(integrationRoot, entry.name);
    const relPath = path.relative(repoRoot, fullPath);
    const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);

    for (let idx = 0; idx < lines.length; idx++) {
      const match = lines[idx].match(/^\s*\*?\s*Spec:\s+(.+?)\s*$/);
      if (!match) continue;

      const lineNo = idx + 1;
      const parts = match[1].split(' / ').map((s) => s.trim());
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

      if (!scenarioList) {
        checkedRefs++;
        continue;
      }

      for (const scenario of scenarioList
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        checkedRefs++;
        if (!scenarios.has(scenario)) {
          errors.push(`${relPath}:${lineNo} - "${capability} / ${requirement}" 中未找到 Scenario "${scenario}"`);
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error('Found broken OpenSpec Spec: references in backend/internal/integration:');
  for (const err of errors) {
    console.error(`  ${err}`);
  }
  process.exit(1);
}

if (checkedRefs === 0) {
  console.error('Expected at least one Spec: reference in backend/internal/integration/*_test.go');
  process.exit(1);
}
