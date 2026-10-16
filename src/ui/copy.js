import { cardImageHtml } from './renderResults.js';
import { formatDateTime } from './format.js';

export async function copyCard(playerName, result, view) {
  const player = result.players.find((p) => p.name === playerName);
  if (!player) return '';
  try {
    await window.ledger.copyCardImage(cardImageHtml(player, result, view, `Fight ${formatDateTime(result.firstPickup)}`));
    return `Copied ${playerName}'s card.`;
  } catch (error) {
    return `Could not copy ${playerName}'s card (${error.message}).`;
  }
}
