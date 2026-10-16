import { writeFileSync } from 'node:fs';
import { parseItemList, countItems } from '../src/core/itemList.js';

const BASE = 'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted';

async function download(file) {
  const response = await fetch(`${BASE}/${file}`);
  if (!response.ok) throw new Error(`Could not download ${file} (${response.status} ${response.statusText})`);
  return (await response.text()).split('\n');
}

function write(file, value) {
  writeFileSync(new URL(`../src/core/${file}`, import.meta.url), `export default ${JSON.stringify(value)};\n`);
}

const items = parseItemList((await download('items.txt')).join('\n'));
write('itemIndex.js', items);

const maps = {};
for (const line of await download('world.txt')) {
  const match = /^\s*(\d+):\s*(.+?)\s*$/.exec(line);
  if (match) maps[match[1]] = match[2];
}
write('mapNames.js', maps);

console.log(`Wrote ${countItems(items)} items and ${Object.keys(maps).length} maps.`);
