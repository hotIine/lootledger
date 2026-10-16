import { playerItems } from '../core/summary.js';
import { itemLabel, itemTier, itemType } from '../core/items.js';
import { isSamePickup } from '../core/reconcile.js';
import { esc, formatClock, formatSilver, iconUrl, plural } from './format.js';

const OUTCOMES = {
  held: { tint: 'owed', text: () => 'still owes' },
  extra: { tint: 'extra', text: () => 'deposited, but no loot log shows them picking it up' },
  deposited: { tint: 'chest', text: depositedText },
  'deposited-by-other': { tint: 'chest', text: (g) => (g.units[0]?.takenFromBody
    ? `died with it; ${g.detail} picked it up from the body and deposited it` : `passed on to ${g.detail}, who deposited it`) },
  resolved: { tint: 'chest', text: () => 'marked resolved' },
  transferred: { tint: 'moved', text: (g) => `reassigned to ${g.detail}` },
  recovered: { tint: 'died', text: (g) => `died with it, ${g.detail} picked it up` },
  lost: { tint: 'died', text: (g) => `died with it, ${g.detail} (${g.isDetailTagged ? 'enemy' : 'unknown guild'}) took it` },
  dropped: { tint: 'died', text: () => 'died with it, nobody in the logs picked it up' },
};
const ORDER = Object.keys(OUTCOMES);

function depositedText(g) {
  const unit = g.units[0];
  if (!unit || unit.pickedBy === unit.holder) return 'deposited';
  return unit.takenFromBody
    ? `${unit.pickedBy} looted it and died with it; ${unit.holder} took it from the body and deposited it`
    : `passed on by ${unit.pickedBy}, deposited by ${unit.holder}`;
}

// keep a half-typed reassign name across live redraws
let drawnSelection = '';

export function renderResults(result, session, view) {
  const typing = document.querySelector('[data-reassign-input]');
  const kept = typing && view.selected === drawnSelection
    ? { value: typing.value, isFocused: document.activeElement === typing } : null;
  drawResults(result, session, view);
  drawnSelection = view.selected;
  const input = document.querySelector('[data-reassign-input]');
  if (input && kept) {
    input.value = kept.value;
    if (kept.isFocused) input.focus();
  }
}

function drawResults(result, session, view) {
  const notices = noticeBlock(result, view);
  if (session.lootFiles.length === 0) {
    document.getElementById('results').innerHTML = notices;
    return;
  }
  const sections = result.players.map((p) => playerSection(p, result, view)).filter(Boolean);
  document.getElementById('results').innerHTML = [notices,
    sections.length ? sections.join('') : '<p class="counts">No items match these filters.</p>',
    changes(session, result), excluded(result.chest.excluded),
    `<datalist id="player-names">${result.players.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>`].join('');
}

function noticeBlock(result, view) {
  const errors = result.errors.map((e) => `<li>${esc(e)}</li>`).join('');
  return (view.notice ? `<p class="notice">${esc(view.notice)}</p>` : '')
    + (errors ? `<ul class="errors">${errors}</ul>` : '');
}

function matchesFilters(outcome, itemId, filters) {
  const allows = (set, value) => set.size === 0 || set.has(value);
  return allows(filters.status, OUTCOMES[outcome].tint)
    && allows(filters.tier, String(itemTier(itemId)))
    && allows(filters.type, itemType(itemId));
}

function itemGroups(p, result, filters) {
  return playerItems(result.units, result.excess, p.name)
    .map((g) => ({ ...g, itemId: g.units[0]?.itemId ?? result.itemIdFor(g.itemName, g.enchant),
      isDetailTagged: Boolean(result.affiliations.get(g.detail)?.guild) }))
    .filter((g) => matchesFilters(g.outcome, g.itemId, filters))
    .sort((a, b) => ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome) || b.value - a.value);
}

function playerCard(p, groups, view, extra = '') {
  const owed = groups.filter((g) => g.outcome === 'held');
  const qty = owed.reduce((sum, g) => sum + g.qty, 0);
  const value = owed.reduce((sum, g) => sum + g.value, 0);
  const settled = p.outstanding.qty ? '' : '<span class="settled">nothing owed</span>';
  const owes = qty ? `<span class="owes">owes ${plural(qty, 'item')}${value ? `, ${formatSilver(value)}` : ''}</span>` : settled;
  const looted = p.pickedUp.value ? `<span class="looted">looted ${formatSilver(p.pickedUp.value)}</span>` : '';
  return `<h3><span class="name">${esc(p.name)}</span> ${p.guild ? `(${esc(p.guild)})` : ''} ${looted}${owes}${extra}</h3>
    <div class="grid">${groups.map((g) => tile(g, p.name, view)).join('')}</div>`;
}

function playerSection(p, result, view) {
  const groups = itemGroups(p, result, view.filters);
  if (groups.length === 0) return '';
  const selected = groups.find((g) => view.selected === `${p.name}|${g.id}`);
  const copy = window.ledger?.copyCardImage
    ? `<button type="button" class="link copy-card" data-action="copy-card" data-player="${esc(p.name)}">Copy image</button>` : '';
  return `<section class="player">${playerCard(p, groups, view, copy)}
    ${selected ? panel(selected, p.name, groups) : ''}
  </section>`;
}

export function cardImageHtml(p, result, view, caption) {
  const groups = itemGroups(p, result, view.filters);
  return `<section class="player">${playerCard(p, groups, { ...view, selected: '' })}
    <p class="card-caption">${esc(caption)}</p></section>`;
}

