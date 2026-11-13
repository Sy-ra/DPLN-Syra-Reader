// DPLN Syra Reader — rendu vertical d'une page dofuspourlesnoobs.com
const $ = (s) => document.querySelector(s);
const BASE = 'https://www.dofuspourlesnoobs.com/';
const SITE_RE = /^https?:\/\/(www\.)?dofuspourlesnoobs\.com\//i;

const state = {
  url: null,
  history: [],
  steps: [],      // { travel, zaap, label, el }
  current: -1,
  posMap: {},
  font: 17,
  showImgs: true
};

function savePrefs() {
  window.api.setSetting('font', state.font);
  window.api.setSetting('showImgs', state.showImgs);
}
function applyPrefs() {
  document.documentElement.style.setProperty('--font', state.font + 'px');
  document.body.classList.toggle('no-imgs', !state.showImgs);

  $('#imgs').checked = state.showImgs;
}

// ---------- Toast ----------
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 1600);
}

// ---------- Zaap le plus proche (logique du site) ----------
const dist = (x1, y1, x2, y2) => Math.abs(x1 - x2) + Math.abs(y1 - y2);
function nearestZaap(x, y) {
  let best = null, bestD = Infinity;
  for (const z of window.ZAAPS) {
    const d = dist(x, y, z[0], z[1]) + (z[2] || 0);
    if (d < bestD) { bestD = d; best = z; }
  }
  return best ? { z: best, d: bestD } : null;
}
function zaapCmd(xs, ys, zx, zy, keepTravel) {
  let c = '/zaap ' + zx + ',' + zy;
  if (keepTravel || parseFloat(xs) !== parseFloat(zx) || parseFloat(ys) !== parseFloat(zy)) c += ' ; /travel ' + xs + ',' + ys;
  return c;
}

// ---------- Nettoyage du HTML distant ----------
const ALLOWED = new Set(['STRONG','B','EM','I','U','BR','SPAN','A','UL','OL','LI','P','FONT','SUP','SUB','DIV','BLOCKQUOTE']);
function sanitize(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.COMMENT_NODE) { child.remove(); continue; }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    if (!ALLOWED.has(child.tagName)) {
      if (['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','svg'].includes(child.tagName)) { child.remove(); continue; }
      // on garde le contenu, on retire la balise
      sanitize(child);
      child.replaceWith(...child.childNodes);
      continue;
    }
    const href = child.tagName === 'A' ? child.getAttribute('href') : null;
    for (const a of [...child.attributes]) child.removeAttribute(a.name);
    if (href && !/^\s*javascript:/i.test(href)) {
      try { child.setAttribute('href', new URL(href, state.url || BASE).href); } catch (_) {}
    }
    sanitize(child);
  }
  return node;
}

// ---------- Coordonnées → puces cliquables ----------
const COORD_RE = /\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(!)?\](?:\s*\(zaap\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(!)?\))?/g;
let prevCoord = null, prevHadZaap = false;

function decorateCoords(el) {
  el.innerHTML = el.innerHTML.replace(COORD_RE, (m, xs, ys, excl, zxs, zys, keep) => {
    const x = parseFloat(xs), y = parseFloat(ys);
    let zaap = null;
    if (zxs !== undefined) {
      zaap = zaapCmd(xs, ys, zxs, zys, keep);
    } else if (!excl) {
      const near = nearestZaap(x, y);
      if (near) {
        const dPrev = prevCoord ? dist(x, y, prevCoord[0], prevCoord[1]) : Infinity;
        if (dPrev === 0) { if (prevHadZaap) zaap = zaapCmd(xs, ys, near.z[0], near.z[1]); }
        else if (near.d < dPrev) zaap = zaapCmd(xs, ys, near.z[0], near.z[1]);
      }
    }
    prevCoord = [x, y];
    prevHadZaap = !!zaap;
    const i = state.steps.length;
    const zpos = zaap ? zaap.match(/^\/zaap (\S+)/)[1] : null;
    state.steps.push({ travel: '/travel ' + xs + ',' + ys, zaap, zpos, coord: '[' + xs + ',' + ys + ']' });
    return '<span class="coord" data-i="' + i + '">' + chipsHTML(i) + '</span>';
  });
}

