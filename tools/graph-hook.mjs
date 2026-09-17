#!/usr/bin/env node
// UserPromptSubmit 훅 — 질문이 들어올 때마다 graph-find 를 대신 돌려 과거 기록을 컨텍스트에 주입한다.
// ⭐ 탐색 1번 단계를 모델의 규율에 맡기지 않는 것이 목적이다.
import { load, scoreDetail, sup, tokenizeKo, tokenizeIds } from './graph-find.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// cwd 에 의존하지 않는다 — 훅은 어느 디렉터리에서 실행될지 보장이 없다
const STORE = join(dirname(fileURLToPath(import.meta.url)), 'graph', 'requests.jsonl');

const MAX = 2;   // 프롬프트마다 붙는 비용이므로 상위 2건만

// ⭐ 토크나이저(조사 떼기·공백 결합·어근·식별자)는 graph-find.mjs 의 tokenizeKo/tokenizeIds 다 — CLI 와 같은 것을 쓴다(2026-09-14 이동).

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  try { emit(JSON.parse(raw || '{}').prompt || ''); } catch { /* 실패는 조용히 통과 — 프롬프트를 막지 않는다 */ }
  process.exit(0);
});

function emit(prompt) {
  const ko = tokenizeKo(prompt);
  const ids = tokenizeIds(prompt);
  if (!ko.size && !ids.length) return;

  // 경로 가중은 scoreDetail() 안에 있다 — 훅과 CLI 가 같은 랭킹을 쓴다.
  // ⛔ 사무 기록(TODO 갱신)은 자동주입 대상이 아니다 — 실측 600질의에서 23회 1위를 차지해 도메인 정답을 밀어냈다.
  //    CLI graph-find 는 그대로 둔다 — 거기서는 사용자가 명시적으로 찾는 것이다.
  // ⛔ 대체된(supersedes 당한) 기록도 1단·2단 모두에서 뺀다 — 낡은 답을 현재 사실로 내보내던 구멍.
  //    실측 2026-09-10(티켓 600건): 1단 확신 453건 중 대체 기록이 1위 97건·상위2 186건(41%),
  //    아침에 대체시킨 기록 1건이 68회 1위로 나갔다. 제외 후 0·0, req 자기검색 103/106 불변.
  //    ⭐ 후속 기록이 반드시 있으므로 재현율 손실 0 (실측: orphan 0건).
  const all = load(STORE);
  const superseded = new Set(all.flatMap(sup));
  const recs = all.filter((r) => !BOOKKEEPING.test(r.req) && !superseded.has(r.req));
  const hits = recs.map((r) => ({ r, ...scoreDetail(r, [...ko, ...ids]) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s || (b.r.date || '').localeCompare(a.r.date || ''));

  // ⭐ 2단 — 확실히 걸리지 않았으면 압축 색인을 준다. 글자가 안 겹치는 표현은 1단이 못 잡는다
  //    (실측 2026-09-04: 패러프레이즈 질의 top-1 정답 2/7). 유사도 판단은 모델이 한다 — 임베딩이 필요 없다.
  //    ⛔ 놓쳤을 때만 낸다. 확실히 걸리면 1단만 나가므로 비용은 그대로다.
  // ⛔ 판정은 점수 합이 아니라 **신호의 종류**로 한다. 합계로 재면 「정확일치 1건」과
  //    「흔한 말이 세 군데 스침」이 똑같이 3점이라, 노이즈가 문턱을 넘어 색인을 막는다.
  //    실측 2026-09-04: 「조직 채널 해외」에서 정확일치 0인 기록 3건이 3점으로 1단을 발동시켰고,
  //    정작 답을 가진 기록(해외멀티브랜드, 2점)은 5위권 밖이라 모델이 볼 기회조차 없었다.
  // ⭐ 판별자는 「매칭 종류」가 아니라 「토큰이 변별력 있나」다. 파일명·식별자는 하나만 맞아도 확실하고,
  //    흔한 한글 낱말은 여러 군데 스쳐도 신호가 아니다.
  const top = hits[0];
  const idHit = top && ids.length > 0 && scoreDetail(top.r, ids).s > 0;
  const confident = top && (top.exact >= 1 || idHit || top.s >= 5);
  if (!confident) { fallbackIndex(recs, hits, [...ko, ...ids]); return; }

  // ⛔ 적중 경로에도 탈출구를 둔다 — 「걸렸다」가 「답이다」는 아니다. 광역 용어사전이 1위를 차지하는 일이
  //    흔해서(실측: 12개 기록이 적중의 71%), 탈출구가 없으면 관련만 있는 카드로 답을 지어낸다.
  // ⭐ 정본(req 가 「정본:」으로 시작)이 1위면 그 카드 하나가 답이다 — 2번째 카드를 붙이지 않는다.
  //    실측 2026-09-14: 절차 질의에서 정본 + 무관한 광역 용어사전 카드로 7,128자가 나갔다. 정본 카드는 그 자체가 절차라 길다.
  const take = /^정본:/.test(top.r.req) ? 1 : MAX;
  const out = [`[그래프 자동조회] 유사 기록 ${hits.length}건 — 상위 ${Math.min(take, hits.length)}건만 표시.`,
    `⚠️ 아래는 과거 작업에서 실측한 것이다. 함정과 「용어 → 실체」 매핑 둘 다 근거로 쓴다 — 추측으로 대체하지 않는다.`,
    `⛔ 값이 「제거됨」·「바뀜」으로 시작하면 그게 답이다. 코드에 안 보인다고 「모름」이라 하지 않는다.`,
    `⭐ 다만 위 기록이 이 질문에 답하지 않으면 그렇다고 말하고 평소대로 코드를 탐색한다 — 걸린 것이 답이라는 뜻은 아니다.`];
  for (const { r, s } of hits.slice(0, take)) {
    out.push(`· [${kindOf(r)} · ${s}점] ${r.date} ${r.req}`);
    // ⭐ 함정을 맨 앞에 둔다 — 카드 끝에 두면 묻혀서 모델이 추측으로 답한다(2026-09-04 실측)
    if (r.note) out.push(`    ⚠️ 함정: ${r.note}`);
    const { hit, rest } = splitTerms(r, [...ko, ...ids]);
    for (const [k, v] of hit) out.push(`    ${k} → ${v}`);
    if (rest.length) out.push(`    … 이 질의와 안 걸린 항목 ${rest.length}개(키만): ${rest.map(([k]) => k).join(' · ')}`);
    for (const f of (r.files || []).slice(0, 6)) out.push(`    ${f}`);
  }
  out.push(...openWork(recs, [...ko, ...ids], hits.slice(0, take).map((h) => h.r)));
  out.push(`더 볼 것: node tools/graph-find.mjs <어근>  (어근은 짧게, 여러 개)`);
  console.log(out.join('\n'));
}

// ⭐ 카드 **안에서도** 고른다 — 항목 단위 선택이 없어 카드 한 장의 항목 46%가 질의와 무관하게 나갔다
//    (실측 2026-09-16, 확신 카드 441장: 평균 항목 14.5개 중 걸린 것 7.9개. 글자로는 35%).
// ⛔ 잘라내지 않는다. 안 걸린 항목에 정답이 있을 수 있고 그 비율은 라벨이 없어 측정 못 했다 — **키만 남긴다.**
//    모델이 필요하면 그 키로 graph-find 를 판다. 하나도 안 걸리면 전부 낸다(질의가 req·파일·함정으로만 맞은 경우).
// ⛔ 이 판정을 **기록 선택에 되먹이지 않는다** — 그 순간 채점 변경이고, 이 저장소에서 채점 변경은 6/6 회귀했다.
function splitTerms(rec, toks) {
  const pairs = Object.entries(Array.isArray(rec.terms) ? {} : rec.terms || {});
  const hit = [], rest = [];
  for (const [k, v] of pairs) {
    const nk = k.toLowerCase().replace(/\s+/g, '');
    const text = (k + ' ' + v).toLowerCase();
    const on = toks.some((t) => t.toLowerCase().replace(/\s+/g, '') === nk || text.includes(t.toLowerCase()));
    (on ? hit : rest).push([k, v]);
  }
  return hit.length ? { hit, rest } : { hit: pairs, rest: [] };
}

// ⭐ 종류는 **제목에서 파생**한다 — 저장 필드를 만들지 않는다(살아있는 기록의 88%가 이 규칙으로 갈린다, 실측 2026-09-16).
//    카드에 종류가 안 보여서 「이게 필요한 지식인지 작업 이력인지 구분이 안 된다」는 지적이 나왔다(사용자, 2026-09-16).
// ⛔ 종류에 점수를 주지 않는다 — 표시 전용이다.
const KINDS = [
  ['절차', /^정본:/],
  ['사전', /^용어 사전:|^용어 학습:|^공백 채움:|어휘 다리/],
  ['원문', /^Dooray 원문|가이드문서|인수인계|연혁/],
  ['폐기', /기각|철거|폐기|걷어|원복|중단|미실행|제거(했|됨|\b)|삭제했/],
  ['도구', /^그래프|훅|도구|템플릿|미러|측정|스크립트|graph-|tools\//],
  ['조사', /조사|확정|실측|분석|검증|교차검증|진단|점검|감사/],
  ['이력', /수정|추가|구현|반영|적용|변경|개선|신설|분리|이관|통합/],
];
function kindOf(rec) {
  for (const [k, re] of KINDS) if (re.test(rec.req)) return k;
  return '기타';
}

// ⛔ 열린 작업(보류·미구현·중단)은 랭킹으로 닿지 않는다 — 광역 정본이 도메인 낱말을 독점한다.
//    실측 2026-09-15: 「설계까지 해두고 사용자 지시로 멈춘」 보류 기록이 **그 작업을 재개하는 요청**에서 10위였다.
//    훅은 1~2건, CLI 는 5건만 보여주므로 닿을 방법이 없었고, 기록이 있는데 못 꺼내 세션 로그를 3분 36초 뒤졌다.
// ⭐ 그래서 점수가 아니라 **상태**로 붙인다 — 순위 밖이어도 정확일치 1개면 낸다. 랭킹은 건드리지 않는다
//    (AGENTS.md §4: 채점 변형 4종은 자기검색을 무너뜨려 전부 기각됐다).
// ⛔ 표식은 `⏸` 하나로만 본다. 낱말(미구현·보류)로 넓히면 3건 중 2건이 오탐이었다(실측 2026-09-15) —
//    「미구현 제안」처럼 절차는 끝났는데 곁가지가 안 된 정본, 스키마 제안이 보류된 메타 기록이 딸려 온다.
//    ⭐ 표식을 빠뜨리면 조용히 무력해지므로 `graph-find --check` 가 「표식 누락」으로 잡는다.
// ⛔ 게이트는 점수다. 용어 정확일치(exact>=1)로 재 봤더니 **놓쳤던 바로 그 사례를 못 잡았다**(실측 2026-09-15:
//    exact 0 · 점수 11) — 보류 기록의 용어 키는 대개 긴 복합어라 사람이 쓴 프롬프트와 정확히 겹칠 일이 없다.
// ⭐ 문턱 5 는 훅의 확신 판정과 같은 숫자다(위 confident). 놓쳤던 프롬프트가 11점이라 여유가 있고,
//    소음은 티켓 제목 605건 중 3.0% · 실제 typed 프롬프트 240건 중 12.5%다(열린 작업 2건 기준).
// ⛔ `note` 의 **맨 앞**만 본다 — 본문 어디서나 찾으면 이 규약을 설명하는 기록이 스스로 걸린다(2026-09-15 실측).
const OPEN_MIN = 5;
export const isOpen = (r) => (r.note || '').startsWith('⏸');
function openWork(recs, toks, shown = []) {
  const open = recs.filter((r) => !shown.includes(r) && isOpen(r) && scoreDetail(r, toks).s >= OPEN_MIN);
  if (!open.length) return [];
  const out = [`⏸ 열린 작업 ${open.length}건 — 이 주제에 **하다 만 기록**이 있다. 다시 조사하기 전에 이것부터 편다.`];
  for (const r of open) {
    out.push(`  ⏸ ${r.date} ${r.req}`);
    // ⭐ 앞머리만 준다 — 「어디까지 했고 왜 멈췄나」가 note 앞에 온다. 나머지는 모델이 graph-find 로 판다.
    if (r.note) out.push(`     ⚠️ ${r.note.slice(0, 240)}${r.note.length > 240 ? ' …(전문: graph-find)' : ''}`);
  }
  return out;
}

const INDEX_CAP = 150;   // 색인은 선형으로 자란다. 이 선을 넘으면 최근 것만 준다
const BOOKKEEPING = /^TODO 갱신|^TODO:/;
const FALLBACK_MIN = 2;  // 최고점수가 이 값 이하면 색인도 내지 않는다 (근거는 fallbackIndex 주석)

// 2단 — 제목 + 용어만의 압축 색인. 모델이 의미로 고르고, 상세는 graph-find 로 스스로 판다.
// ⭐ 용어를 같이 줘야 맞는다 — 제목만 주면 그럴듯한 이웃을 고른다(실측: 제목만 0/2 → 용어 포함 2/2).
// ⛔ 점수로 자르지 않는다 — 폴백의 존재 이유가 「점수가 못 잡은 것」이라 같은 점수로 재면 정답을 버린다.
//    실측 2026-09-09: 덤프 질의당 128건 중 중앙 98건이 점수 0 이고, 상위 40 컷은 그것을 통째로 날린다.
// ⛔ 신호가 약하면 색인도 내지 않는다. 실측 2026-09-09 — 실제 타이핑 프롬프트 192건에서 s<=2 로
//    침묵되는 23건이 전부 진행 발화(「계속 진행」류)이거나 그래프에 답이 없는 질의(식별자가 기록에 0건·
//    스택트레이스)였다. 평균 주입 5,823→4,526자(-22%), 적중 137건 불변.
//    ⛔ s<=3 으로 내리지 않는다 — 그래프에 답이 있는 업무 질의가 침묵된다.
//    ⚠️ 이 문턱은 **티켓 제목이 아니라 typed 프롬프트**로 재야 한다 — 분포가 달라 판정이 뒤집힌다.
function fallbackIndex(recs, hits, toks) {
  if (!hits.length || hits[0].s <= FALLBACK_MIN) return;
  // ⭐ recs 는 이미 사무 기록·대체 기록이 빠진 풀이다(emit 상단) — 색인 -30% 는 그 필터의 효과
  const use = recs.slice(-INDEX_CAP);
  const lines = use.map((r) => {
    const keys = Array.isArray(r.terms) ? r.terms : Object.keys(r.terms || {});
    return `${r.date} ${r.req}${keys.length ? `  [용어: ${keys.join(', ')}]` : ''}`;
  });
  const head = hits.length
    ? `[그래프 자동조회] 키워드로는 약하게만 걸렸다(최고 점수 ${hits[0].s}). 아래 색인에서 의미가 맞는 것을 직접 고른다.`
    : `[그래프 자동조회] 키워드로는 못 찾았다. 아래 색인에서 의미가 맞는 것이 있는지 본다.`;
  console.log([
    head,
    `⛔ 억지로 고르지 않는다 — 관련 없으면 색인을 무시하고 평소대로 코드를 탐색한다.`,
    `⭐ 맞는 항목이 보이면 그 용어로 상세를 판다: node tools/graph-find.mjs <용어>`,
    `⭐ 사용자가 쓴 표현이 아래 용어에 없으면, 알아낸 뒤 그 표현을 용어 키로 기록한다: node tools/graph-alias.mjs <표현> "<실체>"`,
    ...openWork(recs, toks),
    ...lines,
  ].join('\n'));
}
