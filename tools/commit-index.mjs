#!/usr/bin/env node
// 커밋에서 어휘→영역 간선·쌍 비대칭·열지도를 뽑는다.
// ⛔ 출력은 상관이지 인과가 아니다. spec-map.md 에는 큐레이션해서 넣는다.
import { execFileSync } from 'node:child_process';

const STOP = new Set(['수정', '변경', '추가', '관련', '기능', '코드', '부분', '처리', '개선',
  '오류', '문제', '누락', '적용', '반영', '생성', '분리', '확인', '제거', '정리', '개발', '수정사항']);
const SEP = '\x1e';

export function loadCommits(since, cwd = process.cwd()) {
  const raw = execFileSync('git', ['-C', cwd, 'log', '--all', `--since=${since}`,
    `--format=${SEP}%s`, '--name-only', '--no-merges'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return raw.split(SEP).filter(Boolean).map((b) => {
    const lines = b.split('\n').filter((l) => l.trim());
    return { subject: lines[0], files: lines.slice(1) };
  });
}

export function termEdges(commits, { minTotal = 6 } = {}) {
  const map = new Map();
  for (const c of commits) {
    const subject = c.subject.replace(/^[a-z]+:\s*/, '');
    const terms = new Set((subject.match(/[가-힣]{2,}/g) || []).filter((t) => !STOP.has(t)));
    const dirs = new Set(c.files.map((f) => f.replace(/\/[^/]*$/, '')));
    for (const t of terms) {
      if (!map.has(t)) map.set(t, new Map());
      const m = map.get(t);
      for (const d of dirs) m.set(d, (m.get(d) || 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([term, m]) => ({
      term,
      total: [...m.values()].reduce((a, b) => a + b, 0),
      top: [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2),
    }))
    .filter((r) => r.total >= minTotal)
    .sort((a, b) => b.total - a.total);
}

export function pairAsymmetry(commits, a, b) {
  let both = 0, onlyA = 0, onlyB = 0;
  const samples = [];
  for (const c of commits) {
    const ha = c.files.some((f) => f.endsWith(a));
    const hb = c.files.some((f) => f.endsWith(b));
    if (ha && hb) both++;
    else if (ha) { onlyA++; samples.push(c.subject); }
    else if (hb) { onlyB++; samples.push(c.subject); }
  }
  return { both, onlyA, onlyB, samples };
}

if (process.argv[1] && process.argv[1].endsWith('commit-index.mjs')) {
  const since = process.argv[2] || '6 months ago';
  const commits = loadCommits(since);
  console.log(`커밋 ${commits.length}건 (머지 제외 · since ${since})\n`);

  console.log('── 어휘 → 자주 함께 바뀐 영역 ──');
  for (const e of termEdges(commits).slice(0, 20)) {
    console.log(`  ${e.term.padEnd(8)} → ${e.top.map(([d, n]) => `${d.replace('src/main/', '')} (${n})`).join(' · ')}`);
  }

  for (const [a, b, label] of [
    ['message_ko.properties', 'message_en.properties', 'ko/en 메시지'],
    ['goal_list_main.jsp', 'goal_list_main_global.jsp', '목표목록 국내/해외'],
  ]) {
    const r = pairAsymmetry(commits, a, b);
    console.log(`\n── ${label} ── 함께 ${r.both} · A만 ${r.onlyA} · B만 ${r.onlyB}`);
    for (const s of r.samples.slice(0, 5)) console.log(`     ${s}`);
  }

  console.log('\n── 열지도 (변경 잦은 영역 12) ──');
  const heat = new Map();
  for (const c of commits) for (const f of new Set(c.files.map((f) => f.replace(/\/[^/]*$/, '')))) {
    heat.set(f, (heat.get(f) || 0) + 1);
  }
  for (const [d, n] of [...heat.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(3)}  ${d}`);
  }
}