function chipHTML(i, kind, text, title) {
  return '<button class="chip ' + kind + '" data-i="' + i + '" data-kind="' + kind + '" title="' + title + '">' +
    icon(kind === 'zaap' ? 'portal' : 'mappin') + icon('check').replace('class="ico"', 'class="ico ok"') + text + '</button>';
}
function chipsHTML(i, long) {
  const s = state.steps[i];
  const pos = s.travel.slice(8);
  let h = chipHTML(i, 'travel', long ? s.travel : pos, 'Copier ' + s.travel);
  if (s.zaap) h += chipHTML(i, 'zaap', '<small>' + (long ? 'via zaap' : 'zaap') + '</small>' + s.zpos, 'Copier ' + s.zaap);
  return h;
}

// ---------- Ressources « 3 x Nom » → nom cliquable ----------
const RES_RE = /^((?:\s|&nbsp;|<[^>]+>)*)(\d[\d\s]*)(?:\s|&nbsp;)*x(?:\s|&nbsp;)+([^<(.:]+?)((?:\s|&nbsp;)*(?:[(.:<]|$))/i;
const NOT_RES = /^(donjons?|combats?|qu[eê]tes?|aide|succ[eè]s|niveau|xp|kamas)\b/i;
const FIGHT_RE = /^combats?\b/i;
const fightTag = (name) => '<span class="fight">' + name + '</span>';
const DUNGEON_RE = /^donjons?\b/i;
const dungeonTag = (name) => '<span class="dungeon">' + name + '</span>';
function decorateResources(el) {
  el.querySelectorAll('li').forEach((li) => {
    li.innerHTML = li.innerHTML.replace(RES_RE, (m, pre, qty, name, post) => {
      const clean = name.replace(/&nbsp;/g, ' ').trim();
      if (FIGHT_RE.test(clean)) return pre + qty.trim() + ' x ' + fightTag(name.trim()) + post;
      if (DUNGEON_RE.test(clean)) return pre + qty.trim() + ' x ' + dungeonTag(name.trim()) + post;
      if (!clean || NOT_RES.test(clean) || /^(xp|kamas)$/i.test(clean)) return m;
      return pre + qty.trim() + ' x <button class="res" title="Copier le nom">' + name.trim() + '</button>' + post;
    });
  });
}

// ---------- Analyse des ressources : « À prévoir » + crafts demandés ----------
const ITEM_RE = /^\s*(\d[\d\s]*)\s*x\s+(.+?)\s*(?:\((.*)\))?\s*\.?\s*$/i;
const CRAFT_RE = /(?:fabriquer|crafter|confectionner|forger)\s+(ou\s+(?:vous\s+)?procurer\s+)?(\d+)\s*x\s+([^.,;:(]+?)(?=\s+(?:à l[’']aide|avec|grâce|auprès|chez|et|en|pour|puis)\b|\s*[.,;:(]|$)/gi;
const JOB_RE = /(forgeron|bijoutier|tailleur|cordonnier|sculpteur|façonneur|alchimiste|paysan|bricoleur|mineur|bûcheron|chasseur|pêcheur|boulanger|boucher|poissonnier|forgemage|sculptemage|joaillomage|cordomage|costumage|façomage)s?\s+(?:de\s+)?niveau\s*(\d+)(\s*ou\s+plus)?/i;

function parseItems(ul) {
  return [...ul.querySelectorAll(':scope > li')].map((li) => {
    const t = li.textContent.replace(/\s+/g, ' ').trim();
    const m = t.match(ITEM_RE);
    if (!m) return { text: t };
    const name = m[2].trim();
    return { qty: +m[1].replace(/\s/g, ''), name, note: m[3] || '', isRes: !NOT_RES.test(name) };
  });
}

function analyzeResources(main) {
  const out = { prevoir: [], crafts: [] };
  // « À prévoir : » suivi d'une liste
  main.querySelectorAll('.para strong, .para b').forEach((st) => {
    if (out.prevoir.length || !/^\s*à prévoir/i.test(st.textContent)) return;
    let n = st.nextElementSibling;
    while (n && n.tagName === 'BR') n = n.nextElementSibling;
    if (!n || !/^(UL|OL)$/.test(n.tagName)) n = st.closest('.para').querySelector('ul,ol');
    if (n) out.prevoir = parseItems(n);
  });
  // Crafts : « fabriquer 1 x Objet à l'aide d'un forgeron niveau 140… recette suivante »
  const blocks = [...main.children];
  const fullText = main.textContent;
  blocks.forEach((b, bi) => {
    if (!b.classList.contains('para')) return;
    const text = b.textContent.replace(/\s+/g, ' ');
    for (const m of text.matchAll(CRAFT_RE)) {
      const item = m[3].trim();
      const key = item.toLowerCase();
      let c = out.crafts.find((x) => x.item.toLowerCase() === key);
      if (!c) { c = { qty: +m[2], item, job: null, ings: [], canBuy: false, exchangeable: false, el: b }; out.crafts.push(c); }
      if (m[1]) c.canBuy = true;
      const sentence = text.slice(m.index, m.index + 220);
      const j = sentence.match(JOB_RE);
      if (j && !c.job) c.job = j[1][0].toUpperCase() + j[1].slice(1) + ' niv. ' + j[2] + (j[3] ? '+' : '');
      // ingrédients : liste dans le même bloc, sinon dans les blocs suivants
      if (!c.ings.length && /recette|suivant|ressources? suivantes|:\s*$/i.test(sentence)) {
        const candidates = [b, ...blocks.slice(bi + 1, bi + 6)];
        for (const cb of candidates) {
          if (cb.tagName === 'H2') break;
          const ul = cb.classList?.contains('para') && cb.querySelector('ul,ol');
          if (!ul) continue;
          const items = parseItems(ul).filter((x) => x.name && x.isRes);
          if (items.length) { c.ings = items; break; }
        }
      }
    }
  });
  // Objet échangeable / achetable ?
  for (const c of out.crafts) {
    const esc = c.item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('échang\\w*[^.]{0,40}' + esc, 'i').test(fullText)) c.exchangeable = true;
  }
  return out;
}

function renderResources() {
  const r = state.res || { prevoir: [], crafts: [] };
  const box = $('#resPanel');
  const nCraft = r.crafts.length;
  $('#resBtn').classList.toggle('alert', nCraft > 0);
  $('#resBadge').textContent = nCraft || '';
  $('#resBtn').title = nCraft ? nCraft + ' craft(s) demandé(s) par la quête : clique pour voir les ressources' : 'Ressources à prévoir';
  let h = '';
  if (nCraft) {
    for (const c of r.crafts) {
      h += '<div class="craft"><div class="craft-h">' + icon('hammer') + '<div><b>Craft à faire</b><span>' + c.qty + ' x <button class="res">' + esc(c.item) + '</button></span></div></div>';
      if (c.job) h += '<div class="craft-job">' + icon('user') + 'Avec un ' + esc(c.job) + '</div>';
      if (c.ings.length) {
        h += '<div class="craft-sub">Ressources de la recette :</div><ul class="ings">' +
          c.ings.map((x) => '<li><span class="q">' + x.qty + ' x</span><button class="res">' + esc(x.name) + '</button></li>').join('') + '</ul>';
      }
      const tips = [];
      tips.push('Ces ressources servent à <b>fabriquer</b> l\'objet : prévois l\'atelier ou un artisan.');
      if (c.canBuy || c.exchangeable) tips.push('L\'objet est échangeable : tu peux aussi l\'acheter tout fait en HDV.');
      h += '<p class="craft-tip">' + tips.join('<br>') + '</p>';
      h += '<button class="goto" data-goto="' + r.crafts.indexOf(c) + '">' + icon('book') + 'Voir dans le guide</button></div>';
    }
  }
  if (r.prevoir.length) {
    h += '<h4>À prévoir</h4><ul class="prevoir">' + r.prevoir.map((x) => {
      if (!x.name) return '<li class="other">' + esc(x.text) + '</li>';
      const isCraftIng = r.crafts.some((c) => c.ings.some((g) => g.name.toLowerCase() === x.name.toLowerCase()));
      return '<li' + (x.isRes ? '' : ' class="other"') + '><span class="q">' + x.qty + ' x</span>' +
        (x.isRes ? '<button class="res">' + esc(x.name) + '</button>' : FIGHT_RE.test(x.name) ? fightTag(esc(x.name)) : DUNGEON_RE.test(x.name) ? dungeonTag(esc(x.name)) : esc(x.name)) +
        (isCraftIng ? '<span class="tag">' + icon('hammer') + 'pour craft</span>' : '') +
        (x.note ? '<small>' + esc(x.note) + '</small>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  if (!h) h = '<p class="none">Aucune ressource à prévoir détectée sur cette page.</p>';
  box.innerHTML = h;
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Extraction de la page ----------
function extract(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('#wsite-content') || doc.querySelector('#main') || doc.body;
  const title = (doc.querySelector('.wsite-content-title') || doc.querySelector('title'))?.textContent.trim() || 'Sans titre';
  const blocks = [];
  const visit = (n) => {
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const cls = n.classList;
    if (cls.contains('wcustomhtml') || n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.tagName === 'FORM') return;
    if (/^H[1-4]$/.test(n.tagName) || cls.contains('wsite-content-title')) {
      const t = n.textContent.trim();
      if (t && t !== title) blocks.push({ type: 'h', text: t });
      return;
    }
    if (cls.contains('paragraph')) {
      if (n.textContent.trim()) blocks.push({ type: 'p', node: n });
      return;
    }
    if (n.tagName === 'IMG') {
      const src = n.getAttribute('src');
      if (src && !/zaap\.png|destination\.png/.test(src)) {
        try { blocks.push({ type: 'img', src: new URL(src, state.url || BASE).href, alt: n.getAttribute('alt') || '' }); } catch (_) {}
      }
      return;
    }
    for (const c of n.children) visit(c);
  };
  visit(root);
  return { title, blocks };
}

function render({ title, blocks }) {
  state.steps = []; state.current = -1; prevCoord = null; prevHadZaap = false;
  const main = $('#read');
  main.innerHTML = '';
  const h1 = document.createElement('h1');
  h1.textContent = title;
  main.appendChild(h1);

  for (const b of blocks) {
    if (b.type === 'h') {
      const h = document.createElement('h2'); h.textContent = b.text; main.appendChild(h);
    } else if (b.type === 'img') {
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.loading = 'lazy'; img.src = b.src; img.alt = b.alt;
      img.addEventListener('click', () => openZoom(img));
      fig.appendChild(img); main.appendChild(fig);
    } else {
      const p = document.createElement('div');
      p.className = 'para';
      p.innerHTML = sanitize(b.node).innerHTML;
      decorateCoords(p);
      decorateResources(p);
      main.appendChild(p);
    }
  }
  if (!blocks.length) main.insertAdjacentHTML('beforeend', '<p class="empty">Aucun contenu texte trouvé sur cette page.</p>');

  // Libellés des étapes (début de phrase autour de la coordonnée)
  main.querySelectorAll('.coord').forEach((c) => {
    const s = state.steps[+c.dataset.i];
    s.el = c;
    const r = document.createRange();
    r.setStart(c.closest('.para'), 0);
    r.setEndBefore(c);
    const before = r.toString();
    // dernière phrase avant la coordonnée
    const parts = before.slice(-160).split(/(?<=[.!?])\s*(?=[A-ZÀ-Ý])/);
    s.label = parts[parts.length - 1].replace(/\s+/g, ' ').trim();
    if (s.label.length > 90) s.label = '…' + s.label.slice(-88).replace(/^\S*\s/, '');
    if (s.label.length >= 68) s.label = '…' + s.label.replace(/^\S*\s/, '');
  });

  state.res = analyzeResources(main);
  renderResources();
  renderSteps();
  $('#count').textContent = state.steps.length;
  $('#stepbar').hidden = state.steps.length === 0;
  restoreReadPos();
  updateCurrent();
  document.title = title + ' — DPLN Syra Reader';
}

// ---------- Zoom sur une image : fenêtre à part, 2x plus grande, un clic la referme ----------
function openZoom(img) {
  const r = img.getBoundingClientRect();
  window.api.zoomImage(img.currentSrc || img.src, { x: r.left, y: r.top, width: r.width, height: r.height });
}

function renderSteps() {
  const v = $('#steps');
  v.innerHTML = '';
  if (!state.steps.length) { v.innerHTML = '<p class="empty">Aucune coordonnée sur cette page.</p>'; return; }
  state.steps.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'step'; row.dataset.i = i;
    row.innerHTML =
      '<div class="num">' + (i + 1) + '</div>' +
      '<div class="body"><div class="lbl"></div><div class="cmds">' + chipsHTML(i, true) + '</div></div>';
    row.querySelector('.lbl').textContent = s.label || '';
    v.appendChild(row);
  });
}

function updateCurrent() {
  document.querySelectorAll('.current').forEach(e => e.classList.remove('current'));
  const s = state.steps[state.current];
  const n = state.steps.length;
  $('#curIdx').textContent = n ? (s ? (state.current + 1) + '/' + n : '0/' + n) : '';
  // Commande en cours en petites cards : « /zaap 7,-4 » puis « /travel 4,-15 »
  const box = $('#curCmd');
  box.innerHTML = '';
  if (!s) {
    box.innerHTML = '<span class="cmdhint">Suivant copie le 1er /travel</span>';
  } else {
    for (const part of cmdOf(s).split(/\s*;\s*/)) {
      const card = document.createElement('span');
      card.className = 'cmdcard ' + (part.startsWith('/zaap') ? 'z' : 't');
      card.textContent = part;
      box.appendChild(card);
    }
  }
  box.title = s ? cmdOf(s) : '';
  $('#prog').style.width = n && s ? ((state.current + 1) / n * 100) + '%' : '0';
  if (!s) return;
  s.el?.classList.add('current');
  document.querySelector('.step[data-i="' + state.current + '"]')?.classList.add('current');
}

// Pas de défilement automatique : on reste là où on lit
function flash(el) {
  if (!el) return;
  el.classList.remove('copied'); void el.offsetWidth; el.classList.add('copied');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('copied'), 900);
}
async function copy(cmd, el) {
  await window.api.copy(cmd);
  flash(el);
  toast('Copié : ' + cmd);
}

const cmdOf = (s) => (state.zaapMode && s.zaap) || s.travel;

// Avance au /travel suivant (ou précédent), en sautant les étapes à la même position
function step(delta) {
  const n = state.steps.length;
  if (!n) return;
  const from = state.steps[state.current];
  let i = state.current < 0 && delta > 0 ? 0 : state.current + delta;
  while (from && i >= 0 && i < n && state.steps[i].travel === from.travel) i += delta;
  if (i < 0 || i >= n) { toast(delta > 0 ? 'Dernier trajet de la quête atteint' : 'Premier trajet'); return; }
  state.current = i;
  updateCurrent();
  saveReadPos();
  const s = state.steps[i];
  copy(cmdOf(s), s.el?.querySelector('.chip.' + (state.zaapMode && s.zaap ? 'zaap' : 'travel')));
}

// ---------- Position de lecture mémorisée par page ----------
// On retient le bloc visible en haut (+ décalage) plutôt qu'un nombre de pixels,
// pour rester juste même si les images se chargent après.
function saveReadPos() {
  if (!state.url) return;
  const main = $('#read'), top = main.scrollTop;
  const kids = [...main.children];
  let a = kids.findIndex((el) => el.offsetTop + el.offsetHeight > top);
  if (a < 0) a = 0;
  state.posMap[state.url] = { a, o: Math.round(top - (kids[a]?.offsetTop || 0)), cur: state.current, t: Date.now() };
  const keys = Object.keys(state.posMap);
  if (keys.length > 80) keys.sort((x, y) => state.posMap[x].t - state.posMap[y].t).slice(0, keys.length - 80).forEach((k) => delete state.posMap[k]);
  window.api.setSetting('posMap', state.posMap);
}
function restoreReadPos() {
  const main = $('#read');
  const p = state.posMap[state.url];
  if (!p) { main.scrollTop = 0; return; }
  if (p.cur >= 0 && p.cur < state.steps.length) state.current = p.cur;
  const apply = () => { const el = main.children[p.a]; main.scrollTop = el ? el.offsetTop + p.o : 0; };
  apply();
  requestAnimationFrame(apply);
}
const pageCache = new Map(); // évite de retélécharger une page déjà vue (changement d'onglet)

// ---------- Chargement ----------
async function load(url, { push = true, fresh = false } = {}) {
  if (!SITE_RE.test(url)) { toast('URL non reconnue (dofuspourlesnoobs.com uniquement)'); return; }
  url = url.split('#')[0];
  if (url === state.url && !fresh) return;
  saveReadPos();
  $('#url').value = url;
  $('#read').classList.add('loading');
  try {
    let html = !fresh && pageCache.get(url);
    if (!html) { html = await window.api.fetchPage(url); pageCache.set(url, html); }
    if (push && state.url) state.history.push(state.url);
    state.url = url;
    render(extract(html));
    setView('read');
  } catch (e) {
    toast('Erreur de chargement : ' + e.message);
  } finally {
    $('#read').classList.remove('loading');
  }
}

function setView(v) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  document.querySelectorAll('.view').forEach(e => e.classList.toggle('active', e.id === v));
  updateCurrent();
}

// ---------- Événements ----------
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) {
    const i = +chip.dataset.i, s = state.steps[i];
    state.current = i; updateCurrent(); saveReadPos();
    copy(chip.dataset.kind === 'zaap' ? s.zaap : s.travel, chip);
    return;
  }
  const go = e.target.closest('[data-goto]');
  if (go) {
    togglePanel('#resPanel', '#resBtn', false);
    setView('read');
    state.res.crafts[+go.dataset.goto]?.el.scrollIntoView({ block: 'center' });
    return;
  }
  const res = e.target.closest('.res');
  if (res) { copy(res.textContent.trim(), res); return; }
  const a = e.target.closest('a[href]');
  if (a) {
    e.preventDefault();
    if (SITE_RE.test(a.href)) load(a.href); else window.api.openExternal(a.href);
    return;
  }
  const row = e.target.closest('.step');
  if (row) { // clic sur une ligne de la liste : on va voir ce passage
    state.current = +row.dataset.i; setView('read');
    state.steps[state.current].el?.scrollIntoView({ block: 'center' });
  }
});

$('#go').onclick = () => load($('#url').value.trim(), { fresh: true });
$('#url').addEventListener('keydown', (e) => { if (e.key === 'Enter') load($('#url').value.trim()); });
$('#back').onclick = () => { const u = state.history.pop(); if (u) load(u, { push: false }); };
$('#next').onclick = () => step(1);
$('#prev').onclick = () => step(-1);
function showPin(p) { $('#pin').classList.toggle('on', p); $('#pin').title = p ? 'Épinglée au premier plan (clic pour désépingler)' : 'Épingler au premier plan'; }
$('#pin').onclick = async () => { const p = await window.api.togglePin(); showPin(p); toast(p ? 'Fenêtre épinglée au premier plan' : 'Fenêtre désépinglée'); };
function togglePanel(panel, btn, force) {
  const show = force ?? $(panel).hidden;
  for (const [p, b] of [['#settings', '#settingsBtn'], ['#resPanel', '#resBtn']]) {
    const on = p === panel ? show : false;
    $(p).hidden = !on; $(b).classList.toggle('on', on);
  }
}
$('#settingsBtn').onclick = () => togglePanel('#settings', '#settingsBtn');
$('#resBtn').onclick = () => togglePanel('#resPanel', '#resBtn');
$('#screen').onclick = () => window.api.nextDisplay();
$('#snapL').onclick = () => window.api.snap('left');
$('#snapR').onclick = () => window.api.snap('right');
// Taille du texte : Ctrl + molette (ou Ctrl + / Ctrl − / Ctrl 0)
let fontSaveT;
function setFont(f) {
  f = Math.min(28, Math.max(11, f));
  if (f === state.font) return;
  state.font = f;
  applyPrefs();
  toast('Taille du texte : ' + f);
  clearTimeout(fontSaveT); fontSaveT = setTimeout(savePrefs, 400);
}
window.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setFont(state.font + (e.deltaY < 0 ? 1 : -1));
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey) return;
  if (e.key === '+' || e.key === '=') { e.preventDefault(); setFont(state.font + 1); }
  else if (e.key === '-') { e.preventDefault(); setFont(state.font - 1); }
  else if (e.key === '0') { e.preventDefault(); setFont(17); }
});
$('#imgs').onchange = () => { state.showImgs = $('#imgs').checked; applyPrefs(); savePrefs(); };
$('#clip').onchange = () => window.api.setSetting('watchClipboard', $('#clip').checked);
let scrollT;
$('#read').addEventListener('scroll', () => {
  clearTimeout(scrollT);
  scrollT = setTimeout(saveReadPos, 400);
});
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => setView(b.dataset.view));

