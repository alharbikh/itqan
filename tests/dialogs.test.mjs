import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = ['admin', 'link', 'performance', 'personnel-admin'];
const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');

test('shared confirmation dialog is styled only with CSP-compatible external CSS', () => {
  for (const selector of ['.itqan-confirm-dialog', '.itqan-confirm-message',
    '.itqan-confirm-actions', '.itqan-confirm-button', '.itqan-confirm-accept',
    '.itqan-confirm-input']) {
    assert.ok(css.includes(selector), 'missing confirmation CSS: ' + selector);
  }
  for (const file of files) {
    const source = readFileSync(new URL('../public/' + file + '.js', import.meta.url), 'utf8');
    assert.match(source, /dialog\.className='itqan-confirm-dialog'/,
      file + ' must use the shared dialog class');
    assert.doesNotMatch(source, /\.style\.cssText\s*=/,
      file + ' must not depend on CSP-blocked inline styling');
    assert.doesNotMatch(source, /(?:window\.)?(?:alert|confirm|prompt)\s*\(/,
      file + ' must not use blocking browser dialogs');
    assert.match(source, /dialog\.addEventListener\('cancel'/,
      file + ' must support keyboard dismissal');
    assert.match(source, /dialog\.addEventListener\('close'/,
      file + ' must resolve dismissal safely');
  }
});

test('Cloudflare CSP keeps inline styles disabled for application pages', () => {
  const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.match(worker, /style-src 'self'/);
  assert.doesNotMatch(worker, /style-src[^;\n]*'unsafe-inline'/);
});
