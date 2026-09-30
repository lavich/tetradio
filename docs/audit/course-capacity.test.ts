// Audit-only probe. Copy into tests/ of a Tavelori checkout at the pinned revision and run: npx vitest run tests/course-capacity.test.ts
import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { encodeSnapshot, decodeSnapshot } from '../src/sync/codec';
import { splitParts } from '../src/sync/adapter';
import { CLOUD_LIMITS } from '../src/sync/transport';
import { emptyStats } from '../src/domain/skills';
import { unitKey } from '../src/domain/refs';
import type { CompactSnapshot } from '../src/sync/types';

it('measures a full-course envelope, not a production format implementation', () => {
  const at = '2026-09-30T09:00:00.000Z';
  const results = [];
  for (const total of [1860, 3720]) {
    const refs = Array.from({length: total}, (_, i) => ({kind: i % 5 === 0 ? 'phrase' as const : 'word' as const, id: `greek-a2-card-${String(i).padStart(5, '0')}`}));
    const snapshot: CompactSnapshot = {
      format: 2, createdAt: at, settings: {timezone: 'Asia/Nicosia', sessionSize: 20},
      courses: [], lessons: [], packages: [],
      states: refs.map(ref => ({ref, card: {...createEmptyCard(new Date(at)), due: at, last_review: at, stability: 12.3456789, difficulty: 5.4321, reps: 40}, introducedAt: at, version: 40})),
      skills: refs.map(ref => ({ref, skills: {lastTypes: ['spelling','listening'], cleanAssemblies: 4, types: Object.fromEntries(['recognition','assembly','spelling','listening','comprehension'].map(t => [t,{recent:Array(10).fill(true),lastAt:at}]))}})),
      stats: {...emptyStats(), answeredKeys: refs.map(unitKey)},
    };
    const encoded = encodeSnapshot(snapshot);
    expect(decodeSnapshot(encoded)).toEqual(snapshot);
    // Candidate extension: 144 lessons, 12 completed blocks and four skill tasks each.
    // This measures JSON overhead; it is deliberately NOT fed to the old decoder.
    const extension = Array.from({length:144}, (_,i) => ({
      lessonId:`greek-a2-lesson-${i}`, contentVersion:'abcdef123456',
      completedBlocks:Array.from({length:12},(_,j)=>`block-${j}`),
      completedAt:at, revision:20,
      practice:['reading','listening','writing','speaking'].map(skill=>({taskId:`task-${i}-${skill}`,skill,attempts:10,lastAt:at,selfAssessment:3})),
    }));
    const candidate=JSON.stringify({...JSON.parse(encoded),f:3,courseProgress:extension});
    const parts=splitParts(candidate).length;
    const keys=parts*3+2;
    results.push({cards:total,lessons:144,skillTasks:576,chars:candidate.length,baseChars:encoded.length,baseParts:splitParts(encoded).length,parts,keysWithThreeVersionsAndTwoPointers:keys,maxKeys:CLOUD_LIMITS.maxKeys});
  }
  writeFileSync('/tmp/greek-tavelori-capacity.json',JSON.stringify(results,null,2)+'\n');
});