$('#zmode').onclick = async () => {
  state.zaapMode = !state.zaapMode;
  await window.api.setSetting('zaapMode', state.zaapMode);
  $('#zmode').classList.toggle('on', state.zaapMode);
  updateCurrent();
  toast(state.zaapMode ? 'Suivant copiera /zaap + /travel' : 'Suivant copiera /travel seul');
};

// ----- Raccourcis clavier -----
const KEYNAMES = { ArrowRight: 'Right', ArrowLeft: 'Left', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space', '+': 'Plus' };
function toAccelerator(e) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return null;
  let k = KEYNAMES[e.key] || e.key;
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) k = 'num' + e.code.slice(6);
  else if (k.length === 1) k = k.toUpperCase();
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, k].join('+');
}
function showKeys(keys) {
  state.keys = keys;
  $('#kNext').value = keys.next || '(aucun)';
  $('#kPrev').value = keys.prev || '(aucun)';
  $('#next').title = 'Copier le /travel suivant' + (keys.next ? ' (' + keys.next + ')' : '');
  $('#prev').title = 'Revenir au /travel précédent' + (keys.prev ? ' (' + keys.prev + ')' : '');
  $('#nextKey').textContent = keys.next || '';
}
for (const [id, action] of [['#kNext', 'next'], ['#kPrev', 'prev']]) {
  const inp = $(id);
  inp.addEventListener('focus', () => { window.api.suspendKeys(true); inp.value = 'Appuie sur une touche…'; });
  inp.addEventListener('blur', () => { window.api.suspendKeys(false); showKeys(state.keys); });
  inp.addEventListener('keydown', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') return inp.blur();
    const acc = e.key === 'Backspace' ? '' : toAccelerator(e);
    if (acc === null) return;
    const r = await window.api.setKey(action, acc);
    if (r.ok) toast(acc ? 'Raccourci : ' + acc : 'Raccourci désactivé');
    else toast('« ' + acc + ' » est déjà pris par une autre appli');
    if (r.keys) state.keys = r.keys;
    inp.blur();
  });
}
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); step(1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
});

const SOURCES = { extension: 'le navigateur', clipboard: 'le presse-papier' };
window.api.onLoadUrl(({ url, source }) => {
  load(url);
  if (source) toast('Page ouverte depuis ' + (SOURCES[source] || source));
});
window.api.onStep(step);

(async () => {
  const s = await window.api.getSettings();
  state.font = s.font || 17;
  state.showImgs = s.showImgs !== false;
  state.posMap = s.posMap || {};
  applyPrefs();
  showPin(!!s.pinned);
  $('#clip').checked = !!s.watchClipboard;
  state.zaapMode = !!s.zaapMode;
  $('#zmode').classList.toggle('on', state.zaapMode);
  showKeys(s.keys || {});
  if (s.lastUrl) load(s.lastUrl, { push: false });
})();
