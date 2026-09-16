#!/usr/bin/env node
// 그래프 검색 품질 측정 — 수치를 말하기 전에 잰다(AGENTS.md「이 구조 자체를 평가·개선할 때」§2·§3).
//   node tools/graph-measure.mjs "<주제 정규식>" ["<정규식>"…]   # 티켓 제목 → 훅과 같은 판정으로 확신·정본 1위·상위 제목
//   node tools/graph-measure.mjs --self                         # 살아있는 기록의 req 를 질의로 → 그 기록이 1위인가 (회귀 지표)
//   옵션 --tickets <json>  (기본 dooray-2022-2026.json, tasks[].subj 를 읽는다)
// 판정은 graph-hook.mjs 와 같다 — 대체·사무 기록 제외, tokenizeKo/tokenizeIds, 확신 = 정확일치≥1 | 식별자 적중 | 점수≥5.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { load, scoreDetail, sup, tokenizeKo, tokenizeIds } from './graph-find.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const ti = args.indexOf('--tickets');
const ticketsPath = ti >= 0 ? args.splice(ti, 2)[1] : join(HERE, '..', 'dooray-2022-2026.json');
const self = args.includes('--self');
const patterns = args.filter((a) => a !== '--self');

const all = load(join(HERE, 'graph', 'requests.jsonl'));
const dead = new Set(all.flatMap(sup));
const BOOK = /^TODO 갱신|^TODO:/;
const recs = all.filter((r) => !BOOK.test(r.req) && !dead.has(r.req));
const rank = (q) => {
  const ko = tokenizeKo(q), ids = tokenizeIds(q);
  const hits = recs.map((r) => ({ r, ...scoreDetail(r, [...ko, ...ids]) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.r.date || '').localeCompare(a.r.date || ''));
  const top = hits[0];
  const confident = !!top && (top.exact >= 1 || (ids.length > 0 && scoreDetail(top.r, ids).s > 0) || top.s >= 5);
  return { top, confident };
};

if (self) {
  let ok = 0; const miss = [];
  for (const r of recs) { const { top } = rank(r.req); if (top && top.r === r) ok++; else miss.push(r.req.slice(0, 48)); }
  console.log(`req 자기검색 1위 ${ok}/${recs.length}${miss.length ? `\n  미적중: ${miss.join(' | ')}` : ''}`);
}
if (patterns.length) {
  if (!existsSync(ticketsPath)) { console.error(`티켓 파일 없음: ${ticketsPath}`); process.exit(1); }
  const d = JSON.parse(readFileSync(ticketsPath, 'utf8'));
  const subj = (d.tasks || d).map((t) => t.subj || t.subject || '').filter(Boolean);
  for (const p of patterns) {
    const re = new RegExp(p);
    const qs = subj.filter((s) => re.test(s));
    let conf = 0, canon = 0; const tops = new Map();
    for (const q of qs) {
      const { top, confident } = rank(q);
      if (!confident) continue;
      conf++;
      if (/^정본:/.test(top.r.req)) canon++;
      const k = top.r.req.slice(0, 28); tops.set(k, (tops.get(k) || 0) + 1);
    }
    const topStr = [...tops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k}×${v}`).join(' , ');
    console.log(`/${p}/ 질의 ${qs.length} · 확신 ${conf} · 정본1위 ${canon} · 확신 1위 상위: ${topStr}`);
  }
}
if (!self && !patterns.length) { console.error('사용법: node tools/graph-measure.mjs "<주제 정규식>"… | --self  [--tickets <json>]'); process.exit(1); }
