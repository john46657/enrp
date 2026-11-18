const test = require('node:test');
const assert = require('node:assert');
const { runWithGrant, hasPlatformGrant } = require('../src/lib/platformGrant');
const { isStaff } = require('../src/lib/util');

function member(id) {
  return { id, guild: { id: '1' }, roles: { cache: new Map() }, permissions: { has: () => false } };
}

test('Plattform-Freigabe gilt nur für die Person und nur während des Befehls', async () => {
  const me = member('42');
  assert.equal(isStaff(me), false);
  await runWithGrant('42', async () => {
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(hasPlatformGrant(me), true);
    assert.equal(isStaff(me), true);
    assert.equal(isStaff(member('43')), false);
  });
  assert.equal(isStaff(me), false);
});
