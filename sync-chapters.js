#!/usr/bin/env node
/**
 * sync-chapters.js
 * ─────────────────────────────────────────────────────────
 * admin.html(TS편집 탭)에서 저장한 타임스탬프(구글시트, GAS ts_get)를
 * chapters-data.js 파일에 병합(patch)합니다.
 *
 * 무엇을 하는가:
 *  1. chapters-data.js를 읽어 각 챕터(id)를 찾는다.
 *  2. 각 챕터마다 GAS에 ts_get 요청 → 저장된 [{idx, ts, text}, ...] 를 받는다.
 *     (idx는 그 챕터의 "암송(r:true) 줄"만 순서대로 센 인덱스 — admin.html과 동일한 규칙)
 *  3. chapters-data.js 원본 텍스트에서 각 챕터의 r:true 줄을 순서대로 세면서,
 *     idx가 일치하는 줄의 ts 숫자만 정확히 교체한다.
 *     (텍스트/구조/포맷은 전혀 건드리지 않고 ts 숫자만 바꾸므로 안전함)
 *  4. 결과를 저장하고, 무엇이 바뀌었는지 요약을 출력한다.
 *
 * 사용법:
 *   node sync-chapters.js [chapters-data.js 경로] [GAS URL]
 *
 *   예) node sync-chapters.js ./chapters-data.js
 *   예) node sync-chapters.js ./chapters-data.js https://script.google.com/macros/s/AKfycb.../exec
 *
 * 주의:
 *  - GAS의 ts_get은 공개 읽기라 로그인 없이 호출 가능합니다.
 *  - 원본 파일은 <경로>.bak 으로 백업된 후 덮어써집니다.
 *  - 실행 후에는 git diff로 실제 바뀐 ts 값들을 확인하고 커밋/푸시하세요.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_GAS_URL =
  'https://script.google.com/macros/s/AKfycbzGFkegiqWgRYUZEWzbHi5NHzAMMqWl-8bimKnhmUhfjV1q3L2NvhZJxR0n4zUMYimE/exec';

async function main() {
  const filePath = process.argv[2] || path.join(__dirname, 'chapters-data.js');
  const gasUrl = process.argv[3] || DEFAULT_GAS_URL;

  if (!fs.existsSync(filePath)) {
    console.error(`❌ 파일을 찾을 수 없습니다: ${filePath}`);
    process.exit(1);
  }

  const original = fs.readFileSync(filePath, 'utf8');

  // 1) 챕터 id 목록 추출 (예: "{ id:1, num:'1장', ..." )
  const chapterIds = [...original.matchAll(/\{\s*id:(\d+)\s*,/g)].map(m => Number(m[1]));
  if (!chapterIds.length) {
    console.error('❌ CHAPTERS 배열에서 챕터 id를 찾지 못했습니다. 파일 형식을 확인하세요.');
    process.exit(1);
  }
  console.log(`📚 발견된 챕터: ${chapterIds.join(', ')}`);

  // 2) 각 챕터별로 GAS에서 저장된 타임스탬프 조회
  const tsMapByChapter = {}; // { chId: { idx: ts } }
  for (const chId of chapterIds) {
    try {
      const res = await fetch(`${gasUrl}?act=ts_get&chId=${chId}`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.timestamps) && data.timestamps.length) {
        const map = {};
        data.timestamps.forEach(t => { map[t.idx] = t.ts; });
        tsMapByChapter[chId] = map;
        console.log(`  ✓ 챕터 ${chId}: 저장된 타임스탬프 ${data.timestamps.length}개 로드`);
      } else {
        console.log(`  · 챕터 ${chId}: 저장된 값 없음 (건너뜀)`);
      }
    } catch (e) {
      console.warn(`  ⚠ 챕터 ${chId}: 조회 실패 - ${e.message}`);
    }
  }

  // 3) 원본 텍스트를 줄 단위로 순회하며 r:true 줄의 ts 값만 교체
  const lines = original.split('\n');
  let curChId = null;
  let reciteIdx = -1; // 현재 챕터 내 r:true 줄 카운터
  let changedCount = 0;
  const changeLog = [];

  const chapterHeaderRe = /\{\s*id:(\d+)\s*,/;
  // 예: {t:`...`,r:true,ts:12.3},  또는  {t:`...`,r:false},
  const lineObjRe = /^(\s*\{t:`.*`,r:)(true|false)(,ts:(-?\d+(?:\.\d+)?))?(\}\s*,?\s*)$/;

  const patched = lines.map(line => {
    const headerMatch = line.match(chapterHeaderRe);
    if (headerMatch) {
      curChId = Number(headerMatch[1]);
      reciteIdx = -1;
      return line; // 헤더 줄 자체는 그대로
    }

    const m = line.match(lineObjRe);
    if (!m) return line; // 대사 줄이 아니면 그대로 둠

    const isRecite = m[2] === 'true';
    if (!isRecite) return line; // r:false 줄은 ts 대상 아님, 카운터도 증가 안 함

    reciteIdx++;

    const map = curChId != null ? tsMapByChapter[curChId] : undefined;
    if (!map || !(reciteIdx in map)) return line; // 시트에 해당 idx 저장값 없으면 원본 유지

    const oldTsStr = m[4];
    const newTs = map[reciteIdx];
    const oldTs = oldTsStr !== undefined ? Number(oldTsStr) : undefined;

    if (oldTs === newTs) return line; // 변화 없음

    changedCount++;
    changeLog.push(`  ch${curChId} #${reciteIdx}: ${oldTs ?? '(없음)'} → ${newTs}`);

    const prefix = m[1]; // "  {t:`...`,r:"
    const closing = m[5]; // "}," 또는 "}"
    return `${prefix}true,ts:${newTs}${closing}`;
  });

  if (!changedCount) {
    console.log('\n✅ 변경 사항 없음 — chapters-data.js는 이미 최신 상태입니다.');
    return;
  }

  // 4) 백업 후 저장
  const backupPath = filePath + '.bak';
  fs.writeFileSync(backupPath, original, 'utf8');
  fs.writeFileSync(filePath, patched.join('\n'), 'utf8');

  console.log(`\n✏️  ${changedCount}개 타임스탬프 변경:`);
  console.log(changeLog.join('\n'));
  console.log(`\n💾 저장 완료: ${filePath}`);
  console.log(`🗄️  원본 백업: ${backupPath}`);
  console.log('\n다음 단계: git diff로 확인 후 커밋/푸시 하세요.');
}

main().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
