#!/usr/bin/env node
// 요구 → 파일 간선을 append-only 로 기록한다.
// ⛔ 자동 로드되지 않는다 — graph-find.mjs 로 필요할 때만 찾는다. 그래서 무한히 커져도 세션 비용이 0이다.
//
// 사용법: stdin 으로 JSON 을 준다 (Windows 인용 지옥을 피하기 위함)
//   node tools/graph-append.mjs <<'EOF'
//   {"req":"목표승인에 검증 기능 추가","terms":["목표승인","검증"],
//    "files":["src/main/webapp/WEB-INF/view/goal/goal_list_appr.jsp"],
//    "note":"국내/해외 짝 둘 다 고쳐야 했다"}
//   EOF
//   ⭐ "supersedes" 는 문자열 1개 또는 배열 — 조각 여러 건을 정본 1건으로 통합할 때 배열을 쓴다(2026-09-14).
//
// ⭐ date 는 세상 시간(작업이 일어난 때), recorded 는 기록 시간(이 줄을 쓴 때) — 둘 다 자동으로 오늘이 들어간다.
//    과거를 소급 기록할 때만 date 를 직접 준다. 검증은 node tools/graph-find.mjs --check.
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const STORE = join(process.cwd(), 'tools/graph/requests.jsonl');

const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
// 경로에 `:256` 줄번호를 붙여 적는 사고가 있었다 — 그러면 존재 검사도 역방향 조회도 빗나간다.
const paths = (v) => strs(v).map((f) => f.replace(/:\d+(-\d+)?$/, ''));

export function normalize(rec, today) {
  if (!rec || typeof rec.req !== 'string' || !rec.req.trim()) {
    throw new Error('req 는 필수다 (사용자 요구를 한 줄로)');
  }
  // ⭐ terms 는 객체가 권장이다 — {"현업 용어": "시스템에서 무엇인가"}.
  //    배열도 받는다(구 레코드 호환). 아무것도 없으면 req 의 한글 토큰에서 뽑는다.
  let terms = rec.terms;
  if (terms && !Array.isArray(terms) && typeof terms === 'object') {
    terms = Object.fromEntries(Object.entries(terms).filter(([k, v]) => k.trim() && typeof v === 'string'));
  } else {
    const arr = strs(terms);
    terms = arr.length ? arr : [...new Set(rec.req.match(/[가-힣]{2,}/g) || [])];
  }
  return {
    // ⭐ 시간이 둘이다. 섞으면 「소급 기록」과 「순서 오류」를 구분할 수 없다.
    date: rec.date || today,           // 세상 시간 — 작업이 실제로 일어난 때 (과거를 소급 기록하면 과거 날짜)
    recorded: rec.recorded || today,   // 기록 시간 — 이 줄을 쓴 때. supersedes 순서는 이쪽으로 판정한다
    req: rec.req.trim(),
    terms,
    ...(strs(rec.tables).length ? { tables: strs(rec.tables) } : {}),   // apms.xxx 테이블
    files: paths(rec.files),
    // ⭐ 이 작업이 이전 기록을 무효화하면 그 req 를 적는다. 별개 작업이면 비운다.
    // ⭐ 문자열 1개 또는 배열 — 조각 여러 건을 정본 1건으로 통합할 때 배열(2026-09-14). 읽는 쪽은 graph-find 의 sup().
    ...(rec.supersedes ? { supersedes: Array.isArray(rec.supersedes) ? strs(rec.supersedes) : String(rec.supersedes) } : {}),
    ...(rec.note ? { note: rec.note } : {}),
  };
}

// ⛔ toISOString() 은 UTC 다 — KST 자정~오전 9시 작업이 통째로 하루 전으로 기록된다(2026-09-06 실측).
//    시간축이 어긋나면 소급 기록·세상시간 역행 검사가 같이 어긋난다. 로컬 날짜를 쓴다.
const localToday = () => new Date().toLocaleDateString('sv-SE');

export function appendRecord(rec, { store = STORE, today } = {}) {
  const out = normalize(rec, today || localToday());
  mkdirSync(dirname(store), { recursive: true });
  appendFileSync(store, JSON.stringify(out) + '\n', 'utf8');
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('graph-append.mjs')) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    if (!raw.trim()) { console.error('⛔ stdin 으로 JSON 을 준다. 사용법은 파일 머리 주석 참조.'); process.exit(1); }
    // 여러 줄 JSONL 도 허용한다.
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    let n = 0;
    for (const l of lines) {
      try {
        const out = appendRecord(JSON.parse(l));
        console.log(`+ ${out.date}  ${out.req.slice(0, 44)}  (파일 ${out.files.length})`);
        n++;
      } catch (e) {
        // 한 줄 JSON 이 아니면 전체를 하나의 객체로 재시도한다.
        if (lines.length === 1) { console.error(`⛔ ${e.message}`); process.exit(1); }
        console.error(`⛔ 건너뜀: ${e.message}`);
      }
    }
    if (lines.length > 1 && n === 0) {
      try { const out = appendRecord(JSON.parse(raw)); console.log(`+ ${out.date}  ${out.req.slice(0, 44)}`); n = 1; }
      catch (e) { console.error(`⛔ ${e.message}`); process.exit(1); }
    }
    const total = existsSync(STORE) ? readFileSync(STORE, 'utf8').trim().split('\n').filter(Boolean).length : 0;
    console.log(`기록 ${n}건 추가 · 누적 ${total}건`);
  });
}
