import test from 'node:test';
import assert from 'node:assert/strict';
import { maintenanceBranch, validateSource, validateMaintenanceRules, verifySourceProtection } from './release-source.mjs';

const rules = [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'pull_request' },
  { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'repo-shape' }] } }];
test('maintenance exception cannot build Beta, a different line or an old Stable', () => {
  validateSource('main', '1.8.0-beta.1');
  validateSource(maintenanceBranch, '1.7.3');
  validateSource(maintenanceBranch, '1.7.42');
  for (const version of ['1.7.2', '1.7.3-beta.1', '1.8.0', '1.7.03', '1.7.3+test', undefined]) {
    assert.throws(() => validateSource(maintenanceBranch, version));
  }
  assert.throws(() => validateSource('release/desktop-1.8', '1.8.0'));
  assert.throws(() => validateSource('codex/unreviewed', '1.7.3'));
});
test('effective maintenance protections fail closed', () => {
  validateMaintenanceRules(rules);
  for (let i = 0; i < rules.length; i++) assert.throws(() => validateMaintenanceRules(rules.filter((_, j) => j !== i)));
  assert.throws(() => verifySourceProtection('doughknee/myscrollr', maintenanceBranch, '1.7.3', () => { throw Error('HTTP 403'); }), /403/);
  let endpoint;
  verifySourceProtection('doughknee/myscrollr', maintenanceBranch, '1.7.3', (_, value) => { endpoint = value; return rules; });
  assert.equal(endpoint, 'repos/doughknee/myscrollr/rules/branches/release%2Fdesktop-1.7');
});
