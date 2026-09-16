#!/usr/bin/env node
// PreToolUse(Bash) 훅 — DB 클라이언트로 쓰기 SQL 을 실행하려 하면 차단한다.
// ⛔ 규칙을 지침에 적어두는 것으로는 못 막는다(2026-09-07). 실행 경로에서 끊는다.

// ⛔ 명령 전체를 훑으면 안 된다 — 설명 문구에 걸린다(2026-09-07 실측: 그래프 기록에 적은
//    「psql -f 파일 / psql < 파일 도 차단한다」는 설명이 스스로 차단됐다).
//    세그먼트(줄·파이프·세미콜론)로 쪼개, DB CLI 가 **명령 위치**에 온 것만 검사한다.
const DB_CLI = /^(?:\w+=\S*\s+)*(psql|pgcli|mysql|mariadb|sqlcmd|sqlite3|mongosh?|redis-cli)(\s|$)/i;
const segments = (cmd) => cmd.split(/[\n;|&]+/).map((s) => s.trim()).filter(Boolean);

// 쓰기·DDL. 단어 경계로 잡아 컬럼명(update_date 등) 오탐을 피한다.
const WRITE = new RegExp(
  [
    'insert\\s+into', 'update\\s+[\\w"`.]+\\s+set', 'delete\\s+from',
    'truncate\\b', 'drop\\s+(table|view|index|schema|database|function|trigger|role|user)',
    'alter\\s+(table|view|schema|database|function|trigger|role|user|sequence)',
    'create\\s+(table|view|index|schema|database|function|trigger|role|user|sequence|extension)',
    'grant\\s+', 'revoke\\s+', 'copy\\s+[\\w".]+\\s+from', 'vacuum\\b', 'reindex\\b',
    'begin\\s*;', 'commit\\s*;', 'rollback\\s*;', 'refresh\\s+materialized',
  ].join('|'),
  'i',
);

// ⛔ 화이트리스트로 판정한다 — 「위험한 형태를 나열」하면 파이프·heredoc 처럼 빠져나갈 길이 남는다
//    (2026-09-07 실측: cat x.sql | psql, psql <<EOF 둘 다 블랙리스트를 통과했다).
//    -c/-tAc/--command 로 SQL 을 인라인으로 준 것만 검사 대상이고, 나머지는 내용 불명 → 차단.
const INLINE = /(^|\s)(-[A-Za-z]*c|--command)(\s|=)/;

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let cmd = '';
  try { cmd = JSON.parse(raw || '{}')?.tool_input?.command || ''; } catch { /* 파싱 실패는 통과 */ }
  const db = segments(cmd).filter((s) => DB_CLI.test(s));
  if (!db.length) process.exit(0);

  const bad = db.find((s) => !INLINE.test(s) || WRITE.test(s));
  if (!bad) process.exit(0);
  const why = INLINE.test(bad) ? '쓰기·DDL SQL'
    : '내용을 확인할 수 없는 실행 (파일·파이프·heredoc) — SQL 은 -c 로 인라인으로 준다';

  process.stderr.write(
    `⛔ DB 쓰기 차단 — ${why} 이 감지됐다.\n` +
    `이 프로젝트에서 DB 클라이언트는 조회(SELECT) 전용이다. INSERT·UPDATE·DELETE·DDL 은 실행하지 않는다.\n` +
    `쓰기가 필요하면 실행하지 말고 SQL 문을 사용자에게 제시한다 — 실행은 사용자가 한다.\n` +
    `차단된 부분: ${bad.slice(0, 300)}\n`,
  );
  process.exit(2);   // 2 = 차단. stderr 가 모델에게 전달된다
});
