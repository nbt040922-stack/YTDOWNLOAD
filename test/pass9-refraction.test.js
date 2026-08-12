const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('static SVG displacement filters refract search and cards', () => {
  const html = source('index.html');
  const map = source('resources/refraction-map.svg');
  assert.match(html, /id="searchRefraction"[\s\S]*?<feDisplacementMap[^>]*scale="18"/);
  assert.match(html, /id="cardRefraction"[\s\S]*?<feDisplacementMap[^>]*scale="11"/);
  assert.match(map, /linearGradient id="x"/);
  assert.match(map, /linearGradient id="y"/);
  assert.doesNotMatch(html + map, /feTurbulence|animate/i);
});

test('refraction stays behind sharp content and limits card cost', () => {
  const css = source('style.css');
  assert.match(css, /\.search-input, \.download-btn \{ position: relative; z-index: 1; \}/);
  assert.match(css, /\.download-card > \* \{ position: relative; z-index: 1; \}/);
  assert.match(css, /\.download-card:nth-child\(-n\+8\)::before/);
  assert.match(css, /@supports \(filter: url\("#searchRefraction"\)\)/);
  assert.match(css, /@supports \(filter: url\("#cardRefraction"\)\)/);
});
