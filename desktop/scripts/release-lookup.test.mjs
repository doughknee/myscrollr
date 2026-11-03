import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readReleaseByTag, readTagCommit, validateDraftSource } from './release-lookup.mjs';

const repo = 'doughknee/myscrollr', tag = 'desktop-v1.8.0-beta.1';
const draft = { id: 12, tag_name: tag, draft: true, target_commitish: 'a'.repeat(40), assets: [] };
test('absent draft tag is checked through exact Git ref, not commits API 422', () => {
  assert.equal(readTagCommit(repo, tag, (...args) => {
    assert(args.at(-1).includes('/git/ref/tags/')); throw new Error('HTTP 404');
  }), null);
  for (const status of ['HTTP 403', 'HTTP 422', 'HTTP 500']) {
    assert.throws(() => readTagCommit(repo, tag, () => { throw new Error(status); }), new RegExp(status));
  }
});
test('existing annotated tag is resolved to its commit', () => {
  assert.equal(readTagCommit(repo, tag, (...args) => args.at(-1).includes('/git/ref/')
    ? { ref: `refs/tags/${tag}`, object: { type: 'tag', sha: 'b'.repeat(40) } }
    : { sha: 'a'.repeat(40) }), 'a'.repeat(40));
});
test('a discovered draft may only be rebuilt from its exact source', () => {
  validateDraftSource(draft, 'a'.repeat(40));
  assert.throws(() => validateDraftSource(draft, 'b'.repeat(40)));
  assert.throws(() => validateDraftSource(draft, 'main'));
  validateDraftSource(null, 'a'.repeat(40));
});
test('published lookup returns its exact release without listing', () => {
  let calls = 0;
  const actual = readReleaseByTag(repo, tag, () => { calls++; return { ...draft, draft: false }; });
  assert.equal(calls, 1); assert.equal(actual.draft, false);
});
test('draft without a public tag is found across pages and re-read by ID', () => {
  const calls = [];
  const actual = readReleaseByTag(repo, tag, (...args) => {
    calls.push(args);
    if (args.at(-1).includes('/tags/')) throw new Error('HTTP 404');
    if (args.includes('--paginate')) return [[{ ...draft, id: 11, tag_name: 'unrelated' }], [draft]];
    assert.equal(args.at(-1), `repos/${repo}/releases/12`); return draft;
  });
  assert.equal(actual, draft); assert.equal(calls.length, 3);
});
test('missing release requires a successful authenticated listing', () => {
  assert.equal(readReleaseByTag(repo, tag, (...args) => {
    if (args.includes('--paginate')) return [[]]; throw new Error('HTTP 404');
  }), null);
});
test('authentication, server and list failures do not become missing releases', () => {
  for (const status of ['HTTP 401', 'HTTP 403', 'HTTP 500', 'timeout']) {
    assert.throws(() => readReleaseByTag(repo, tag, () => { throw new Error(status); }), new RegExp(status));
    assert.throws(() => readReleaseByTag(repo, tag, (...args) => { throw new Error(args.includes('--paginate') ? status : 'HTTP 404'); }), new RegExp(status));
  }
});
test('renamed release and ambiguous draft records fail closed', () => {
  assert.throws(() => readReleaseByTag(repo, tag, () => ({ ...draft, tag_name: 'other' })));
  assert.throws(() => readReleaseByTag(repo, tag, (...args) => {
    if (args.includes('--paginate')) return [[draft, draft]]; throw new Error('HTTP 404');
  }));
});
