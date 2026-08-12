const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('URL and queue surfaces use responsive capsule geometry', () => {
  const css = source('style.css');
  assert.match(css, /\.search-bar \{[^}]*min-height: 68px;[^}]*border-radius: 999px;[^}]*align-items: center;/);
  assert.match(css, /\.search-input \{[^}]*height: 40px;[^}]*margin: 0;[^}]*padding: 0;[^}]*line-height: 40px;/);
  assert.match(css, /\.download-card \{[^}]*min-height: 72px;[^}]*border-radius: 999px;/);
  assert.match(css, /\.card-content \{[^}]*justify-content: center;/);
  assert.match(css, /\.progress-container \{[^}]*height: 3px;[^}]*border-radius: 999px;/);
});

test('compact controls use fixed flex-centered geometry without old offsets', () => {
  const html = source('index.html');
  const css = source('style.css');
  assert.match(css, /\.download-btn \{[^}]*width: 40px;[^}]*height: 40px;[^}]*flex: 0 0 40px;[^}]*margin: 0;[^}]*padding: 0;[^}]*align-items: center;[^}]*justify-content: center;/);
  assert.match(css, /\.action-btn \{[^}]*width: 34px;[^}]*height: 34px;[^}]*flex: 0 0 34px;[^}]*padding: 0;[^}]*align-items: center;[^}]*justify-content: center;/);
  assert.match(css, /#downloadIcon \{ transform: translateY\(-1px\); \}/);
  assert.doesNotMatch(html + css, /mt-\[-4px\]|search-action|quality-badge|refraction/i);
});
