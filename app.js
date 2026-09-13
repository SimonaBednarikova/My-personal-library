const STORAGE_KEY = 'library-state-v2';
const state = { books: [], toRead: [], filtered: [], genre: 'All', query: '', selected: 0, detailBooks: [] };
let lastFocusedBeforeModal = null;
let modalSpine = '';
let modalInk = '';
let modalRating = 0;
let modalShelf = 'toRead';
const $ = (id) => document.getElementById(id);

// Red-family pearlescent spine palette. [gradient, ink]. Index i*7%12 keeps
// neighbours from repeating for the seeded prototype list; our real dynamic
// lists instead pick a stable index per book id (see paletteFor) so a book
// doesn't change colour every time the shelf re-sorts.
const REDS = [
  ['linear-gradient(174deg,#C21428 0%,#8E1319 54%,#5C0A12 100%)', '#FFF7FC'],
  ['linear-gradient(174deg,#F8F4EC 0%,#E5DED0 54%,#C9C1B0 100%)', '#0B0536'],
  ['linear-gradient(174deg,#FF4438 0%,#D3161A 56%,#8E0E12 100%)', '#FFF7FC'],
  ['linear-gradient(174deg,#2A0A12 0%,#40101C 56%,#5A1626 100%)', '#FFF7FC'],
  ['linear-gradient(174deg,#F7D3D9 0%,#E2A0AE 54%,#C87A8C 100%)', '#0B0536'],
  ['linear-gradient(174deg,#A81C3A 0%,#7A1230 56%,#4E0A1E 100%)', '#FFF7FC'],
  ['linear-gradient(174deg,#FFF4F5 0%,#EBD8DC 54%,#CFB6BC 100%)', '#0B0536'],
  ['linear-gradient(174deg,#E33A4E 0%,#B81E33 56%,#82101F 100%)', '#FFF7FC'],
  ['linear-gradient(174deg,#EDEAE3 0%,#D8D4CC 54%,#BEB9AE 100%)', '#0B0536'],
  ['linear-gradient(174deg,#160610 0%,#24081A 58%,#360C22 100%)', '#FFF7FC'],
  ['linear-gradient(174deg,#D9264A 0%,#A6142F 56%,#6E0C1E 100%)', '#FFF7FC'],
  ['linear-gradient(174deg,#F2C7CE 0%,#D79AA6 54%,#B67482 100%)', '#0B0536'],
];
const WIDTHS = [34, 40, 30, 44, 36, 32, 42, 38];

function hash(value) { let h=0; for (let i=0;i<value.length;i++) h=(h*31+value.charCodeAt(i))|0; return Math.abs(h); }

// A book keeps an explicitly-chosen palette entry (set via the add-book
// modal) if it has one; otherwise the palette/width/height are derived
// deterministically from its id, so re-sorting never shuffles its look.
function paletteFor(book) {
  if (typeof book.spine === 'string' && book.spine.startsWith('linear-gradient')) return { bg: book.spine, ink: book.ink || '#FFF7FC' };
  const [bg, ink] = REDS[hash(book.id) % REDS.length];
  return { bg, ink };
}
function widthFor(book) { return WIDTHS[hash(book.id) % WIDTHS.length]; }
function heightFor(book) { return 288 + (hash(book.id) % 108); }

