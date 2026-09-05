#!/usr/bin/env node
// 대화 중에 알아낸 「사용자가 쓰는 말 → 시스템의 실체」를 한 줄로 기록한다.
// ⭐ 작업이 끝나기를 기다리지 않는다 — 용어는 대화 중에 드러나고, 그때 안 적으면 사라진다.
//
//   node tools/graph-alias.mjs 재무지표 "목표수립 화면의 태블로 embed — tableau_fin_url (org_conf_info 컬럼)"
//   node tools/graph-alias.mjs 태블로캡처 "위와 같은 것" --file src/main/resources/project.properties
//   node tools/graph-alias.mjs 반려 "reject_flag (goal_step_info_new)" --note "국내/해외 짝이 있다"
//
// ⛔ 별도 저장소를 만들지 않는다. 보통 기록과 같은 줄로 들어가므로 조회·색인이 그대로 먹는다.
import { appendRecord } from './graph-append.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const STORE = join(dirname(fileURLToPath(import.meta.url)), 'graph', 'requests.jsonl');

const argv = process.argv.slice(2);
const positional = [];
const files = [];
let note = '';

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--file') files.push(argv[++i]);
  else if (argv[i] === '--note') note = argv[++i];
  else positional.push(argv[i]);
}

const [term, means] = positional;
if (!term || !means) {
  console.error('사용법: node tools/graph-alias.mjs <사용자가 쓰는 말> "<시스템에서 무엇인가>" [--file 경로]… [--note 함정]');
  console.error('⭐ 키는 사용자의 말, 값은 시스템의 실체다. 반대로 적으면 다음에 못 찾는다.');
  process.exit(1);
}

const out = appendRecord({
  req: `용어 학습: ${term} — ${means.slice(0, 60)}`,
  terms: { [term]: means },
  files,
  ...(note ? { note } : {}),
}, { store: STORE });

console.log(`+ ${out.date}  ${term} → ${means}`);
console.log(`확인: node tools/graph-find.mjs ${term}`);