function tile(g, player, view) {
  const key = `${player}|${g.id}`;
  const tooltip = `${g.label}${g.qty > 1 ? ` x${g.qty}` : ''}\n${capitalise(OUTCOMES[g.outcome].text(g))}${g.value ? `\n${formatSilver(g.value)} silver` : ''}`;
  const img = g.itemId ? `<img src="${esc(iconUrl(g.itemId, 80))}" alt="" loading="lazy" width="72" height="72">` : '';
  return `<button type="button" class="tile ${OUTCOMES[g.outcome].tint} ${g.itemId ? '' : 'no-icon'} ${view.selected === key ? 'selected' : ''}"
    data-tip="${esc(tooltip)}" data-action="select-item" data-key="${esc(key)}">${img}<span class="tile-name">${esc(g.label)}</span>
    <b class="qty">${g.qty}</b></button>`;
}

function panel(g, player, groups) {
  const first = g.units[0];
  const source = first ? `Looted from ${esc(first.from)} at ${formatClock(first.time)} UTC` : 'Not in any loot log';
  const ref = `data-player="${esc(player)}" data-group="${esc(g.id)}"`;
  return `<div class="item-panel">
    <div><strong>${esc(g.label)}${g.qty > 1 ? ` x${g.qty}` : ''}</strong>
      <small>${source}. ${esc(capitalise(OUTCOMES[g.outcome].text(g)))}.</small></div>
    <div class="panel-actions">${panelActions(g, player, groups, ref)}</div></div>`;
}

function panelActions(g, player, groups, ref) {
  if (g.outcome === 'held') {
    return `<input type="text" list="player-names" placeholder="Player name" aria-label="Reassign to player" data-reassign-input>
      <button type="button" class="dark" data-action="reassign" ${ref}>Reassign</button>
      <button type="button" class="dark" data-action="resolve" ${ref}>Resolved</button>
      <button type="button" class="dark" data-action="died-holding" ${ref}>Died holding this</button>`;
  }
  if (g.outcome === 'deposited-by-other') {
    const count = groups.filter((o) => o.outcome === 'deposited-by-other' && o.detail === g.detail).reduce((n, o) => n + o.qty, 0);
    return `<button type="button" class="dark" data-action="reject-match" data-pair="${esc(`${player}->${g.detail}`)}">Not a match (unmatch all ${count})</button>`;
  }
  return '';
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function changes(session, result) {
  const batches = new Map();
  for (const action of result.actions) {
    if (!batches.has(action.batch)) batches.set(action.batch, []);
    batches.get(action.batch).push(action);
  }
  const stale = (batch) => (result.unapplied.has(batch) ? ' (no longer applies)' : '');
  const rows = [...batches].map(([batch, group]) => `<li><span>${esc(describeChange(group, result) + stale(batch))}</span>
    <button type="button" class="link" data-action="undo" data-batch="${esc(batch)}">Undo</button></li>`);
  const found = result.inferredDeaths.map((d) => `<li><span>${esc(d.player)} died around ${formatClock(d.time)}
    (worked out: ${esc(d.depositors.join(', '))} deposited their gear)</span>
    <button type="button" class="link" data-action="reject-match" data-pair="${esc(d.id)}">Not dead</button></li>`);
  const rejected = session.dismissed.map((id) => `<li><span>${esc(describeRejection(id))}</span>
    <button type="button" class="link" data-action="restore-match" data-pair="${esc(id)}">Undo</button></li>`);
  const all = [...found, ...rows, ...rejected];
  if (all.length === 0) return '';
  return `<details open class="bottom"><summary>Changes and worked-out deaths (${all.length})</summary><ul>${all.join('')}</ul></details>`;
}

function describeRejection(id) {
  if (!id.startsWith('death:')) return `${id.replace('->', ' and ')}: not a match`;
  const [, player, time] = id.split(':');
  return `${player} did not die around ${formatClock(Number(time))}`;
}

function describeChange(group, result) {
  const first = group[0];
  if (first.type === 'death') return first.time === null ? `${first.player} died` : `${first.player} died at ${formatClock(first.time)}`;
  const count = group.reduce((sum, action) => sum + (action.qty ?? 1), 0);
  const unit = result.units.find((u) => isSamePickup(u, first.pickup));
  const what = count === 1 && unit ? itemLabel(unit.itemName, unit.enchant) : plural(count, 'item');
  const owner = unit ? ` from ${unit.pickedBy}` : '';
  return first.type === 'transfer' ? `${what}${owner} reassigned to ${first.to}` : `${what}${owner} resolved`;
}

const REASONS = { 'before-fight': 'before this fight', withdrawal: 'withdrawals', duplicate: 'copied twice' };

function excluded(rows) {
  if (rows.length === 0) return '';
  const counts = Object.entries(REASONS)
    .map(([reason, label]) => [rows.filter((e) => e.reason === reason).length, label])
    .filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`).join(', ');
  const lines = rows.map(({ row, reason }) => `<tr><td>${esc(new Date(row.time).toISOString().slice(5, 16).replace('T', ' '))}</td>
    <td>${esc(row.player)}</td><td>${esc(itemLabel(row.itemName, row.enchant))}</td><td>${row.amount}</td><td>${esc(REASONS[reason])}</td></tr>`).join('');
  return `<details class="bottom"><summary>Chest rows not counted: ${esc(counts)}</summary><table>${lines}</table></details>`;
}
