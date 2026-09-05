#!/usr/bin/env node
// requests.jsonl 을 사람이 읽는 HTML 한 장으로 굽는다.
// ⭐ 데이터를 HTML 에 박지 않고 매번 굽는다 — 박으면 append 할 때마다 낡는다.
//   node tools/graph-view.mjs [출력경로]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE = join(HERE, 'graph', 'requests.jsonl');
const OUT = process.argv[2] || join(HERE, 'graph', 'view.html');

if (!existsSync(STORE)) {
  console.log(`기록이 없다: ${STORE}\ntools/graph-append.mjs 로 먼저 쌓는다.`);
  process.exit(0);
}

const recs = readFileSync(STORE, 'utf8').split('\n').filter((l) => l.trim())
  .flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } })
  .sort((a, b) => String(b.date).localeCompare(String(a.date)));

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c]);
const pairs = (r) => (Array.isArray(r.terms) ? (r.terms || []).map((k) => [k, '']) : Object.entries(r.terms || {}));
const ext = (f) => (f.match(/\.([a-z]+)$/i)?.[1] || '·').toLowerCase();

// 요구↔파일 이분 그래프의 차수 — 「이 주제는 늘 여기부터」
const fileFreq = new Map();
for (const r of recs) for (const f of r.files || []) fileFreq.set(f, (fileFreq.get(f) || 0) + 1);
const hot = [...fileFreq.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const maxHot = Math.max(1, ...hot.map(([, n]) => n));

const termFreq = new Map();
for (const r of recs) for (const [k] of pairs(r)) termFreq.set(k, (termFreq.get(k) || 0) + 1);

const dates = recs.map((r) => r.date).filter(Boolean).sort();
const tableCount = new Set(recs.flatMap((r) => r.tables || [])).size;

function card(r, i) {
  const sup = r.supersedes ? recs.find((x) => x.req === r.supersedes) : null;
  const hay = [r.req, ...pairs(r).flat(), ...(r.files || []), ...(r.tables || []), r.note || ''].join(' ').toLowerCase();
  const parts = [];
  parts.push('<header class="rec-hd"><time datetime="' + e(r.date) + '">' + e(r.date) + '</time><h3>' + e(r.req) + '</h3></header>');
  if (pairs(r).length) {
    parts.push('<dl class="terms">' + pairs(r).map(([k, v]) =>
      '<dt>' + e(k) + '</dt><dd>' + (v ? e(v) : '<span class="unset">의미 미기록</span>') + '</dd>').join('') + '</dl>');
  }
  if ((r.tables || []).length) {
    parts.push('<ul class="chips">' + r.tables.map((t) => '<li class="chip">' + e(t) + '</li>').join('') + '</ul>');
  }
  if ((r.files || []).length) {
    parts.push('<ul class="files">' + r.files.map((f) =>
      '<li><button type="button" class="fpath" data-f="' + e(f) + '"><span class="ext">' + e(ext(f)) + '</span>' + e(f) + '</button></li>').join('') + '</ul>');
  }
  if (r.note) parts.push('<p class="note">' + e(r.note) + '</p>');
  if (sup) parts.push('<p class="sup">대체 <a href="#r' + recs.indexOf(sup) + '">' + e(sup.date) + ' ' + e(sup.req) + '</a></p>');
  else if (r.supersedes) parts.push('<p class="sup orphan">대체 ' + e(r.supersedes) + ' <span class="unset">(기록 없음)</span></p>');
  return '<article class="rec' + (r.supersedes ? ' chained' : '') + '" data-hay="' + e(hay) + '" id="r' + i + '">'
    + parts.join('') + '</article>';
}

const DARK_TOKENS = `
  --ink:#e6ebf3; --ink-2:#b8c3d4; --muted:#8d9aad; --faint:#6b7789;
  --paper:#101620; --card:#182231; --line:#28344a; --line-2:#1f2a3b;
  --navy:#7ea6d9; --navy-soft:#1c2b42; --warn:#d99a4e; --warn-bg:#2a2114;
  --shadow:0 1px 2px rgba(0,0,0,.3);`;

const html = `<title>APMS 요구 그래프</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600&family=IBM+Plex+Serif:wght@500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{
  --ink:#16202e; --ink-2:#33415a; --muted:#5f6b7c; --faint:#8b95a5;
  --paper:#f7f8fa; --card:#ffffff; --line:#dfe4ec; --line-2:#eef1f6;
  --navy:#274773; --navy-soft:#e3ebf6; --warn:#8a4f18; --warn-bg:#fdf4e7;
  --shadow:0 1px 2px rgba(22,32,46,.06);
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK_TOKENS}}}
:root[data-theme="dark"]{${DARK_TOKENS}}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);
  font:400 15px/1.65 "IBM Plex Sans KR","Malgun Gothic",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1060px;margin:0 auto;padding:40px 24px 72px;display:flex;flex-direction:column;gap:30px}
h1,h2,h3{font-family:"IBM Plex Serif","Noto Serif KR",Georgia,serif;text-wrap:balance;margin:0}
h1{font-size:29px;font-weight:600;letter-spacing:-.01em}
.lede{color:var(--muted);max-width:64ch;margin:7px 0 0;font-size:14px}
code{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,monospace;font-size:.88em;color:var(--navy)}

.stats{display:flex;flex-wrap:wrap;gap:0;margin:0;border:1px solid var(--line);border-radius:6px;
  background:var(--card);box-shadow:var(--shadow);overflow:hidden}
.stats div{flex:1 1 110px;padding:11px 16px;border-right:1px solid var(--line-2)}
.stats div:last-child{border-right:0;flex:1 1 200px}
.stats dt{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)}
.stats dd{margin:2px 0 0;font:500 21px/1.25 "IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
.stats .span-dates dd{font-size:14px;letter-spacing:-.01em}

.tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
#q{flex:1 1 280px;min-width:0;padding:9px 12px;border:1px solid var(--line);border-radius:5px;
  background:var(--card);color:var(--ink);font:inherit}
#q::placeholder{color:var(--faint)}
#q:focus-visible{outline:2px solid var(--navy);outline-offset:1px;border-color:var(--navy)}
#clear{padding:9px 14px;border:1px solid var(--line);border-radius:5px;background:var(--card);
  color:var(--ink-2);font:500 13px/1.2 inherit;cursor:pointer}
#clear:hover{border-color:var(--navy);color:var(--navy)}
#clear:focus-visible{outline:2px solid var(--navy);outline-offset:1px}
#count{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}

.panel{border:1px solid var(--line);border-radius:6px;background:var(--card);box-shadow:var(--shadow);padding:17px 20px}
.panel h2{font-family:"IBM Plex Sans KR",system-ui,sans-serif;font-size:14px;font-weight:600;letter-spacing:.01em}
.panel .hint{color:var(--muted);font-size:12.5px;margin:4px 0 14px}
.bars{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}
.bars button{display:grid;grid-template-columns:2rem 1fr;gap:10px;align-items:center;width:100%;
  padding:3px 5px;border:0;border-radius:4px;background:none;color:inherit;cursor:pointer;text-align:left}
.bars button:hover,.bars button:focus-visible{background:var(--navy-soft);outline:none}
.bars .n{font:500 12px/1 "IBM Plex Mono",ui-monospace,monospace;color:var(--navy);
  font-variant-numeric:tabular-nums;text-align:right}
.bars .track{position:relative;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12.5px;
  color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:3px 6px}
.bars .track::before{content:"";position:absolute;inset:0 auto 0 0;width:var(--w);
  background:var(--navy-soft);border-radius:3px}
.bars .track span{position:relative}

.terms-index{columns:2 230px;column-gap:28px;margin:0;padding:0;list-style:none;font-size:13px}
.terms-index li{break-inside:avoid;display:flex;gap:9px;padding:2px 0;color:var(--ink-2)}
.terms-index .n{font:500 11px/1.65 "IBM Plex Mono",ui-monospace,monospace;color:var(--faint);min-width:1.2rem;text-align:right}

.spine{display:flex;flex-direction:column;gap:13px}
.rec{border:1px solid var(--line);border-radius:6px;background:var(--card);padding:17px 20px;
  box-shadow:var(--shadow);display:flex;flex-direction:column;gap:11px}
.rec.chained{border-left:3px solid var(--navy)}
.rec[hidden]{display:none!important}
.rec-hd{display:flex;flex-wrap:wrap;gap:3px 14px;align-items:baseline}
.rec-hd time{font:500 12px/1.7 "IBM Plex Mono",ui-monospace,monospace;color:var(--navy);
  font-variant-numeric:tabular-nums}
.rec-hd h3{font-size:16.5px;font-weight:600;flex:1 1 100%;line-height:1.4}
.terms{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:3px 14px;margin:0;font-size:13.5px}
.terms dt{font-weight:500;color:var(--ink)}
.terms dt::after{content:" →";color:var(--faint);font-weight:400}
.terms dd{margin:0;color:var(--ink-2);min-width:0}
.unset{color:var(--faint);font-style:italic}
.chips{display:flex;flex-wrap:wrap;gap:5px;margin:0;padding:0;list-style:none}
.chip{font:500 11.5px/1.4 "IBM Plex Mono",ui-monospace,monospace;padding:3px 7px;border-radius:3px;
  background:var(--navy-soft);color:var(--navy)}
.files{display:flex;flex-direction:column;gap:1px;margin:0;padding:0;list-style:none}
.fpath{display:flex;gap:9px;align-items:baseline;width:100%;padding:2px 5px;border:0;border-radius:3px;
  background:none;cursor:pointer;text-align:left;overflow-wrap:anywhere;
  font:400 12.5px/1.6 "IBM Plex Mono",ui-monospace,monospace;color:var(--ink-2)}
.fpath:hover,.fpath:focus-visible{background:var(--navy-soft);color:var(--navy);outline:none}
.fpath .ext{flex:0 0 3.2rem;color:var(--faint);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em}
.note{margin:0;padding:9px 12px;border-radius:4px;background:var(--warn-bg);color:var(--warn);font-size:13px}
.note::before{content:"함정 ";font-weight:600}
.sup{margin:0;font-size:12.5px;color:var(--muted)}
.sup::before{content:"↑ ";color:var(--navy)}
.sup a{color:var(--ink-2);text-decoration:underline;text-decoration-color:var(--line)}
.sup a:hover{color:var(--navy)}
.sup.orphan{color:var(--faint)}
footer{color:var(--faint);font-size:12.5px;border-top:1px solid var(--line);padding-top:16px;
  display:flex;flex-wrap:wrap;gap:4px 18px}
</style>

<div class="wrap">
<header>
  <h1>APMS 요구 그래프</h1>
  <p class="lede">현업 요구를 그때 만진 파일·용어·함정에 이어 붙인 기록. <code>tools/graph/requests.jsonl</code> 에서 매번 굽는다 —
  이 페이지에 데이터가 박혀 있지 않으니 <code>graph-append</code> 뒤에 다시 구우면 최신이다.</p>
</header>

<dl class="stats">
  <div><dt>기록</dt><dd>${recs.length}</dd></div>
  <div><dt>용어</dt><dd>${termFreq.size}</dd></div>
  <div><dt>파일</dt><dd>${fileFreq.size}</dd></div>
  <div><dt>테이블</dt><dd>${tableCount}</dd></div>
  <div class="span-dates"><dt>기간</dt><dd>${e(dates[0] || '?')} → ${e(dates[dates.length - 1] || '?')}</dd></div>
</dl>

<div class="tools">
  <input id="q" type="search" placeholder="요구·용어·파일·함정 전체 검색 — 어근을 짧게" autocomplete="off">
  <button type="button" id="clear">전체</button>
  <span id="count"></span>
</div>

<section class="panel">
  <h2>반복 등장 파일</h2>
  <p class="hint">요구 2건 이상이 만진 파일. 누르면 그 파일을 만진 요구만 남는다 — <code>graph-find --files</code> 와 같다.</p>
  <ul class="bars">${hot.map(([f, n]) => '<li><button type="button" class="fpath-bar" data-f="' + e(f) + '">'
    + '<span class="n">' + n + '</span><span class="track" style="--w:' + Math.round((n / maxHot) * 100) + '%"><span>'
    + e(f) + '</span></span></button></li>').join('')}</ul>
</section>

<section class="panel">
  <h2>어휘 다리 색인</h2>
  <p class="hint">현업 용어 ${termFreq.size}종. 코드·URL·뷰 이름은 전부 영문이라 한글로 grep 하면 0건이다 — 여기서 먼저 옮긴다.</p>
  <ul class="terms-index">${[...termFreq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => '<li><span class="n">' + n + '</span><span>' + e(k) + '</span></li>').join('')}</ul>
</section>

<section class="spine" id="spine">${recs.map(card).join('')}</section>

<footer>
  <span>다시 굽기 <code>node tools/graph-view.mjs</code></span>
  <span>검색 <code>node tools/graph-find.mjs &lt;어근&gt;</code></span>
  <span>기록 <code>node tools/graph-append.mjs</code></span>
</footer>
</div>

<script>
var q = document.getElementById('q');
var cnt = document.getElementById('count');
var recs = Array.prototype.slice.call(document.querySelectorAll('.rec'));

function apply(term) {
  var t = term.trim().toLowerCase();
  var n = 0;
  for (var i = 0; i < recs.length; i++) {
    var hit = !t || recs[i].dataset.hay.indexOf(t) >= 0;
    recs[i].hidden = !hit;
    if (hit) n++;
  }
  cnt.textContent = t ? n + ' / ' + recs.length + '건' : recs.length + '건';
}

q.addEventListener('input', function () { apply(q.value); });
document.getElementById('clear').addEventListener('click', function () {
  q.value = ''; apply(''); q.focus();
});
document.addEventListener('click', function (ev) {
  var b = ev.target.closest ? ev.target.closest('.fpath, .fpath-bar') : null;
  if (!b) return;
  q.value = b.dataset.f;
  apply(q.value);
  document.getElementById('spine').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
apply('');
</script>
`;

writeFileSync(OUT, html, 'utf8');
console.log('구웠다: ' + OUT + '  (기록 ' + recs.length + ' · 용어 ' + termFreq.size + ' · 파일 ' + fileFreq.size + ')');
