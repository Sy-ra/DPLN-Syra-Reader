// Fenêtre de zoom : affiche l'image, un clic (ou Échap) la referme
const src = new URLSearchParams(location.search).get('src') || '';
const img = document.getElementById('img');
if (/^https:\/\//.test(src)) img.src = src;
img.onload = () => requestAnimationFrame(() => img.classList.add('on'));
document.addEventListener('mousedown', () => window.close());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
