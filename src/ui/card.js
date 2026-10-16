const ICON_WAIT_MS = 400;

function showCard(html) {
  const card = document.getElementById('card');
  // lazy images outside the viewport never load
  card.innerHTML = html.replace(/loading="lazy"/g, '');
  const images = [...card.querySelectorAll('img')];
  const ready = new Set();
  // decode() so the icon is actually paintable before the capture
  const icons = images.map((img) => img.decode().then(() => ready.add(img), () => {}));
  const timeout = new Promise((resolve) => { setTimeout(resolve, ICON_WAIT_MS); });
  return Promise.race([Promise.all(icons), timeout]).then(() => {
    images.filter((img) => !ready.has(img)).forEach((img) => img.closest('.tile')?.classList.add('no-icon'));
    return Math.ceil(document.body.getBoundingClientRect().height);
  });
}
