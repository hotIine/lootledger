// Chest log dates are MM/DD/YYYY in UTC.
import { itemKey } from './items.js';

const DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/;

export function parseChestLog(text, pasteIndex) {
  const pages = [];
  const errors = [];
  let page = null;
  text.split(/\r?\n/).forEach((line, index) => {
    const fields = splitFields(line);
    if (fields.length === 0) return;
    if (isHeader(fields)) { page = null; return; }
    const row = toRow(fields, `paste${pasteIndex}#${index + 1}`);
    if (!row) {
      errors.push(`Paste ${pasteIndex + 1}, line ${index + 1}: could not read "${line.trim().slice(0, 60)}"`);
      return;
    }
    if (!page) { page = []; pages.push(page); }
    page.push(row);
  });
  return { pages, errors };
}

function splitFields(line) {
  if (line.trim() === '') return [];
  if (line.includes('"')) return [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim());
  return line.split('\t').map((field) => field.trim());
}

function isHeader(fields) {
  return fields.length >= 6 && Number.isNaN(parseChestDate(fields[0])) && Number.isNaN(Number(fields[5]));
}

function toRow(fields, id) {
  if (fields.length < 6) return null;
  const [date, player, itemName, enchantText, qualityText, amountText] = fields;
  const time = parseChestDate(date);
  const enchant = Number(enchantText);
  const amount = Number(amountText);
  if (Number.isNaN(time) || !player || !itemName || !Number.isInteger(enchant) || !Number.isInteger(amount)) {
    return null;
  }
  return {
    id, time, player, itemName, enchant, amount,
    quality: Number(qualityText) || 0,
    key: itemKey(itemName, enchant),
    signature: fields.join('|'),
  };
}

export function selectDeposits(parsedPastes, windowStart) {
  const deposits = [];
  const excluded = [];
  for (const { row, isDuplicate } of flagDuplicates(parsedPastes)) {
    const reason = exclusionReason(row, isDuplicate, windowStart);
    if (reason) excluded.push({ row, reason });
    else deposits.push(row);
  }
  return { deposits, excluded };
}

function exclusionReason(row, isDuplicate, windowStart) {
  if (isDuplicate) return 'duplicate';
  if (row.amount < 0) return 'withdrawal';
  if (row.time < windowStart) return 'before-fight';
  return null;
}

function flagDuplicates(parsedPastes) {
  const earlierRows = new Map();
  const flagged = [];
  for (const { pages } of parsedPastes) {
    const pasteRows = flagPaste(pages, earlierRows);
    pasteRows.filter((r) => !r.isDuplicate).forEach(({ row }) => {
      earlierRows.set(row.signature, (earlierRows.get(row.signature) ?? 0) + 1);
    });
    flagged.push(...pasteRows);
  }
  return flagged;
}

function flagPaste(pages, earlierRows) {
  const remaining = new Map(earlierRows);
  const seenPages = new Set();
  const rows = [];
  let previousPage = [];
  for (const page of pages) {
    const pageSignature = page.map((row) => row.signature).join('\n');
    const isDuplicatePage = seenPages.has(pageSignature);
    seenPages.add(pageSignature);
    const slid = isDuplicatePage ? 0 : overlap(previousPage, page);
    page.forEach((row, index) => {
      const earlierCount = remaining.get(row.signature) ?? 0;
      if (earlierCount > 0) remaining.set(row.signature, earlierCount - 1);
      rows.push({ row, isDuplicate: isDuplicatePage || index < slid || earlierCount > 0 });
    });
    if (!isDuplicatePage) previousPage = page;
  }
  return rows;
}

// Deposits made while copying push rows down, so a page can start with the
// previous page's last rows.
function overlap(previous, page) {
  for (let k = Math.min(previous.length, page.length); k > 0; k--) {
    const tail = previous.slice(-k);
    if (tail.every((row, i) => row.signature === page[i].signature)) return k;
  }
  return 0;
}

export function parseChestDate(value) {
  const match = DATE_PATTERN.exec(value ?? '');
  if (!match) return NaN;
  const [, month, day, year, hour, minute, second] = match.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}
