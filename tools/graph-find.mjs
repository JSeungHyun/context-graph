#!/usr/bin/env node
// 새 요구가 오면 과거 유사 요구와 그때 만진 파일을 찾는다. ⭐ 시작점을 공짜로 얻는 것이 목적이다.
//
//   node tools/graph-find.mjs 목표승인 검증
//   node tools/graph-find.mjs --files GoalSettingDao      # 파일 경로로 역방향 조회 (1홉)
//   node tools/graph-find.mjs --with  goal_popup_set      # 이 파일과 같이 만지게 되는 파일 (2홉)
//   node tools/graph-find.mjs --check                     # 대체 사슬·경로 무결성 검증
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STORE = join(process.cwd(), 'tools/graph/requests.jsonl');

export function load(store = STORE) {
  if (!existsSync(store)) return [];
  return readFileSync(store, 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

// 질의·커밋에서 걷어낼 흔한 말. ⛔ 여기 두는 이유 — commit-index 는 선택 복사라 훅이 의존하면 깨진다.
// ⚠️ 도메인 명사(화면·기간·목표…)는 넣지 않는다. 그것들이 이 저장소의 신호다.
export const STOP = new Set(['수정', '변경', '추가', '관련', '기능', '코드', '부분', '처리', '개선',
  '오류', '문제', '누락', '적용', '반영', '생성', '분리', '확인', '제거', '정리', '개발', '수정사항',
  '작업', '어떻게', '무엇', '어디', '언제', '해줘', '알려줘', '하는', '해야', '지금', '다시', '좀']);

// terms 는 객체({현업어: 시스템어}) 또는 배열이다. 둘 다 다룬다.
const termKeys = (r) => (Array.isArray(r.terms) ? r.terms : Object.keys(r.terms || {}));
const termPairs = (r) => (Array.isArray(r.terms) ? [] : Object.entries(r.terms || {}));

// 요구·용어에 질의어가 몇 개 걸리는지로 점수를 낸다. 부분 문자열 매칭 — 한국어는 어미가 붙으므로.
// ⛔ 합계만으로는 「정확일치 1건」과 「흔한 말이 세 군데 스침」을 구분할 수 없다 — 둘 다 3점이다.
//    그 탓에 노이즈가 문턱을 넘어 2단 색인을 막았다(2026-09-04 실측: 정확일치 0인 기록 3건이 3점).
//    ⇒ 종류를 같이 돌려준다. 판정은 부르는 쪽이 한다.
export function scoreDetail(rec, queries) {
  const keys = termKeys(rec);
  const hay = [rec.req, keys.join(' '), termPairs(rec).map(([, v]) => v).join(' '),
    (rec.tables || []).join(' ')].join(' ').toLowerCase();
  // ⛔ files·note 가 건초더미에서 빠져 있었다 — 파일명으로 물으면 0건이 나오고,
  //    「그 파일을 만지진 않았지만 함정을 아는」 기록이 통째로 누락됐다(2026-09-04 실측).
  // ⛔ 둘을 같은 2점으로 묶었더니 note 에 낱말이 스친 무관한 기록이 용어 키를 가진 정본을 눌렀다.
  //    2026-09-09 에 「조직 추가」 정본이 밀려 이미 기록된 답을 못 찾고 재조사해 반대 결론을 냈다.
  //    ⇒ 경로는 2점(1건만 맞아도 확실), note 스침은 1점(용어 부분일치와 동급)으로 가른다.
  const paths = (rec.files || []).join(' ').toLowerCase();
  const noteTxt = (rec.note || '').toLowerCase();
  let s = 0, exact = 0, body = 0, near = 0;
  for (const q of queries) {
    const t = q.toLowerCase();
    // ⭐ 공백을 무시하고 비교한다 — 훅 토크나이저는 공백 토큰을 못 만드는데 살아있는 용어키 300/439(68%)가
    //    공백을 포함해 정확일치(+3·확신 게이트)를 영영 못 받고 있었다(2026-09-10 실측).
    //    용어키→소유 기록 1위 56%→76%, req 자기검색 103/106 불변. 채점 가중이 아니라 판정 정규화다.
    const tn = t.replace(/\s+/g, '');
    if (keys.some((x) => x.toLowerCase().replace(/\s+/g, '') === tn)) { s += 3; exact++; }   // 용어 정확 일치
    else if (paths.includes(t)) { s += 2; near++; }                     // 경로가 직접 지목
    else if (hay.includes(t)) { s += 1; body++; }                       // 본문·매핑값·테이블 포함
    else if (noteTxt.includes(t)) { s += 1; body++; }                   // 함정 본문에 스침
  }
  return { s, exact, body, near };
}

export const score = (rec, queries) => scoreDetail(rec, queries).s;

export function findByFile(recs, needle) {
  const n = needle.toLowerCase();
  return recs.filter((r) => (r.files || []).some((f) => f.toLowerCase().includes(n)));
}

// ⭐ 파생 색인. 저장은 평평한 줄 목록이고 그래프는 읽을 때 만든다 — 215 간선이라 매번 만드는 편이 싸다.
//    기록 순서는 줄 순서다(append-only). recorded 가 있으면 그것을 쓴다.
export function index(recs) {
  const out = recs.map((r, i) => ({ ...r, seq: i + 1 }));
  for (const r of out) {
    const heirs = out.filter((x) => x.supersedes === r.req);
    if (heirs.length) {
      r.supersededBy = heirs[0];
      r.validTo = heirs[0].recorded || heirs[0].date;  // 이 기록이 낡은 시점
    }
  }
  return out;
}

// 2홉: 파일 → 그 파일을 만진 요구 → 그 요구가 같이 만진 파일.
// ⭐ 「이 파일을 고치면 무엇이 같이 움직이나」 — 국내/해외 짝, ko/en 짝이 여기서 드러난다.
export function coChange(recs, needle) {
  const n = needle.toLowerCase();
  const hits = findByFile(recs, n);
  const co = new Map();
  for (const r of hits) {
    for (const f of new Set(r.files || [])) {
      if (f.toLowerCase().includes(n)) continue;
      if (!co.has(f)) co.set(f, { n: 0, reqs: [] });
      const e = co.get(f);
      e.n++;
      e.reqs.push(r);
    }
  }
  return { hits, co: [...co.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])) };
}