function parseCSV(text) { const rows=[]; let row=[], cell='', quoted=false; for(let i=0;i<text.length;i++){const c=text[i], n=text[i+1]; if(c==='"'&&quoted&&n==='"'){cell+='"';i++;} else if(c==='"'){quoted=!quoted;} else if(c===','&&!quoted){row.push(cell);cell='';} else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&n==='\n')i++;row.push(cell); if(row.some(Boolean))rows.push(row);row=[];cell='';} else cell+=c;} if(cell||row.length){row.push(cell);rows.push(row);} const head=rows.shift(); return rows.map(values=>Object.fromEntries(head.map((key,i)=>[key,values[i]||'']))); }
function normalizeText(value) { return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').trim(); }
function sameAuthor(left, right) { return normalizeText(left).replaceAll(' ','')===normalizeText(right).replaceAll(' ',''); }
function baseTitle(value) { return normalizeText(value.split(' (')[0]); }
function spineName(value) { const clean=value.split(' (')[0].split(':')[0].trim(); return clean.length>15?`${clean.slice(0,14).trimEnd()}…`:clean; }
function classify(title) { const t=title.toLowerCase(); if(/harry potter|witch|magic|dragon|fantasy|throne|kingdom/.test(t)) return 'Fantasy'; if(/love|heart|romance|girl|woman|wife/.test(t)) return 'Romance'; if(/murder|crime|death|killer|mystery|detective/.test(t)) return 'Mystery & Thriller'; if(/science|space|dune|mars|robot/.test(t)) return 'Sci-Fi'; return 'Fiction'; }
function makeBook(r, i) { const pages=Number(r['Number of Pages'])||300, date=r['Date Read']?new Date(r['Date Read'].replaceAll('/','-')).toLocaleDateString('en-US',{month:'short',year:'numeric'}):'In progress'; return { id:r['Book Id']||String(i), title:r.Title, author:r.Author, year:Number(r['Original Publication Year']||r['Year Published'])||0, rating:Number(r['My Rating'])||0, pages, finished:date, genre:classify(r.Title), spine:'', ink:'', cover:'', rereadCount:0 }; }
async function hydrateCovers() {
  // Populates book.cover for the detail view's big cover image. No shelf
  // re-render here — the shelf renders its own gradient spines regardless
  // of cover art, and rebuilding shelf DOM mid-drag would break the pan.
  await Promise.all([...state.books,...state.toRead].map(async book => {
    try {
      const query=`https://openlibrary.org/search.json?title=${encodeURIComponent(book.title.split(' (')[0])}&author=${encodeURIComponent(book.author)}&limit=12&fields=title,author_name,cover_i`;
      const data=await fetch(query).then(r=>r.json());
      const wantedTitle=baseTitle(book.title);
      const match=data.docs.find(doc=>doc.cover_i&&baseTitle(doc.title||'')===wantedTitle&&Array.isArray(doc.author_name)&&doc.author_name.some(author=>sameAuthor(author,book.author)));
      if(match) book.cover=`https://covers.openlibrary.org/b/id/${match.cover_i}-L.jpg`;
    } catch(error) { /* Keep the verified fallback empty when lookup is unavailable. */ }
  }));
}
function renderGenres() { const counts={All:state.books.length}; state.books.forEach(b=>counts[b.genre]=(counts[b.genre]||0)+1); $('genre-list').innerHTML=Object.entries(counts).sort((a,b)=>a[0]==='All'?-1:b[0]==='All'?1:b[1]-a[1]).map(([name,count])=>`<button class="genre ${state.genre===name?'active':''}" data-genre="${name}">${name} <small>${count}</small></button>`).join(''); document.querySelectorAll('.genre').forEach(b=>b.onclick=()=>{state.genre=b.dataset.genre; filter();}); }
function filter() { const q=state.query.toLowerCase().trim(); state.filtered=state.books.filter(b=>(state.genre==='All'||b.genre===state.genre)&&(!q||`${b.title} ${b.author} ${b.genre}`.toLowerCase().includes(q))); renderGenres(); renderShelf(); }
function toDbRow(b, shelf, position) { return { id:b.id, title:b.title, author:b.author, genre:b.genre||'Fiction', year:b.year||null, pages:b.pages||0, rating:b.rating||0, finished:b.finished||'In progress', spine:b.spine||'', ink:b.ink||'', cover:b.cover||'', reread_count:b.rereadCount||0, note:b.note||null, shelf, position }; }
function fromDbRow(r) { return { id:r.id, title:r.title, author:r.author, genre:r.genre, year:r.year||0, pages:r.pages||0, rating:r.rating||0, finished:r.finished, spine:r.spine||'', ink:r.ink||'', cover:r.cover||'', rereadCount:r.reread_count||0, note:r.note||undefined }; }
async function saveLibrary() {
  const rows=[...state.books.map((b,i)=>toDbRow(b,'read',i)), ...state.toRead.map((b,i)=>toDbRow(b,'toRead',i))];
  if(!rows.length) return;
  const { error }=await supabaseClient.from('books').upsert(rows);
  if(error) console.error('Supabase save failed', error);
}
function moveBook(id, from, to) { const source=from==='toRead'?state.toRead:state.books; const target=to==='toRead'?state.toRead:state.books; const index=source.findIndex(book=>book.id===id); if(index<0||source===target)return; const [book]=source.splice(index,1); if(to==='read') book.finished='Marked read'; target.unshift(book); saveLibrary(); filter(); }
function sortShelf(shelfName, mode) { const books=shelfName==='toRead'?state.toRead:state.books; if(mode==='random'){for(let i=books.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[books[i],books[j]]=[books[j],books[i]];}} else {books.sort((a,b)=>String(a[mode==='author'?'author':'title']).localeCompare(String(b[mode==='author'?'author':'title'])));} saveLibrary(); filter(); }

function diamondsHtml(rating) { return [1,2,3,4,5].map(v=>`<button type="button" class="rating-diamond ${v<=rating?'filled':''}" data-rating="${v}" aria-label="Rate ${v} out of 5"></button>`).join(''); }

// ---------- Endless shelf ----------
// A short list rendered several times over ("passes"), translated
// continuously via a single `translate`, and wrapped seamlessly once the
// offset passes one pass-width. See "Infinite scroll and responsiveness.md".
const shelves = {};
const MIN_PASSES = 4;

function spineHtml(book, hidden) {
  const { bg, ink } = paletteFor(book), w = widthFor(book), h = heightFor(book), label = spineName(book.title);
  const a11y = hidden ? ' aria-hidden="true" tabindex="-1"' : '';
  return `<button type="button" class="spine" data-book-id="${book.id}" style="--w:${w}px;--h:${h}px;--bg:${bg};--ink:${ink}" aria-label="${book.title} by ${book.author}"${a11y}>
    <span class="spine-glass"></span>
    <span class="spine-inner">
      <span class="spine-rule"></span>
      <span class="spine-title">${label}</span>
      <span class="spine-author">${book.author}</span>
    </span>
  </button>`;
}

function reducedMotion() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

function createEndlessShelf(windowEl, shelfName, getList) {
  const track = windowEl.querySelector('[data-track]');
  const readout = windowEl.closest('.shelf-section')?.querySelector('[data-loop-readout]');
  const s = { x: 0, vel: 0, scale: 1, half: 0, dragging: false, paused: false, dragStartClientX: 0, dragStartAt: 0, downSpine: null };

  function build() {
    const items = getList();
    const onePass = items.map(b => spineHtml(b, false)).join('');
    track.innerHTML = onePass || '';
    const passWidth = track.scrollWidth || 1;
    const shelfWidth = windowEl.clientWidth || 1;
    const passes = items.length ? Math.max(MIN_PASSES, Math.ceil(shelfWidth / passWidth) + 1) : 0;
    let html = onePass;
    for (let p = 1; p < passes; p++) html += items.map(b => spineHtml(b, true)).join('');
    track.innerHTML = html;
    s.half = passes ? track.scrollWidth / passes : 0;
    fit();
  }
  function fit() {
    const shelfWidth = windowEl.clientWidth || 1440;
    s.scale = Math.min(1, Math.max(0.56, shelfWidth / 1440));
    track.style.scale = String(s.scale);
    windowEl.style.height = (430 * s.scale) + 'px';
  }
  build();
  new ResizeObserver(fit).observe(windowEl);

  function tick() {
    if (!s.dragging) {
      if (!s.paused && !reducedMotion()) { s.x -= (0.34 + s.vel); }
      s.vel *= 0.92;
    }
    if (s.half) { while (s.x <= -s.half) s.x += s.half; while (s.x > 0) s.x -= s.half; }
    track.style.translate = (s.x * s.scale) + 'px';
    if (readout && s.half) {
      const list = getList();
      const i = list.length ? Math.floor((-s.x / s.half) * list.length) % list.length : 0;
      readout.textContent = `${String(i + 1).padStart(2, '0')} / ${list.length} PASSING`;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  windowEl.addEventListener('wheel', e => { s.vel += e.deltaY * 0.05; }, { passive: true });
  // Stop dead on hover/press so a book can always be read and clicked
  // precisely, rather than the design's original "slow to a crawl".
  windowEl.addEventListener('pointerenter', () => { s.paused = true; });
  windowEl.addEventListener('pointerleave', () => { if (!s.dragging) s.paused = false; });
  windowEl.addEventListener('pointerdown', e => {
    s.dragging = true; s.paused = true;
    s.dragStartClientX = e.clientX; s.dragStartAt = s.x;
    s.downSpine = e.target.closest('.spine');
  });
  window.addEventListener('pointermove', e => {
    if (!s.dragging) return;
    s.x = s.dragStartAt + (e.clientX - s.dragStartClientX) / s.scale;
  });
  window.addEventListener('pointerup', () => { s.dragging = false; s.paused = false; s.downSpine = null; });
  window.addEventListener('pointercancel', () => { s.dragging = false; s.paused = false; s.downSpine = null; });
  // Native click already ignores drags that actually moved the pointer, and
  // fires for Enter/Space on a focused spine — no manual tap-tracking needed.
  windowEl.addEventListener('click', e => {
    const el = e.target.closest('.spine'); if (!el) return;
    const items = getList(), idx = items.findIndex(b => b.id === el.dataset.bookId);
    if (idx >= 0) openDetail(idx, shelfName);
  });
  windowEl.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    s.vel += dir * 3;
    const focused = document.activeElement?.closest('.spine');
    const sibling = focused && (dir === 1 ? focused.nextElementSibling : focused.previousElementSibling);
    if (sibling && sibling.classList.contains('spine') && sibling.tabIndex !== -1) sibling.focus();
  });

  function nudge(dir) { s.vel += dir * 4; s.paused = false; }
  return { rebuild: build, nudge };
}

function renderShelf() {
  $('empty').hidden=state.filtered.length>0;
  shelves.read?.rebuild();
  shelves.toRead?.rebuild();
  $('to-read-stat').textContent=shelfFooterStat(state.toRead);
  const allBooks=[...state.books,...state.toRead];
  $('total-count').textContent=allBooks.length;
  $('total-stat').textContent=`VOLUMES · ${new Set(allBooks.map(b=>b.author)).size} AUTHORS`;
}
function shelfFooterStat(books) { return `${books.length} VOLUMES · ${new Set(books.map(book=>book.author)).size} AUTHORS`; }

function neighboursFor(list, index) {
  const span=3, start=Math.max(0,index-span), end=Math.min(list.length,index+span+1);
  return list.slice(start,index).concat(list.slice(index+1,end)).slice(0,7);
}

function openDetail(index, shelfName='read') {
  state.detailBooks=shelfName==='toRead'?state.toRead:state.filtered;
  state.selected=index;
  const list=state.detailBooks, b=list[index], rating=b.rating||0;
  const neighbours=neighboursFor(list,index);
  const { bg } = paletteFor(b);
  const coverHtml=b.cover
    ? `<img src="${b.cover}" alt="Cover of ${b.title}" onerror="this.remove()">`
    : `<div class="detail-cover-kicker">${b.genre.toUpperCase()} · ${b.year||'—'}</div><div class="detail-cover-text"><div class="title">${b.title.split(' (')[0]}</div><div class="author">${b.author.toUpperCase()}</div></div>`;
  $('detail').hidden=false;
  $('detail').innerHTML=`
    <div class="detail-topbar">
      <button class="back" id="detail-back">← BACK TO SHELF</button>
      <div class="volume-nav"><button id="prev" aria-label="Previous book">‹</button><span>VOLUME ${index+1} / ${list.length}</span><button id="next" aria-label="Next book">›</button></div>
    </div>
    <div class="detail-body">
      <div class="detail-left">
        <div class="detail-cover" style="--bg:${bg}">${coverHtml}</div>
        <div class="detail-actions-row">
          <button class="btn-primary" id="mark-reread">${b.rereadCount?`Re-read ${b.rereadCount}×`:'Mark as re-read'}</button>
          <button class="btn-secondary" id="detail-move">${shelfName==='toRead'?'Mark as read':'Move to To Read'}</button>
          <button class="btn-secondary" id="detail-add">+ Add</button>
        </div>
      </div>
      <div class="detail-content">
        <div class="detail-meta">${shelfName==='toRead'?'TO BE READ':`READ ${String(b.finished).toUpperCase()}`} · ${b.pages} PAGES · ${shelfName==='toRead'?'WISHLIST':'KEPT'}</div>
        <h2 class="detail-title" contenteditable="true" spellcheck="false" data-field="title">${b.title}</h2>
        <div class="detail-author" contenteditable="true" spellcheck="false" data-field="author">${b.author}</div>
        <div class="rating-box"><span>MY RATING</span><div class="rating-diamonds">${diamondsHtml(rating)}</div><span class="rating-readout">${rating||'—'} / 5</span></div>
        <div class="note-label">NOTE</div>
        <p class="detail-note" contenteditable="true" spellcheck="false" data-field="note" data-placeholder="Click to add a note…">${b.note||''}</p>
        <div class="detail-tags"><span>${b.genre}</span><span>${shelfName==='toRead'?'To be read':'Kept'}</span><span>${b.pages} pages</span></div>
        <div class="sits-between">
          <div class="sits-between-label"><span>SITS BETWEEN</span><span>${shelfName==='toRead'?'TO READ':'READ'} · POSITION ${String(index+1).padStart(2,'0')}</span></div>
          <div class="sits-between-row">
            ${neighbours.map(n=>{ const p=paletteFor(n); return `<button type="button" class="spine spine--mini" data-book-id="${n.id}" style="--w:${Math.round(widthFor(n)*.9)}px;--h:${Math.round(heightFor(n)*.38)}px;--bg:${p.bg}" aria-label="${n.title}"><span class="spine-glass"></span></button>`; }).join('')}
            <img class="fishbowl-doodle doodle-img" src="illustrations/no%20background%20/55112905c57ddd3b87cadc0ea5698ed8-removebg-preview.png" alt="" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>`;
  $('detail-back').onclick=closeDetail;
  $('prev').onclick=()=>moveDetail(-1);
  $('next').onclick=()=>moveDetail(1);
  $('detail-add').onclick=openAddModal;
  $('mark-reread').onclick=()=>{ b.rereadCount=(b.rereadCount||0)+1; saveLibrary(); openDetail(index,shelfName); };
  $('detail-move').onclick=()=>{ const to=shelfName==='toRead'?'read':'toRead'; moveBook(b.id,shelfName,to); closeDetail(); };
  $('detail').querySelectorAll('[contenteditable][data-field]').forEach(el=>{
    el.addEventListener('keydown',event=>{ if(event.key==='Enter'&&el.dataset.field!=='note'){ event.preventDefault(); el.blur(); } });
    el.addEventListener('blur',()=>{
      const field=el.dataset.field, value=el.textContent.trim();
      if(field==='title'){ if(value&&value!==b.title){ b.title=value; saveLibrary(); renderShelf(); } else el.textContent=b.title; }
      else if(field==='author'){ if(value&&value!==b.author){ b.author=value; saveLibrary(); renderShelf(); } else el.textContent=b.author; }
      else if(field==='note'&&value!==(b.note||'')){ b.note=value; saveLibrary(); }
    });
  });
  document.querySelectorAll('.rating-diamond').forEach(button=>button.onclick=()=>{ b.rating=Number(button.dataset.rating); saveLibrary(); openDetail(index,shelfName); });
  document.querySelectorAll('.sits-between .spine').forEach(el=>el.onclick=()=>{ const targetId=el.dataset.bookId; const targetIndex=list.findIndex(book=>book.id===targetId); if(targetIndex>=0) openDetail(targetIndex,shelfName); });
}
function closeDetail() { $('detail').hidden=true; }
function moveDetail(delta) { const next=(state.selected+delta+state.detailBooks.length)%state.detailBooks.length; openDetail(next, state.detailBooks===state.toRead?'toRead':'read'); }

function swatchesHtml() { return REDS.map(([bg])=>`<button type="button" class="swatch ${bg===modalSpine?'selected':''}" data-bg="${bg}" style="background:${bg}" aria-label="Spine colour"></button>`).join(''); }
function renderModalPickers() {
  $('add-spine-swatches').innerHTML=swatchesHtml();
  $('add-spine-swatches').querySelectorAll('.swatch').forEach(sw=>sw.onclick=()=>{ modalSpine=sw.dataset.bg; modalInk=REDS.find(([bg])=>bg===modalSpine)?.[1]||'#FFF7FC'; renderModalPickers(); });
  $('add-rating-diamonds').innerHTML=diamondsHtml(modalRating);
  $('add-rating-diamonds').querySelectorAll('.rating-diamond').forEach(d=>d.onclick=()=>{ modalRating=Number(d.dataset.rating); renderModalPickers(); });
  $('add-shelf-toggle').querySelectorAll('button').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.shelf===modalShelf);
    btn.onclick=()=>{ modalShelf=btn.dataset.shelf; renderModalPickers(); };
  });
}
function getFocusable(container) { return [...container.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')].filter(el=>!el.disabled); }
function modalKeydown(event) {
  if (event.key==='Escape') { event.preventDefault(); closeAddModal(); return; }
  if (event.key!=='Tab') return;
  const focusable=getFocusable($('add-modal').querySelector('.modal-panel'));
  if (!focusable.length) return;
  const first=focusable[0], last=focusable[focusable.length-1];
  if (event.shiftKey && document.activeElement===first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement===last) { event.preventDefault(); first.focus(); }
}
function openAddModal() {
  lastFocusedBeforeModal=document.activeElement;
  modalSpine=REDS[0][0];
  modalInk=REDS[0][1];
  modalRating=0;
  modalShelf='toRead';
  $('add-form').reset();
  renderModalPickers();
  $('add-modal').hidden=false;
  document.addEventListener('keydown',modalKeydown);
  $('add-title').focus();
}
function closeAddModal() {
  $('add-modal').hidden=true;
  document.removeEventListener('keydown',modalKeydown);
  lastFocusedBeforeModal?.focus?.();
}
function submitAddForm(event) {
  event.preventDefault();
  const title=$('add-title').value.trim(), author=$('add-author').value.trim();
  if (!title || !author) return;
  const spine=modalSpine||REDS[0][0], ink=modalInk||REDS[0][1];
  const book={ id:`custom-${Date.now()}`, title, author, year:new Date().getFullYear(), rating:modalRating, pages:0, finished:modalShelf==='read'?'Marked read':'Added today', genre:classify(title), spine, ink, cover:'', rereadCount:0 };
  const targetArray=modalShelf==='read'?state.books:state.toRead;
  targetArray.unshift(book);
  saveLibrary();
  filter();
  closeAddModal();
}

async function init() {
  const { data:dbRows, error }=await supabaseClient.from('books').select('*').order('position',{ascending:true});
  if(error) console.error('Supabase load failed', error);
  if(dbRows?.length) {
    state.books=dbRows.filter(r=>r.shelf==='read').map(fromDbRow);
    state.toRead=dbRows.filter(r=>r.shelf==='toRead').map(fromDbRow);
  } else {
    const text=await fetch('goodreads_library_export.csv').then(r=>r.text());
    const rows=parseCSV(text);
    const importedRead=rows.filter(r=>r['Exclusive Shelf']==='read'||r['Exclusive Shelf']==='currently-reading').map(makeBook);
    const importedToRead=rows.filter(r=>r['Exclusive Shelf']==='to-read').map(makeBook);
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(saved?.books?.length||saved?.toRead?.length){state.books=saved.books||[];state.toRead=saved.toRead||[];}
    else {state.books=importedRead;state.toRead=importedToRead;}
    await saveLibrary();
  }
  shelves.read=createEndlessShelf($('shelf'),'read',()=>state.filtered);
  shelves.toRead=createEndlessShelf($('to-read-shelf'),'toRead',()=>state.toRead);
  renderGenres();
  filter();
  hydrateCovers();
}

document.querySelectorAll('.sort-row').forEach(control=>control.querySelectorAll('button').forEach(button=>button.onclick=()=>sortShelf(control.dataset.sortShelf,button.dataset.sort)));
document.querySelectorAll('.shelf-nudge').forEach(button=>button.onclick=()=>{ shelves[button.dataset.shelf]?.nudge(Number(button.dataset.dir)); });
$('nav-add-book').onclick=openAddModal;
$('add-modal-close').onclick=closeAddModal;
$('add-modal').addEventListener('click',event=>{ if(event.target.id==='add-modal') closeAddModal(); });
$('add-form').addEventListener('submit',submitAddForm);
document.addEventListener('keydown',e=>{
  if(!$('add-modal').hidden) return;
  if(e.key==='Escape')closeDetail();
  if(!$('detail').hidden&&(e.key==='ArrowLeft'||e.key==='ArrowRight'))moveDetail(e.key==='ArrowLeft'?-1:1);
});
init().catch(error=>{console.error('Library failed to load',error); $('empty').hidden=false; $('empty').textContent='Could not load the library.';});
