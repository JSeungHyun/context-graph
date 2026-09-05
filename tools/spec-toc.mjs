#!/usr/bin/env node
// spec.md 의 ## 절과 라인 범위를 낸다. spec-map.md 의 목차 표를 이걸로 갱신한다.
import { readFileSync } from 'node:fs';

export function tocOf(mdSrc) {
  const lines = mdSrc.split(/\r?\n/);
  const heads = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(#{2,3})\s+(.*)$/);
    if (m) heads.push({ level: m[1].length, title: m[2].trim(), from: i + 1 });
  });
  // ⛔ 「바로 다음 heading」이 아니라 「다음 동일 레벨 이하 heading」이 끝이다.
  //    ## 아래에 ### 가 있으면 전자는 하위절 직전에서 끊겨 범위가 잘못 축소된다 (실측: 26–103 이 26–27 로).
  return heads.map((h, i) => {
    const next = heads.slice(i + 1).find((x) => x.level <= h.level);
    return { ...h, to: next ? next.from - 1 : lines.length };
  });
}

if (process.argv[1] && process.argv[1].endsWith('spec-toc.mjs')) {
  const file = process.argv[2] || 'spec.md';
  for (const h of tocOf(readFileSync(file, 'utf8'))) {
    if (h.level !== 2) continue;
    console.log(`| ${h.title} | ${h.from}–${h.to} |`);
  }
}
