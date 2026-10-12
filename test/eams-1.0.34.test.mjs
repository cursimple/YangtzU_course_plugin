import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../plugin-packages/yangtzeu-eams/main.js', import.meta.url), 'utf8');
const plugin = await import(
  'data:text/javascript;base64,' +
  Buffer.from(source + '\nexport {matchesSemester};').toString('base64'),
);

test('matchesSemester keeps packets of the current semester', () => {
  assert.equal(plugin.matchesSemester('semester.id=42&ids=student-b', '42'), true);
  assert.equal(plugin.matchesSemester('semester.id=42&ids=student-a', '42'), true);
  assert.equal(plugin.matchesSemester('semester.id=41&ids=student-a', '42'), false);
});

test('matchesSemester falls back to keeping when the semester is unreadable', () => {
  assert.equal(plugin.matchesSemester('', '42'), true);
  assert.equal(plugin.matchesSemester('ids=student-a', '42'), true);
});

test('1.0.34 restored: no leftover minor curriculum logic', () => {
  // 确保还原干净：去年 10 月引入的「辅修停手」「matchesCourseAccount」「frontendHtml」都不应再出现
  assert.equal(/hasMultipleCourseTabs/.test(source), false);
  assert.equal(/matchesCourseAccount/.test(source), false);
  assert.equal(/frontendHtml/.test(source), false);
});
