import assert from 'node:assert/strict';
import test from 'node:test';
import { isSslVerificationDisabled } from './haHttp';

test('VERIFY_SSL=false (any case) disables verification', () => {
  assert.equal(isSslVerificationDisabled({ VERIFY_SSL: 'False' }), true);
  assert.equal(isSslVerificationDisabled({ VERIFY_SSL: 'false' }), true);
  assert.equal(isSslVerificationDisabled({ VERIFY_SSL: 'FALSE' }), true);
});

test('unset or other VERIFY_SSL values keep verification enabled', () => {
  assert.equal(isSslVerificationDisabled({}), false);
  assert.equal(isSslVerificationDisabled({ VERIFY_SSL: 'true' }), false);
  assert.equal(isSslVerificationDisabled({ VERIFY_SSL: 'True' }), false);
  assert.equal(isSslVerificationDisabled({ VERIFY_SSL: '' }), false);
  assert.equal(isSslVerificationDisabled({ VERIFY_SSL: '0' }), false);
});

test('defaults to process.env', () => {
  const previous = process.env.VERIFY_SSL;
  try {
    process.env.VERIFY_SSL = 'False';
    assert.equal(isSslVerificationDisabled(), true);
    delete process.env.VERIFY_SSL;
    assert.equal(isSslVerificationDisabled(), false);
  } finally {
    if (previous === undefined) delete process.env.VERIFY_SSL;
    else process.env.VERIFY_SSL = previous;
  }
});
