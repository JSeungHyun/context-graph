#!/usr/bin/env node
// 절차 템플릿(.sql)의 INSERT 컬럼 목록이 실제 스키마와 어긋났는지 잰다 — information_schema 를 SELECT 만 한다.
//   node tools/sql-template-check.mjs tools/graph/sql/org_add_insert.sql [다른.sql…]
// ⛔ 템플릿 컬럼이 DB 에 없다 / DB 의 NOT NULL·기본값 없는 컬럼이 템플릿에 빠졌다 → ⛔ 표시, exit 1
// ℹ 템플릿이 생략한 나머지 컬럼(nullable 또는 기본값 있음)은 개수만 — 생략은 의도다
// 접속: PGHOST·PGPORT·PGDATABASE·PGUSER·PGPASSWORD 환경변수, 없으면 로컬 기본값(localhost · apms_local · postgres · 1234)
// 스키마: PGSCHEMA 환경변수, 없으면 apms — 템플릿의 INSERT INTO <스키마>.<테이블> (<컬럼…>) 을 읽는다
// 왜 있나(2026-09-14): 컬럼 목록을 「변하는 것」으로 분류해 저장하지 않았더니 절차 질문마다 DB 에서 다시 뽑았다.
//   저장하고 이 한 줄로 낡음을 잡는 쪽이 싸다 — 스키마는 거의 안 변한다.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SCHEMA = process.env.PGSCHEMA || 'apms';
const files = process.argv.slice(2);
if (!files.length) { console.error('사용법: node tools/sql-template-check.mjs <템플릿.sql>…'); process.exit(1); }

function columns(table) {
  const sql = `select column_name, is_nullable, coalesce(column_default,'') from information_schema.columns
    where table_schema='${SCHEMA}' and table_name='${table}' order by ordinal_position`;
  const env = { ...process.env, PGCLIENTENCODING: 'UTF8', PGPASSWORD: process.env.PGPASSWORD || '1234' };
  const r = spawnSync('psql', ['-h', process.env.PGHOST || 'localhost', '-p', process.env.PGPORT || '5432',
    '-U', process.env.PGUSER || 'postgres', '-d', process.env.PGDATABASE || 'apms_local', '-tAc', sql], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`psql 실패: ${(r.stderr || '').trim()}`);
  return r.stdout.split('\n').filter(Boolean).map((l) => {
    const [name, nullable, def] = l.split('|');
    return { name, required: nullable === 'NO' && !def };
  });
}

let bad = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const re = new RegExp(`INSERT\\s+INTO\\s+${SCHEMA}\\.([a-z0-9_]+)\\s*\\(([^)]*)\\)`, 'gi');
  let m, n = 0;
  while ((m = re.exec(text))) {
    n++;
    const table = m[1].toLowerCase();
    // 예약어 컬럼은 "desc" 처럼 따옴표로 감싸므로 벗겨서 비교한다
    const tpl = m[2].split(',').map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase()).filter(Boolean);
    const db = columns(table);
    if (!db.length) { console.log(`⛔ ${file} #${n} ${SCHEMA}.${table}: 테이블이 없다`); bad++; continue; }
    const names = new Set(db.map((c) => c.name));
    const unknown = tpl.filter((c) => !names.has(c));
    const missing = db.filter((c) => c.required && !tpl.includes(c.name)).map((c) => c.name);
    const omitted = db.filter((c) => !c.required && !tpl.includes(c.name)).length;
    const ok = !unknown.length && !missing.length;
    console.log(`${ok ? '✅' : '⛔'} ${file} #${n} ${SCHEMA}.${table}: 템플릿 ${tpl.length}컬럼 · DB ${db.length}컬럼 · 생략 ${omitted}(nullable/기본값)`);
    if (unknown.length) console.log(`   ⛔ DB 에 없는 컬럼: ${unknown.join(', ')}`);
    if (missing.length) console.log(`   ⛔ 필수(NOT NULL·기본값 없음)인데 템플릿에 없음: ${missing.join(', ')}`);
    if (!ok) bad++;
  }
  if (!n) console.log(`⚠️ ${file}: INSERT INTO ${SCHEMA}.<table> (<cols>) 형태가 없다`);
}
process.exit(bad ? 1 : 0);