// 무결성 — 문자열로 잇는 구조라 오타 한 글자로 사슬이 끊긴다. 그걸 조용히 두지 않는다.
export function check(recs, { fileExists } = {}) {
  const byReq = new Map();
  for (const r of recs) byReq.set(r.req, r);
  const problems = [];

  for (const r of recs) {
    if (!r.supersedes) continue;
    const old = byReq.get(r.supersedes);
    if (!old) { problems.push(['고아 대체', `줄${r.seq} ${r.req.slice(0, 40)} → 「${r.supersedes.slice(0, 40)}」 (그런 기록 없음)`]); continue; }
    if (old.seq >= r.seq) problems.push(['기록순 역행', `줄${r.seq} 가 줄${old.seq} 을 대체 — 나중 것이 먼저 기록될 수 없다`]);
    if (old.req === r.req) problems.push(['자기 대체', `줄${r.seq} ${r.req.slice(0, 40)}`]);
    // ⛔ 소급 기록 함정 — 과거를 나중에 append 하면 기록순은 정상이라 위 검사를 통과하지만,
    //    세상시간으로는 과거가 최신을 무효화하는 셈이 된다(2026-09-04 실측: 08-19 가 08-26 을 대체).
    if (r.date && old.date && r.date < old.date) {
      problems.push(['세상시간 역행', `${r.date} 기록이 더 최신인 ${old.date} 을 대체 — 소급 기록에는 supersedes 를 붙이지 않는다`]);
    }
  }
  const dupes = new Map();
  for (const r of recs) if (r.supersedes) dupes.set(r.supersedes, (dupes.get(r.supersedes) || 0) + 1);
  for (const [req, n] of dupes) if (n > 1) problems.push(['중복 대체', `「${req.slice(0, 40)}」 를 ${n}개 기록이 대체한다 — 사슬이 갈라진다`]);

  // 경로가 사라졌으면 그래프가 코드보다 낡은 것이다.
  // ⛔ 대체된 기록은 빼고 본다 — 경로가 없어진 것이 바로 대체된 이유인 경우가 많아 영구 오탐이 된다
  //    (실측 2026-09-06: 스킬 이름 변경으로 죽은 옛 경로가 --check 를 계속 exit 1 로 만들었다).
  //    ⚠️ 경고가 늘 켜져 있으면 사람이 무시하게 되고, 그러면 검사가 없는 것과 같다.
  const superseded = new Set(recs.filter((r) => r.supersedes).map((r) => r.supersedes));
  const gone = [];
  if (fileExists) {
    for (const r of recs) {
      if (superseded.has(r.req)) continue;
      for (const f of r.files || []) if (!fileExists(f)) gone.push([r, f]);
    }
  }
  const noRecorded = recs.filter((r) => !r.recorded);
  const retro = recs.filter((r) => r.recorded && r.date && r.date < r.recorded);

  // ⛔ 같은 용어를 여러 기록이 가질 때 과거가 1위면 새 세션이 낡은 값을 그대로 답한다(2026-09-05 실측).
  //    「값이 낡았는지」는 기계가 못 정하지만 「최신이 1위인지」는 계산된다 — 거기까지만 경고한다.
  // ⭐ scoreDetail 과 같은 정규화(소문자·공백 제거)로 묶는다 — 훅이 「종합 등급」과 「종합등급」을 같은 키로
  //    보게 된 뒤(2026-09-10 V8), 여기만 원문으로 묶으면 그 쌍이 중복 용어로 안 세어져 선점 검사가 비켜간다.
  //    실측 2026-09-11: 살아있는 기록 간 공백만 다른 키 쌍 1개(줄58↔줄110) — 지금은 최신이 1위라 잠복 상태.
  const owners = new Map();
  for (const r of recs) for (const k of termKeys(r)) {
    const nk = k.toLowerCase().replace(/\s+/g, '');
    if (!owners.has(nk)) owners.set(nk, []);
    owners.get(nk).push(r);
  }
  const stale = [];
  for (const [k, v] of owners) {
    if (v.length < 2) continue;
    const top = v.map((r) => ({ r, s: scoreDetail(r, [k]).s }))
      .sort((a, b) => b.s - a.s || String(b.r.date).localeCompare(String(a.r.date)))[0].r;
    const newest = [...v].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (String(top.date) < String(newest.date)) stale.push({ k, top, newest, n: v.length });
  }
  return { problems, gone, noRecorded, retro, stale, dupTerms: [...owners.values()].filter((v) => v.length > 1).length };
}

