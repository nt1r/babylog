/**
 * BabyLog 发版元数据单一事实来源模块：
 * 统一提供 SemVer 2.0.0 严格校验与版本序比较、`package.json` 版本号更新，
 * 以及 `CHANGELOG.md` 章节提取与 `[Unreleased]` 精准切分，供 `scripts/release-check.sh`
 * 与 `scripts/release.sh` 共用，避免多处复制正则与解析逻辑产生漂移。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER_CORE_RE =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

/** 严格按 SemVer 2.0.0 校验并拆解版本号，拒绝前导零与非法预发布标识。 */
function parseSemver(raw, { requireV = false } = {}) {
  const trimmed = String(raw ?? '').trim();
  if (requireV && !trimmed.startsWith('v')) {
    return null;
  }
  const cleaned = trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
  const match = SEMVER_CORE_RE.exec(cleaned);
  if (!match) {
    return null;
  }
  return {
    raw: trimmed,
    version: cleaned,
    tag: `v${cleaned}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    majorMinor: `v${match[1]}.${match[2]}`,
    prerelease: match[4] ? match[4].split('.') : [],
    isPrerelease: Boolean(match[4]),
  };
}

/** 按 SemVer 2.0.0 优先级比较两个已解析版本对象。 */
function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;

  const len = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < len; i += 1) {
    if (i >= a.prerelease.length) return -1;
    if (i >= b.prerelease.length) return 1;
    const ai = a.prerelease[i];
    const bi = b.prerelease[i];
    const aNum = /^[0-9]+$/.test(ai);
    const bNum = /^[0-9]+$/.test(bi);
    if (aNum && bNum) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return diff;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}

/** 从 CHANGELOG.md 文本中提取指定 `## [heading]` 章节正文（未命中返回 null）。 */
function extractChangelogSection(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRe = new RegExp(`^## \\[${escaped}\\](?:\\s|$)`, 'm');
  const match = startRe.exec(text);
  if (!match) {
    return null;
  }
  const rest = text.slice(match.index + match[0].length);
  const nextIdx = rest.search(/^## \[/m);
  return (nextIdx === -1 ? rest : rest.slice(0, nextIdx)).replace(/^[^\n]*\n?/, '').trim();
}

/** 仅精准替换顶层 `"version"` 字段值，保持 Biome 2 空格缩进与其余行原样不变。 */
function bumpPackageJsonVersion(pkgRaw, version) {
  const updated = pkgRaw.replace(/^(\s*"version"\s*:\s*)"[^"]*"/m, `$1"${version}"`);
  if (updated === pkgRaw) {
    throw new Error('未能定位 package.json 中的 version 字段');
  }
  return updated;
}

/**
 * 将 CHANGELOG.md 中 `## [Unreleased]` 的正文切分到 `## [version] - dateStr` 新章节，
 * 同时在顶部保留空的 `## [Unreleased]` 且不改动历史版本段落的原始空行与排版。
 */
function cutUnreleasedChangelog(clRaw, version, dateStr) {
  const startRe = /^## \[Unreleased\][^\n]*\r?\n?/m;
  const match = startRe.exec(clRaw);
  if (!match) {
    throw new Error('CHANGELOG.md 缺少 ## [Unreleased] 章节');
  }
  const before = clRaw.slice(0, match.index).replace(/\s+$/, '');
  const afterHeading = clRaw.slice(match.index + match[0].length);
  const nextIdx = afterHeading.search(/^## \[/m);
  const unreleasedBody = (nextIdx === -1 ? afterHeading : afterHeading.slice(0, nextIdx)).trim();
  if (!unreleasedBody) {
    throw new Error('CHANGELOG.md 中 ## [Unreleased] 章节内容为空');
  }
  const tail = nextIdx === -1 ? '' : afterHeading.slice(nextIdx).replace(/^(?:\r?\n)+/, '');

  const parts = [];
  if (before) {
    parts.push(before, '');
  }
  parts.push('## [Unreleased]', '', `## [${version}] - ${dateStr}`, '', unreleasedBody);
  if (tail) {
    parts.push('', tail.replace(/\s+$/, ''));
  }
  return `${parts.join('\n')}\n`;
}

/** 校验目标版本号严格高于现有标签列表中的最高 SemVer 标签，并返回现有最高标签名。 */
function findHighestTagAndCheckMonotonic(targetRaw, allTagsText) {
  const target = parseSemver(targetRaw);
  if (!target) {
    throw new Error(`版本号 "${targetRaw}" 不符合 SemVer 2.0.0 规范（示例: 0.1.0、v0.1.0 或 0.1.0-rc.1）`);
  }
  const parsed = String(allTagsText ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseSemver(line, { requireV: true }))
    .filter(Boolean);
  if (parsed.length === 0) {
    return '';
  }
  parsed.sort(compareSemver);
  const highest = parsed[parsed.length - 1];
  if (compareSemver(target, highest) <= 0) {
    throw new Error(`目标版本 ${target.tag} 必须高于现有最高标签 ${highest.raw}`);
  }
  return highest.raw;
}

/** 解析形如 `--key value` 与 `--flag` 的轻量命令行参数。 */
function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

/** 运行内置自检，覆盖 SemVer 边界、版本序比较、package.json 更新与 CHANGELOG 切分。 */
function runSelfTest() {
  assert.equal(parseSemver('0.1.0')?.tag, 'v0.1.0');
  assert.equal(parseSemver('v1.2.3-rc.1', { requireV: true })?.isPrerelease, true);
  assert.equal(parseSemver('0.1.0', { requireV: true }), null);
  assert.equal(parseSemver('01.0.0'), null);
  assert.equal(parseSemver('v1.0'), null);
  assert.equal(parseSemver('1.0.0-bad_pre'), null);
  assert.equal(parseSemver('1.0.0-01'), null);
  assert.equal(parseSemver('1.0.0-..'), null);

  const ordered = ['v0.1.0-alpha.1', 'v0.1.0-alpha.2', 'v0.1.0-beta.1', 'v0.1.0-rc.1', 'v0.1.0', 'v0.2.0'];
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const left = parseSemver(ordered[i], { requireV: true });
    const right = parseSemver(ordered[i + 1], { requireV: true });
    assert.ok(compareSemver(left, right) < 0, `${ordered[i]} 应小于 ${ordered[i + 1]}`);
  }

  assert.equal(findHighestTagAndCheckMonotonic('0.2.0', 'v0.1.0\nv0.2.0-rc.1\n'), 'v0.2.0-rc.1');
  assert.throws(() => findHighestTagAndCheckMonotonic('0.1.0', 'v0.1.0\nv0.2.0\n'), /必须高于现有最高标签 v0\.2\.0/);

  const samplePkg = '{\n  "name": "babylog",\n  "version": "0.1.0"\n}\n';
  assert.equal(bumpPackageJsonVersion(samplePkg, '0.2.0'), '{\n  "name": "babylog",\n  "version": "0.2.0"\n}\n');

  const firstCl = '# Changelog\n\n## [Unreleased]\n\n### Added\n- 首个版本\n';
  const cutFirst = cutUnreleasedChangelog(firstCl, '0.1.0', '2026-11-26');
  assert.equal(cutFirst, '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-11-26\n\n### Added\n- 首个版本\n');
  assert.equal(extractChangelogSection(cutFirst, '0.1.0'), '### Added\n- 首个版本');
  assert.equal(extractChangelogSection(cutFirst, 'Unreleased'), '');

  const secondCl =
    '# Changelog\n\n## [Unreleased]\n\n### Fixed\n- 修复问题\n\n## [0.1.0] - 2026-11-20\n\n### Added\n\n\n- 保留历史排版\n';
  const cutSecond = cutUnreleasedChangelog(secondCl, '0.2.0', '2026-11-26');
  assert.ok(cutSecond.includes('### Added\n\n\n- 保留历史排版'), '切分 CHANGELOG 不应改写历史章节内的多空行');
  assert.equal(extractChangelogSection(cutSecond, '0.2.0'), '### Fixed\n- 修复问题');
  assert.equal(extractChangelogSection(cutSecond, '0.1.0'), '### Added\n\n\n- 保留历史排版');

  console.log('release-meta: self-test ok');
}

function main(argv) {
  if (argv[0] === '--self-test') {
    runSelfTest();
    return;
  }

  const command = argv[0];
  const { flags, positional } = parseFlags(argv.slice(1));

  if (command === 'parse-version') {
    const raw = positional[0] ?? '';
    const parsed = parseSemver(raw, { requireV: Boolean(flags['require-v']) });
    if (!parsed) {
      const hint = flags['require-v'] ? 'v0.1.0 或 v0.1.0-rc.1' : '0.1.0、v0.1.0 或 0.1.0-rc.1';
      throw new Error(`版本号 "${raw}" 不符合 SemVer 2.0.0 规范（示例: ${hint}）`);
    }
    console.log(`${parsed.version}|${parsed.tag}|${parsed.majorMinor}|${parsed.isPrerelease ? 'true' : 'false'}`);
    return;
  }

  if (command === 'check-monotonic') {
    const raw = positional[0] ?? '';
    const tagsText = process.env.ALL_TAGS ?? fs.readFileSync(0, 'utf8');
    const highest = findHighestTagAndCheckMonotonic(raw, tagsText);
    if (highest) {
      console.log(highest);
    }
    return;
  }

  if (command === 'verify') {
    const parsed = parseSemver(flags.tag ?? '', { requireV: true });
    if (!parsed) {
      throw new Error(`Tag "${flags.tag ?? ''}" 不符合 SemVer 2.0.0 规范（示例: v0.1.0 或 v0.1.0-rc.1）`);
    }
    const pkgPath = typeof flags.pkg === 'string' ? flags.pkg : 'package.json';
    const clPath = typeof flags.changelog === 'string' ? flags.changelog : 'CHANGELOG.md';
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.version !== parsed.version) {
      throw new Error(`Tag 版本 (${parsed.version}) 与 package.json version (${pkg.version}) 不一致`);
    }

    const cl = fs.readFileSync(clPath, 'utf8');
    const body = extractChangelogSection(cl, parsed.version);
    if (body === null) {
      throw new Error(`CHANGELOG.md 中未找到对应版本章节：## [${parsed.version}]`);
    }
    if (!body) {
      throw new Error(`CHANGELOG.md 中 ## [${parsed.version}] 章节内容为空`);
    }

    if (typeof flags['write-notes'] === 'string' && flags['write-notes']) {
      fs.writeFileSync(flags['write-notes'], `${body}\n`, 'utf8');
    }

    const commit = typeof flags.commit === 'string' && flags.commit ? flags.commit : 'unknown';
    const buildDate = typeof flags['build-date'] === 'string' && flags['build-date'] ? flags['build-date'] : 'unknown';
    if (typeof flags['github-output'] === 'string' && flags['github-output']) {
      const meta = [
        `tag=${parsed.tag}`,
        `version=${parsed.version}`,
        `major_minor=${parsed.majorMinor}`,
        `commit=${commit}`,
        `build_date=${buildDate}`,
        `is_prerelease=${parsed.isPrerelease ? 'true' : 'false'}`,
      ];
      fs.appendFileSync(flags['github-output'], `${meta.join('\n')}\n`, 'utf8');
    }

    if (!flags.quiet) {
      const updatesLatest = parsed.isPrerelease ? '否（预发布版本不覆盖 latest）' : '是（推送 :latest 与次版本标签）';
      const noteLines = body.split('\n').length;
      console.log(
        [
          `目标标签: ${parsed.tag}`,
          `版本号: ${parsed.version}（与 package.json 一致）`,
          `次版本标签: ${parsed.majorMinor}`,
          `更新 latest: ${updatesLatest}`,
          `CHANGELOG 正文: 已校验（${noteLines} 行）`,
          `当前提交: ${commit}`,
        ].join('\n'),
      );
    }
    return;
  }

  if (command === 'plan') {
    const parsed = parseSemver(flags.version ?? '');
    if (!parsed) {
      throw new Error(`版本号 "${flags.version ?? ''}" 不符合 SemVer 2.0.0 规范`);
    }
    const pkgPath = typeof flags.pkg === 'string' ? flags.pkg : 'package.json';
    const clPath = typeof flags.changelog === 'string' ? flags.changelog : 'CHANGELOG.md';
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const cl = fs.readFileSync(clPath, 'utf8');

    const existingBody = extractChangelogSection(cl, parsed.version);
    const unreleasedBody = extractChangelogSection(cl, 'Unreleased');

    const needPkgBump = pkg.version !== parsed.version;
    let needChangelogCut = false;
    let notes = '';

    if (existingBody && existingBody.length > 0) {
      notes = existingBody;
    } else if (unreleasedBody && unreleasedBody.length > 0) {
      needChangelogCut = true;
      notes = unreleasedBody;
    } else {
      throw new Error(
        `origin/dev 的 CHANGELOG.md 中既无非空 ## [${parsed.version}] 章节，也无非空 ## [Unreleased] 变更记录，请先在 dev 补充更新日志`,
      );
    }

    if (typeof flags['write-notes'] === 'string' && flags['write-notes']) {
      fs.writeFileSync(flags['write-notes'], `${notes}\n`, 'utf8');
    }

    const needPrepare = needPkgBump || needChangelogCut ? '1' : '0';
    console.log(
      `${pkg.version}|${needPrepare}|${needPkgBump ? '1' : '0'}|${needChangelogCut ? '1' : '0'}|${notes.split('\n').length}`,
    );
    return;
  }

  if (command === 'prepare') {
    const parsed = parseSemver(flags.version ?? '');
    if (!parsed) {
      throw new Error(`版本号 "${flags.version ?? ''}" 不符合 SemVer 2.0.0 规范`);
    }
    const pkgPath = typeof flags.pkg === 'string' ? flags.pkg : 'package.json';
    const clPath = typeof flags.changelog === 'string' ? flags.changelog : 'CHANGELOG.md';
    if (flags['bump-pkg']) {
      const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
      fs.writeFileSync(pkgPath, bumpPackageJsonVersion(pkgRaw, parsed.version), 'utf8');
    }
    if (flags['cut-changelog']) {
      const dateStr = typeof flags.date === 'string' && flags.date ? flags.date : new Date().toISOString().slice(0, 10);
      const clRaw = fs.readFileSync(clPath, 'utf8');
      fs.writeFileSync(clPath, cutUnreleasedChangelog(clRaw, parsed.version, dateStr), 'utf8');
    }
    return;
  }

  throw new Error(`未知子命令: ${command ?? '(空)'}`);
}

const isDirectEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectEntry) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
