#!/usr/bin/env node
// UserPromptSubmit 훅 — 질문이 들어올 때마다 graph-find 를 대신 돌려 과거 기록을 컨텍스트에 주입한다.
// ⭐ 탐색 1번 단계를 모델의 규율에 맡기지 않는 것이 목적이다.
import { load, scoreDetail, STOP } from './graph-find.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// cwd 에 의존하지 않는다 — 훅은 어느 디렉터리에서 실행될지 보장이 없다
const STORE = join(dirname(fileURLToPath(import.meta.url)), 'graph', 'requests.jsonl');

const MAX = 2;   // 프롬프트마다 붙는 비용이므로 상위 2건만

// ⛔ 조사를 떼지 않으면 「재무지표가」라 용어 정확일치(+3)가 영영 안 걸린다(2026-09-04 실측).
// ⭐ 원형과 어근을 둘 다 넣는다 — 「태블로」처럼 끝이 조사를 닮은 말을 잘못 떼도 손해가 없다.
const JOSA = /(으로|에서|부터|까지|에게|한테|이나|라도|는|은|를|을|가|이|의|에|도|만|과|와|랑|로|나)$/;
function addTok(set, t) {
  if (t.length >= 2 && !STOP.has(t)) set.add(t);
  const bare = t.replace(JOSA, '');
  if (bare !== t && bare.length >= 2 && !STOP.has(bare)) set.add(bare);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  try { emit(JSON.parse(raw || '{}').prompt || ''); } catch { /* 실패는 조용히 통과 — 프롬프트를 막지 않는다 */ }
  process.exit(0);
});

function emit(prompt) {
  const ko = new Set();
  // ⛔ [가-힣]{2,} 만 쓰면 숫자·영문이 섞인 말이 통째로 사라진다 — 1단·2단·EAP2·BY2627·3R·SKU수
  //    (2026-09-05 실측: 「1단과 2단」 질의에서 두 단어가 0토큰이 됐다).
  //    숫자·영문이 붙은 덩어리를 먼저 뽑고, 순수 한글도 따로 뽑는다.
  for (const raw of prompt.match(/[0-9A-Za-z]+[가-힣]+|[가-힣]+[0-9A-Za-z]+[가-힣]*/g) || []) addTok(ko, raw);
  for (const raw of prompt.match(/[가-힣]{2,}/g) || []) addTok(ko, raw);
  // ⭐ 공백만 다른 형태 — 「목표 수립」과 「목표수립」은 같은 말이다.
  //    규칙으로 만들 수 있으니 저장 쪽을 늘리지 않고 질의에서 만든다. 색인 비용 0.
  for (const phrase of prompt.split(/[^가-힣\s]+/)) {
    const parts = phrase.trim().split(/\s+/).filter((w) => /^[가-힣]{2,}$/.test(w));
    for (let i = 0; i < parts.length; i++) {
      for (let n = 2; n <= 3 && i + n <= parts.length; n++) {
        const joined = parts.slice(i, i + n).join('');
        if (joined.length <= 12) addTok(ko, joined);
      }
    }
  }
  // ⭐ 어근을 같이 넣는다 — 부분일치라 「문의하기」는 「문의처」에 안 걸린다
  for (const t of [...ko]) if (t.length >= 3 && !STOP.has(t.slice(0, 2))) ko.add(t.slice(0, 2));
  // ⭐ 파일명·식별자는 한글 토큰에 안 걸리고 score() 의 건초더미에도 파일 경로가 없다 — 경로는 따로 본다
  // ⛔ 길이 5 이상만 받으면 ESG·SAP·EAP 같은 3글자 약어가 통째로 사라진다(2026-09-05 실측: ESG 질의가 0토큰).
  //    대문자 약어는 2자부터, 소문자 섞인 일반 단어는 5자부터 — 흔한 영어 낱말이 노이즈가 되는 건 막는다.
  const ids = [...new Set([
    ...(prompt.match(/\b[A-Z][A-Z0-9]{1,}\b/g) || []),                       // 대문자 약어 ESG · SAP · EAP2
    ...(prompt.match(/[A-Za-z_][A-Za-z0-9_.\-]{3,}/g) || []).filter((t) => t.length >= 5),
  ])];
  if (!ko.size && !ids.length) return;

  // 경로 가중은 scoreDetail() 안에 있다 — 훅과 CLI 가 같은 랭킹을 쓴다.
  const recs = load(STORE);
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
  if (!confident) { fallbackIndex(recs, hits); return; }

  const out = [`[그래프 자동조회] 유사 기록 ${hits.length}건 — 상위 ${Math.min(MAX, hits.length)}건만 표시.`,
    `⚠️ 아래는 과거 작업에서 실측한 것이다. 함정과 「용어 → 실체」 매핑 둘 다 근거로 쓴다 — 추측으로 대체하지 않는다.`,
    `⛔ 값이 「제거됨」·「바뀜」으로 시작하면 그게 답이다. 코드에 안 보인다고 「모름」이라 하지 않는다.`];
  for (const { r, s } of hits.slice(0, MAX)) {
    out.push(`· [${s}] ${r.date} ${r.req}`);
    // ⭐ 함정을 맨 앞에 둔다 — 카드 끝에 두면 묻혀서 모델이 추측으로 답한다(2026-09-04 실측)
    if (r.note) out.push(`    ⚠️ 함정: ${r.note}`);
    for (const [k, v] of Object.entries(Array.isArray(r.terms) ? {} : r.terms || {})) out.push(`    ${k} → ${v}`);
    for (const f of (r.files || []).slice(0, 6)) out.push(`    ${f}`);
  }
  out.push(`더 볼 것: node tools/graph-find.mjs <어근>  (어근은 짧게, 여러 개)`);
  console.log(out.join('\n'));
}

const INDEX_CAP = 150;   // 색인은 선형으로 자란다. 이 선을 넘으면 최근 것만 준다

// 2단 — 제목 + 용어만의 압축 색인. 모델이 의미로 고르고, 상세는 graph-find 로 스스로 판다.
// ⭐ 용어를 같이 줘야 맞는다 — 제목만 주면 그럴듯한 이웃을 고른다(실측: 제목만 0/2 → 용어 포함 2/2).
function fallbackIndex(recs, hits) {
  if (!recs.length) return;
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
    ...lines,
  ].join('\n'));
}
