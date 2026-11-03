// The maintenance exception is deliberately one named branch and one Stable line.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ghJSON } from './release-lookup.mjs';

export const maintenanceBranch = 'release/desktop-1.7';
export function validateSource(branch, version) {
  if (branch === 'main') return;
  assert.equal(branch, maintenanceBranch, 'Only main or the approved 1.7 maintenance branch is qualified');
  assert(/^1\.7\.(?:0|[1-9]\d*)$/.test(version || '') && Number(version.split('.')[2]) >= 3,
    'Maintenance builds must be Stable 1.7.3 or newer within 1.7.x');
}

export function validateMaintenanceRules(rules) {
  assert(Array.isArray(rules), 'Effective branch rules required');
  for (const type of ['deletion', 'non_fast_forward', 'pull_request']) {
    assert(rules.some(rule => rule.type === type), `Maintenance branch lacks ${type} protection`);
  }
  assert(rules.some(rule => rule.type === 'required_status_checks' &&
    rule.parameters?.required_status_checks?.some(check => check.context === 'repo-shape')),
    'Maintenance branch must require repo-shape');
}

export function verifySourceProtection(repo, branch, version, request = ghJSON) {
  validateSource(branch, version);
  if (branch === maintenanceBranch) {
    validateMaintenanceRules(request('api', `repos/${repo}/rules/branches/${encodeURIComponent(branch)}`));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [repo, branch, version] = process.argv.slice(2);
  assert(/^[\w.-]+\/[\w.-]+$/.test(repo || ''), 'Repository required');
  verifySourceProtection(repo, branch, version);
  console.log(`Qualified release source ${branch} for ${version}`);
}
