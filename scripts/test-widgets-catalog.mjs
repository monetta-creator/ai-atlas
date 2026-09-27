// Tests for the widget catalog (lib/widgets/catalog.ts, migration 0075): the
// two boards' defaults name real widgets on the right board, the public lobby
// default carries no admin widget, and every widget a board claims has a
// component in that board's registry (checked against the registry SOURCE,
// since the .tsx registries import '@/...' paths plain Node cannot load).
// READ-ONLY, no DB. Run: node scripts/test-widgets-catalog.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WIDGET_CATALOG, DEFAULT_BOARD_WIDGETS, BOARDS, catalogFor, isWidgetOnBoard, widgetMeta, isBoard,
} from '../lib/widgets/catalog.ts';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

const REGISTRY = {
  home: readFileSync(new URL('../components/lobby/widgets/registry.tsx', import.meta.url), 'utf8'),
  ops: readFileSync(new URL('../components/ops/widgets/registry.tsx', import.meta.url), 'utf8'),
};

console.log('widget catalog:');

check('widget keys are unique', () => {
  const keys = WIDGET_CATALOG.map((w) => w.key);
  assert.equal(new Set(keys).size, keys.length);
});

check('every widget sits on at least one board', () => {
  for (const w of WIDGET_CATALOG) assert.ok(w.boards.length > 0, w.key);
});

for (const board of BOARDS) {
  check(`${board}: every default key exists and is on the board`, () => {
    const defaults = DEFAULT_BOARD_WIDGETS[board];
    assert.ok(defaults.length > 0);
    for (const k of defaults) {
      assert.ok(widgetMeta(k), `unknown widget ${k}`);
      assert.ok(isWidgetOnBoard(k, board), `${k} not on ${board}`);
    }
    assert.equal(new Set(defaults).size, defaults.length, 'duplicate default');
  });

  check(`${board}: every widget on the board has a registry component`, () => {
    for (const w of catalogFor(board)) {
      // atlas-stats is shared: the ops registry may borrow the lobby component.
      const src = REGISTRY[board] + (board === 'ops' ? REGISTRY.home : '');
      assert.ok(src.includes(`'${w.key}'`), `${w.key} missing from the ${board} registry`);
    }
  });
}

check('the lobby default carries no admin widget', () => {
  for (const k of DEFAULT_BOARD_WIDGETS.home) assert.equal(widgetMeta(k).access, 'public', k);
});

check('retired tile-* keys are not on any board', () => {
  for (const board of BOARDS) assert.equal(isWidgetOnBoard('tile-signals', board), false);
});

check('isBoard guards the action input', () => {
  assert.equal(isBoard('home'), true);
  assert.equal(isBoard('ops'), true);
  assert.equal(isBoard('admin'), false);
  assert.equal(isBoard(null), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
