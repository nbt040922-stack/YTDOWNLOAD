const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('settings and download-folder persistence remain wired', () => {
  const main = source('main.js');
  assert.match(main, /settings\.json/);
  assert.match(main, /saveSettings\(\{ savePath: newPath \}\)/);
  assert.match(main, /getSettings\(\)\.savePath/);
});

test('URL input contains only textarea and aligned download action', () => {
  const html = source('index.html');
  const css = source('style.css');
  const search = html.match(/<div class="search-bar">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] || '';
  assert.match(search, /id="urlInput"/);
  assert.match(search, /id="downloadBtn"/);
  assert.doesNotMatch(search, /btnLoginURL|fa-user-circle/);
  assert.match(css, /\.download-btn \{[^}]*width: 34px;[^}]*height: 34px;[^}]*align-items: center;[^}]*justify-content: center;/);
  assert.match(css, /#downloadIcon \{ transform: translateY\(-1px\); \}/);
});

test('main screen folder pill remains absent', () => {
  const html = source('index.html');
  assert.doesNotMatch(html, /storagePicker|storage-bar|currentPath/);
});