if (process.argv[1] && process.argv[1].endsWith('graph-find.mjs')) {
  const args = process.argv.slice(2);
  const recs = index(load());

  if (!recs.length) { console.log('기록이 없다. tools/graph-append.mjs 로 먼저 쌓는다.'); process.exit(0); }
  if (!args.length) {
    console.error('사용법: node tools/graph-find.mjs <용어…>  |  --files <경로조각>  |  --with <경로조각>  |  --check  |  --promote [정본문서]');
    console.error(`현재 누적 ${recs.length}건`);
    process.exit(1);
  }
  const stale = (r) => (r.validTo ? `   ⚠️ 낡음 — ${r.validTo} 에 대체됨` : '');

  // ⭐ 승격 후보 — 반복 등장하는 용어는 정본 문서(spec-map 등)로 올려야 한다.
  if (args[0] === '--promote') {
    const doc = args[1];
    const docText = doc && existsSync(doc) ? readFileSync(doc, 'utf8') : null;
    const freq = new Map();
    for (const r of recs) {
      for (const k of termKeys(r)) {
        if (!freq.has(k)) freq.set(k, { n: 0, means: new Set() });
        const e = freq.get(k);
        e.n++;
        for (const [kk, v] of termPairs(r)) if (kk === k) e.means.add(v);
      }
    }
    const ranked = [...freq.entries()].sort((a, b) => b[1].n - a[1].n);
    const THRESHOLD = 3;
    const cand = ranked.filter(([k, e]) => e.n >= THRESHOLD && (!docText || !docText.includes(k)));

    console.log(`용어 ${ranked.length}종 (기록 ${recs.length}건)`);
    if (doc && !docText) console.log(`⚠️ 정본 문서를 못 찾았다: ${doc} — 중복 검사를 건너뛴다`);
    console.log(`\n── 승격 후보 (${THRESHOLD}회 이상${docText ? ' · 정본에 아직 없음' : ''}) ──`);
    if (!cand.length) console.log('  없다.');
    for (const [k, e] of cand) {
      console.log(`  ${e.n}회  ${k}${e.means.size ? `  → ${[...e.means][0]}` : '  ⚠️ 의미 미기록'}`);
    }
    console.log(`\n── 전체 빈도 (상위 12) ──`);
    for (const [k, e] of ranked.slice(0, 12)) {
      const inDoc = docText ? (docText.includes(k) ? '✅정본' : '  ') : '  ';
      console.log(`  ${String(e.n).padStart(2)}회 ${inDoc}  ${k}`);
    }
    process.exit(0);
  }

  if (args[0] === '--files') {
    const hits = findByFile(recs, args.slice(1).join(' '));
    if (!hits.length) { console.log(`「${args.slice(1).join(' ')}」를 만진 기록이 없다.`); process.exit(0); }
    console.log(`이 파일을 만진 요구 ${hits.length}건\n`);
    for (const r of hits) console.log(`  ${r.date}  ${r.req}${stale(r)}`);
    console.log(`\n⇒ 같이 움직이는 파일: node tools/graph-find.mjs --with ${args.slice(1).join(' ')}`);
    process.exit(0);
  }

  // ⭐ 2홉 — 「이 파일을 고치면 무엇이 같이 움직이나」
  if (args[0] === '--with') {
    const needle = args.slice(1).join(' ');
    if (!needle) { console.error('사용법: --with <경로조각>'); process.exit(1); }
    const { hits, co } = coChange(recs, needle);
    if (!hits.length) { console.log(`「${needle}」를 만진 기록이 없다.`); process.exit(0); }
    console.log(`「${needle}」를 만진 요구 ${hits.length}건에서 같이 움직인 파일\n`);
    if (!co.length) { console.log('  단독으로만 등장한다.'); process.exit(0); }
    // 1회뿐인 동반은 우연이다 — 반복된 것만 보여준다. 전부 보려면 --all.
    const all = args.includes('--all');
    const shown = all ? co : co.filter(([, e]) => e.n > 1);
    for (const [f, e] of (shown.length ? shown : co)) {
      const rate = Math.round((e.n / hits.length) * 100);
      console.log(`  ${String(e.n).padStart(2)}/${hits.length}  ${rate === 100 ? '⛔항상' : rate >= 60 ? '⭐자주' : '     '}  ${f}`);
    }
    const hidden = co.length - shown.length;
    if (!all && shown.length && hidden > 0) console.log(`  … 1회만 동반한 파일 ${hidden}개 생략 (--all 로 전부)`);
    const always = co.filter(([, e]) => e.n === hits.length);
    if (always.length) console.log(`\n⛔ 위 ⛔항상 표시는 예외 없이 같이 바뀐 파일이다 — 한쪽만 고치면 조용히 어긋난다.`);
    process.exit(0);
  }

  // 무결성 검증 — 문자열 참조로 잇는 구조의 유일한 약점을 시끄럽게 만든다.
  if (args[0] === '--check') {
    const { problems, gone, noRecorded, retro, stale, dupTerms } = check(recs, { fileExists: (f) => existsSync(f) });
    console.log(`기록 ${recs.length}건 · 대체 사슬 ${recs.filter((r) => r.supersedes).length}건\n`);
    console.log('── 사슬 무결성 ──');
    if (!problems.length) console.log('  이상 없음.');
    for (const [kind, msg] of problems) console.log(`  ⛔ ${kind}: ${msg}`);
    console.log('\n── 경로 무결성 (그래프가 코드보다 낡았나) ──');
    if (!gone.length) console.log(`  이상 없음 — 참조 경로 전부 존재.`);
    for (const [r, f] of gone) console.log(`  ⛔ 없는 경로  ${f}\n              ← ${r.date} ${r.req.slice(0, 44)}`);
    console.log('\n── 용어 선점 (낡은 값이 최신을 밀어내나) ──');
    console.log(`  중복 용어 ${dupTerms}개 중 과거가 1위인 것 ${stale.length}개`);
    for (const x of stale) {
      console.log(`  ⛔ 「${x.k}」 1위=${x.top.date} < 최신=${x.newest.date} (${x.n}개 기록)`);
      console.log(`       1위 : ${x.top.req.slice(0, 60)}`);
      console.log(`       최신 : ${x.newest.req.slice(0, 60)}`);
      console.log(`       ⇒ 1위 기록의 값이 낡았으면 supersedes 로 무효화하거나 그 용어 키를 뺀다`);
    }
    console.log('\n── 시간 ──');
    console.log(`  recorded 없음 ${noRecorded.length}건 (구 기록 — 순서는 줄 번호로 판정한다)`);
    console.log(`  소급 기록 ${retro.length}건 (date < recorded — 정상이다, 과거를 나중에 적은 것)`);
    process.exit(problems.length || gone.length || stale.length ? 1 : 0);
  }

  // 동점이면 살아있는 기록 먼저, 그다음 최신.
  // ⛔ 대체된 기록이 1위를 차지하면 새 세션이 낡은 값을 그대로 답한다 — --check 의 「용어 선점」은
  //    용어 키가 겹칠 때만 잡아서, 자유 검색어로 물으면 이 구멍으로 빠졌다(2026-09-08 실측).
  const ranked = recs.map((r) => ({ r, s: score(r, args) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s
      || (a.r.validTo ? 1 : 0) - (b.r.validTo ? 1 : 0)
      || String(b.r.date).localeCompare(String(a.r.date)));
  if (!ranked.length) {
    console.log(`「${args.join(' ')}」로 걸리는 과거 요구가 없다 (누적 ${recs.length}건).`);
    console.log('⇒ 새 영역이다. spec-map.md 어휘 다리와 trace.mjs 로 시작한다.');
    process.exit(0);
  }

  console.log(`유사 요구 ${ranked.length}건 (누적 ${recs.length}건 중)\n`);
  for (const { r, s } of ranked.slice(0, 5)) {
    console.log(`[점수 ${s}] ${r.date}  ${r.req}${stale(r)}`);
    const pairs = termPairs(r);
    if (pairs.length) for (const [k, v] of pairs) console.log(`  용어  ${k} → ${v}`);
    else if (termKeys(r).length) console.log(`  용어  ${termKeys(r).join(' · ')}`);
    for (const t of r.tables || []) console.log(`  DB    ${t}`);
    for (const f of r.files || []) console.log(`  파일  ${f}`);
    if (r.note) console.log(`  ⚠️ ${r.note}`);
    console.log();
  }

  // ⭐ 기능 이력 — 같은 용어가 여러 번 나오면 시간순으로 보여준다.
  //    「기능이 그 뒤에 수정됐나」가 가장 자주 필요한 질문이고, 최신 것부터 봐야 한다.
  for (const q of args) {
    const hist = recs
      .filter((r) => termKeys(r).some((k) => k.toLowerCase() === q.toLowerCase()))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (hist.length < 2) continue;
    console.log(`── 「${q}」 이력 ${hist.length}건 (최신순) ──`);
    hist.forEach((r, i) => {
      console.log(`  ${r.date}  ${i === 0 ? '⭐최신' : r.validTo ? '⚠️낡음' : '     '}  ${r.req}`);
      if (r.validTo) console.log(`            ↓ ${r.validTo} 에 대체됨: ${r.supersededBy.req.slice(0, 46)}`);
      if (r.supersedes) console.log(`            ↑ 이전을 대체: ${r.supersedes}`);
    });
    console.log('⚠️ 최신 것부터 본다 — 아래쪽은 그 뒤에 바뀌었을 수 있다.\n');
  }

  // 상위 결과의 파일 빈도 — 「이 주제는 늘 여기부터」를 보여준다.
  const freq = new Map();
  for (const { r } of ranked.slice(0, 5)) for (const f of r.files || []) freq.set(f, (freq.get(f) || 0) + 1);
  const hot = [...freq.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  if (hot.length) {
    console.log('── 반복 등장 파일 ──');
    for (const [f, n] of hot) console.log(`  ${n}회  ${f}`);
  }
}
