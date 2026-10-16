// native title tooltips have a fixed delay
const tooltip = document.createElement('div');
tooltip.className = 'tooltip';
tooltip.hidden = true;
document.body.append(tooltip);
document.addEventListener('mouseover', (event) => {
  const tile = event.target.closest('[data-tip]');
  tooltip.hidden = !tile;
  if (tile) tooltip.textContent = tile.dataset.tip;
});
document.addEventListener('mousemove', (event) => {
  if (tooltip.hidden) return;
  const x = Math.min(event.clientX + 14, window.innerWidth - tooltip.offsetWidth - 8);
  const y = event.clientY + 18 + tooltip.offsetHeight > window.innerHeight ? event.clientY - tooltip.offsetHeight - 10 : event.clientY + 18;
  tooltip.style.transform = `translate(${x}px, ${y}px)`;
});
