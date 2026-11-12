// Unit test for the answer's Markdown block grammar (lib/ask/md-blocks.ts).
// Run: npx -y tsx scripts/test-md-blocks.mts
import assert from 'node:assert/strict';
import { parseBlocks, splitRow } from '../lib/ask/md-blocks';

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log(`ok ${name}`); };

t('plain prose stays paragraphs, single newlines kept', () => {
  const b = parseBlocks('First line\nsecond line\n\nNext para.');
  assert.deepEqual(b, [{ type: 'p', text: 'First line\nsecond line' }, { type: 'p', text: 'Next para.' }]);
});

t('bold header lines stay paragraphs (old answers render as before)', () => {
  const b = parseBlocks('**What happened**\nFour banks moved [signal S3].');
  assert.equal(b.length, 1);
  assert.equal(b[0].type, 'p');
});

t('table with citations and alignment', () => {
  const md = 'Intro.\n\n| Bank | Move | Source |\n|:---|---|---:|\n| JPMorgan | Agent pilot | [signal S1] |\n| Wells Fargo | Agreement | [item I4] |\n\nAfter.';
  const b = parseBlocks(md);
  assert.equal(b.length, 3);
  const tb = b[1];
  assert.equal(tb.type, 'table');
  if (tb.type !== 'table') return;
  assert.deepEqual(tb.head, ['Bank', 'Move', 'Source']);
  assert.deepEqual(tb.align, ['left', null, 'right']);
  assert.deepEqual(tb.rows[1], ['Wells Fargo', 'Agreement', '[item I4]']);
});

t('ragged rows pad or trim to the header width', () => {
  const b = parseBlocks('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |');
  assert.equal(b[0].type, 'table');
  if (b[0].type !== 'table') return;
  assert.deepEqual(b[0].rows, [['1', ''], ['1', '2']]);
});

t('a header row before its separator streams in as a paragraph', () => {
  const b = parseBlocks('| Bank | Move |');
  assert.deepEqual(b, [{ type: 'p', text: '| Bank | Move |' }]);
});

t('escaped pipe stays in the cell', () => {
  assert.deepEqual(splitRow('| a \\| b | c |'), ['a | b', 'c']);
});

t('bullets, numbers, continuation lines', () => {
  const b = parseBlocks('- one\n- two\n  more of two\n\n1. first\n2. second');
  assert.deepEqual(b[0], { type: 'ul', items: ['one', 'two\nmore of two'] });
  assert.deepEqual(b[1], { type: 'ol', items: ['first', 'second'], start: 1 });
});

t('headings and rules', () => {
  const b = parseBlocks('## Memo\nTo: the team\n\n---\n### Next');
  assert.deepEqual(b[0], { type: 'h', level: 2, text: 'Memo' });
  assert.deepEqual(b[1], { type: 'p', text: 'To: the team' });
  assert.deepEqual(b[2], { type: 'hr' });
  assert.deepEqual(b[3], { type: 'h', level: 3, text: 'Next' });
});

t('raw html stays literal text', () => {
  const b = parseBlocks('<script>alert(1)</script>');
  assert.deepEqual(b, [{ type: 'p', text: '<script>alert(1)</script>' }]);
});

t('a dash inside prose is not a list or rule', () => {
  const b = parseBlocks('Costs fell - sharply - in Q3.');
  assert.equal(b[0].type, 'p');
});

console.log(`\n${n} passed`);
