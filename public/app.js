const $ = id => document.getElementById(id);
const tabs = [];
let active;
let enginePromise;
let controller;
const MAX_TABS = 8;

function message(text = '', error = false) {
  $('message').textContent = text;
  $('message').hidden = !text;
  $('message').classList.toggle('error', error);
}
function timeout(promise, ms, explanation) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(explanation)), ms); })]).finally(() => clearTimeout(timer));
}
async function engine() {
  if (!enginePromise) enginePromise = (async () => {
    if (!isSecureContext || !navigator.serviceWorker) throw new Error('Open Orbit on HTTPS or localhost. This browser needs service workers enabled.');
    if (!window.$scramjetLoadController || !window.BareMux) throw new Error('Browser files did not load. Reload the page or check the server installation.');
    const { ScramjetController } = window.$scramjetLoadController();
    controller = new ScramjetController({ prefix: '/service/', files: {
      wasm: '/scram/scramjet.wasm.wasm', all: '/scram/scramjet.all.js', sync: '/scram/scramjet.sync.js',
    } });
    await controller.init();
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    await timeout(navigator.serviceWorker.ready, 15000, 'The browser worker did not start. Reload and try again.');
    if (!navigator.serviceWorker.controller) await timeout(new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })), 10000, 'The browser worker is not ready. Reload and try again.');
    const connection = new window.BareMux.BareMuxConnection('/baremux/worker.js');
    const websocket = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/wisp/`;
    await timeout(connection.setTransport('/libcurl/index.mjs', [{ websocket }]), 15000, 'The connection engine did not start. Reload and try again.');
    return controller;
  })().catch(error => { enginePromise = null; throw error; });
  return enginePromise;
}
function normalize(value) {
  const text = value.trim();
  if (!text) throw new Error('Enter a website or search term first.');
  const explicit = /^[a-z][a-z\d+.-]*:/i.test(text);
  const looksLikeHost = !/\s/.test(text) && (text.includes('.') || text.startsWith('localhost'));
  if (!explicit && !looksLikeHost) return 'https://www.google.com/search?q=' + encodeURIComponent(text);
  const url = new URL(explicit ? text : 'https://' + text);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an http:// or https:// web address.');
  if (url.username || url.password) throw new Error('Use a web address without embedded usernames or passwords.');
  return url.href;
}
function updateChrome() {
  for (const tab of tabs) {
    tab.wrapper.classList.toggle('active', tab === active);
    tab.button.setAttribute('aria-selected', String(tab === active));
    tab.button.tabIndex = tab === active ? 0 : -1;
    if (tab.frame) tab.frame.frame.hidden = tab !== active || !tab.url;
  }
  $('start').hidden = !!active?.url;
  $('frames').hidden = !active?.url;
  $('address').value = active?.url || '';
  $('back').disabled = !active || active.index <= 0;
  $('forward').disabled = !active || active.index >= active.history.length - 1;
  $('reload').disabled = !active?.url;
  document.title = active?.title ? `${active.title} · Orbit` : 'Orbit Browser';
}
function select(tab) { active = tab; message(tab.loading ? 'Loading page…' : ''); updateChrome(); }
function newTab() {
  if (tabs.length >= MAX_TABS) { message('Close a tab before opening another. Orbit supports up to eight tabs.'); return null; }
  const tab = { id: crypto.randomUUID(), url: '', history: [], index: -1, title: 'New tab', frame: null, loading: false, generation: 0 };
  tab.wrapper = document.createElement('div'); tab.wrapper.className = 'tab-wrap';
  tab.button = document.createElement('button'); tab.button.className = 'tab'; tab.button.setAttribute('role', 'tab'); tab.button.textContent = tab.title;
  tab.button.addEventListener('click', () => select(tab));
  const close = document.createElement('button'); close.className = 'tab-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Close tab');
  close.addEventListener('click', () => closeTab(tab));
  tab.wrapper.append(tab.button, close); $('tabs').append(tab.wrapper); tabs.push(tab); select(tab); $('address').focus();
  tab.button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    select(next); next.button.focus();
  });
  return tab;
}
function closeTab(tab) {
  const index = tabs.indexOf(tab); tab.generation++; clearTimeout(tab.timer); tab.frame?.frame.remove(); tab.wrapper.remove(); tabs.splice(index, 1);
  if (!tabs.length) return newTab();
  if (tab === active) select(tabs[Math.min(index, tabs.length - 1)]);
}
function label(tab, title) {
  tab.title = title || 'New tab'; tab.button.textContent = tab.title; tab.button.title = tab.title;
  if (tab === active) document.title = `${tab.title} · Orbit`;
}
function remember(tab, url) {
  if (!/^https?:\/\//i.test(url)) return;
  if (tab.history[tab.index] !== url) { tab.history.splice(tab.index + 1); tab.history.push(url); tab.index = tab.history.length - 1; }
  tab.url = url;
}
function makeFrame(tab, engine) {
  const frame = engine.createFrame(); tab.frame = frame;
  frame.frame.className = 'browser-frame'; frame.frame.title = 'Website content';
  // Keep page scripts in their frame; do not allow top-level navigation or pop-ups.
  frame.frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-downloads allow-pointer-lock');
  frame.addEventListener('urlchange', event => {
    remember(tab, String(event.url));
    if (tab === active && document.activeElement !== $('address')) updateChrome();
  });
  frame.frame.addEventListener('load', () => {
    if (!tab.url) return;
    clearTimeout(tab.timer); tab.loading = false;
    try {
      label(tab, frame.frame.contentDocument.title || new URL(tab.url).hostname);
      const pageText = frame.frame.contentDocument.body?.innerText || '';
      if (/Scramjet encountered an error|Failed to fetch|Failed to establish/i.test(pageText.slice(0, 600)) || (frame.frame.contentDocument.title === 'Scramjet' && pageText.includes('There was an error loading'))) {
        if (tab === active) message('This page could not load through the relay. Try another website or reload.', true);
        return;
      }
    } catch { label(tab, new URL(tab.url).hostname); }
    if (tab === active) { message(); updateChrome(); }
  });
  $('frames').append(frame.frame);
  return frame;
}
async function visit(value, tab = active, traversal = false) {
  if (!tab) return;
  const generation = ++tab.generation;
  try {
    const url = normalize(value);
    message('Starting browser…');
    const ready = await engine();
    if (!tabs.includes(tab) || tab.generation !== generation) return;
    if (!traversal) remember(tab, url); else tab.url = url;
    const frame = tab.frame || makeFrame(tab, ready);
    label(tab, new URL(url).hostname); tab.loading = true;
    clearTimeout(tab.timer);
    tab.timer = setTimeout(() => { if (tab === active && tab.loading) message('Still waiting for this page. The website or relay may be unavailable. You can try another address.', true); }, 25000);
    updateChrome(); if (tab === active) message('Loading page…');
    frame.go(url);
  } catch (error) { if (tab === active) message(error.message || 'Could not open this page.', true); }
}
for (const [form, input] of [['address-form', 'address'], ['search-form', 'search']]) $(form).addEventListener('submit', event => { event.preventDefault(); visit($(input).value); });
document.querySelectorAll('[data-url]').forEach(button => button.addEventListener('click', () => visit(button.dataset.url)));
$('new-tab').addEventListener('click', newTab);
$('back').addEventListener('click', () => { if (active.index > 0) visit(active.history[--active.index], active, true); });
$('forward').addEventListener('click', () => { if (active.index < active.history.length - 1) visit(active.history[++active.index], active, true); });
$('reload').addEventListener('click', () => { if (active.url) visit(active.url, active, true); });
$('home').addEventListener('click', () => {
  active.generation++; clearTimeout(active.timer); active.frame?.frame.remove(); active.frame = null; active.url = ''; active.loading = false; label(active, 'New tab'); message(); updateChrome(); $('search').focus();
});
$('help').addEventListener('click', () => $('about').showModal());
$('clear-data').addEventListener('click', () => {
  if (!confirm('Close all Orbit tabs, clear stored website data, and sign out?')) return;
  const form = document.createElement('form'); form.method = 'POST'; form.action = '/auth/logout'; document.body.append(form); form.submit();
});
window.addEventListener('offline', () => message('Your device is offline. Reconnect and reload the page.', true));
document.querySelectorAll('#address-form [disabled], #search-form [disabled]').forEach(control => { control.disabled = false; });
newTab();
