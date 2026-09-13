const STORAGE_KEY = 'library-state-v2';
const state = { books: [], toRead: [], filtered: [], genre: 'All', query: '', selected: 0, detailBooks: [] };
let pointerDrag = null;
let lastFocusedBeforeModal = null;
let modalSpine = '';
let modalRating = 0;
const $ = (id) => document.getElementById(id);
const SPINES = { sage: '#9DAF9F', grey: '#6F7170', maroon: '#37101B', red: '#8E1319', cream: '#EDEAE3', deep: '#2B0A12' };
const SPINE_LIST = Object.values(SPINES);
const LIGHT_SPINES = new Set([SPINES.sage, SPINES.grey, SPINES.cream]);
function inkFor(bg) { return LIGHT_SPINES.has(bg) ? '#1B0F14' : '#EDEAE3'; }
function hash(value) { let h=0; for (let i=0;i<value.length;i++) h=(h*31+value.charCodeAt(i))|0; return Math.abs(h); }
function parseCSV(text) { const rows=[]; let row=[], cell='', quoted=false; for(let i=0;i<text.length;i++){const c=text[i], n=text[i+1]; if(c==='"'&&quoted&&n==='"'){cell+='"';i++;} else if(c==='"'){quoted=!quoted;} else if(c===','&&!quoted){row.push(cell);cell='';} else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&n==='\n')i++;row.push(cell); if(row.some(Boolean))rows.push(row);row=[];cell='';} else cell+=c;} if(cell||row.length){row.push(cell);rows.push(row);} const head=rows.shift(); return rows.map(values=>Object.fromEntries(head.map((key,i)=>[key,values[i]||'']))); }
function normalizeText(value) { return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').trim(); }
function sameAuthor(left, right) { return normalizeText(left).replaceAll(' ','')===normalizeText(right).replaceAll(' ',''); }
function baseTitle(value) { return normalizeText(value.split(' (')[0]); }
function spineName(value) { const clean=value.split(' (')[0].split(':')[0].trim(); return clean.length>15?`${clean.slice(0,14).trimEnd()}…`:clean; }
function classify(title) { const t=title.toLowerCase(); if(/harry potter|witch|magic|dragon|fantasy|throne|kingdom/.test(t)) return 'Fantasy'; if(/love|heart|romance|girl|woman|wife/.test(t)) return 'Romance'; if(/murder|crime|death|killer|mystery|detective/.test(t)) return 'Mystery & Thriller'; if(/science|space|dune|mars|robot/.test(t)) return 'Sci-Fi'; return 'Fiction'; }
function makeBook(r, i) { const h=hash(r['Book Id']||r.Title), spine=SPINE_LIST[h%SPINE_LIST.length], pages=Number(r['Number of Pages'])||300, date=r['Date Read']?new Date(r['Date Read'].replaceAll('/','-')).toLocaleDateString('en-US',{month:'short',year:'numeric'}):'In progress'; return { id:r['Book Id']||String(i), title:r.Title, author:r.Author, year:Number(r['Original Publication Year']||r['Year Published'])||0, rating:Number(r['My Rating'])||0, pages, finished:date, genre:classify(r.Title), spine, ink:inkFor(spine), cover:'', rereadCount:0 }; }
async function hydrateCovers() { let pending=false; const scheduleRender=()=>{ if(pending)return; pending=true; requestAnimationFrame(()=>{pending=false; renderShelf();}); }; await Promise.all([...state.books,...state.toRead].map(async book => { try { const query=`https://openlibrary.org/search.json?title=${encodeURIComponent(book.title.split(' (')[0])}&author=${encodeURIComponent(book.author)}&limit=12&fields=title,author_name,cover_i`; const data=await fetch(query).then(r=>r.json()); const wantedTitle=baseTitle(book.title); const match=data.docs.find(doc=>doc.cover_i&&baseTitle(doc.title||'')===wantedTitle&&Array.isArray(doc.author_name)&&doc.author_name.some(author=>sameAuthor(author,book.author))); if(match) { book.cover=`https://covers.openlibrary.org/b/id/${match.cover_i}-L.jpg`; scheduleRender(); } } catch(error) { /* Keep the verified fallback empty when lookup is unavailable. */ } })); renderShelf(); }
function renderGenres() { const counts={All:state.books.length}; state.books.forEach(b=>counts[b.genre]=(counts[b.genre]||0)+1); $('genre-list').innerHTML=Object.entries(counts).sort((a,b)=>a[0]==='All'?-1:b[0]==='All'?1:b[1]-a[1]).map(([name,count])=>`<button class="genre ${state.genre===name?'active':''}" data-genre="${name}">${name} <small>${count}</small></button>`).join(''); document.querySelectorAll('.genre').forEach(b=>b.onclick=()=>{state.genre=b.dataset.genre; filter();}); }
function filter() { const q=state.query.toLowerCase().trim(); state.filtered=state.books.filter(b=>(state.genre==='All'||b.genre===state.genre)&&(!q||`${b.title} ${b.author} ${b.genre}`.toLowerCase().includes(q))); renderGenres(); renderShelf(); }
function toDbRow(b, shelf, position) { return { id:b.id, title:b.title, author:b.author, genre:b.genre||'Fiction', year:b.year||null, pages:b.pages||0, rating:b.rating||0, finished:b.finished||'In progress', spine:b.spine, ink:b.ink, cover:b.cover||'', reread_count:b.rereadCount||0, note:b.note||null, shelf, position }; }
function fromDbRow(r) { return { id:r.id, title:r.title, author:r.author, genre:r.genre, year:r.year||0, pages:r.pages||0, rating:r.rating||0, finished:r.finished, spine:r.spine, ink:r.ink, cover:r.cover||'', rereadCount:r.reread_count||0, note:r.note||undefined }; }
async function saveLibrary() {
  const rows=[...state.books.map((b,i)=>toDbRow(b,'read',i)), ...state.toRead.map((b,i)=>toDbRow(b,'toRead',i))];
  if(!rows.length) return;
  const { error }=await supabaseClient.from('books').upsert(rows);
  if(error) console.error('Supabase save failed', error);
}
function moveBook(id, from, to) { const source=from==='toRead'?state.toRead:state.books; const target=to==='toRead'?state.toRead:state.books; const index=source.findIndex(book=>book.id===id); if(index<0||source===target)return; const [book]=source.splice(index,1); if(to==='read') book.finished='Marked read'; target.unshift(book); saveLibrary(); filter(); const destination=$(to==='toRead'?'to-read-shelf':'shelf'); destination.classList.add('drop-success'); setTimeout(()=>destination.classList.remove('drop-success'),900); }
function reorderBook(id, shelfName, targetId) { const books=shelfName==='toRead'?state.toRead:state.books; const from=books.findIndex(book=>book.id===id); const to=books.findIndex(book=>book.id===targetId); if(from<0||to<0||from===to)return; const [book]=books.splice(from,1); books.splice(to,0,book); saveLibrary(); filter(); const shelf=$(shelfName==='toRead'?'to-read-shelf':'shelf'); shelf.classList.add('drop-success'); setTimeout(()=>shelf.classList.remove('drop-success'),900); }
function sortShelf(shelfName, mode) { const books=shelfName==='toRead'?state.toRead:state.books; if(mode==='random'){for(let i=books.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[books[i],books[j]]=[books[j],books[i]];}} else {books.sort((a,b)=>String(a[mode==='author'?'author':'title']).localeCompare(String(b[mode==='author'?'author':'title'])));} saveLibrary(); filter(); const shelf=$(shelfName==='toRead'?'to-read-shelf':'shelf'); shelf.classList.add('drop-success'); setTimeout(()=>shelf.classList.remove('drop-success'),900); }

function diamondsHtml(rating) { return [1,2,3,4,5].map(v=>`<button type="button" class="rating-diamond ${v<=rating?'filled':''}" data-rating="${v}" aria-label="Rate ${v} out of 5"></button>`).join(''); }

function renderBookShelf(id, books, shelfName) {
  const shelf=$(id);
  shelf.innerHTML=books.map((b,i)=>{
    const h=hash(b.id), height=288+(h%108), width=30+(h%15), label=spineName(b.title), coverVar=b.cover?`;--cover:url('${b.cover.replace(/'/g,"\\'")}')`:'';
    return `<div class="spine-wrap" style="--h:${height}px;--w:${width}px"><button class="book" draggable="true" data-book-id="${b.id}" data-index="${i}" data-shelf="${shelfName}" aria-label="${b.title} by ${b.author}"><span class="spine-face${b.cover?' has-cover':''}" style="--spine:${b.spine};--ink-color:${b.ink}${coverVar}"><span class="spine-rule"></span><span class="spine-title" title="${b.title}">${label}</span><span class="spine-author">${b.author}</span></span></button></div>`;
  }).join('');
  shelf.querySelectorAll('.book').forEach(el=>{
    el.onclick=event=>{if(el.dataset.dragged==='true'){el.dataset.dragged='false';return;} openDetail(Number(el.dataset.index), el.dataset.shelf);};
    el.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/library-book',JSON.stringify({id:el.dataset.bookId,from:el.dataset.shelf})); event.dataTransfer.effectAllowed='move'; el.classList.add('is-dragging');});
    el.addEventListener('dragenter',event=>{event.preventDefault(); event.stopPropagation(); document.querySelectorAll('.drag-insert').forEach(slot=>slot.classList.remove('drag-insert')); if(!event.currentTarget.classList.contains('is-dragging')) el.closest('.spine-wrap')?.classList.add('drag-insert');});
    el.addEventListener('dragover',event=>{event.preventDefault(); event.stopPropagation();});
    el.addEventListener('dragleave',event=>{if(!el.contains(event.relatedTarget))el.closest('.spine-wrap')?.classList.remove('drag-insert');});
    el.addEventListener('drop',event=>{event.preventDefault(); event.stopPropagation(); el.closest('.spine-wrap')?.classList.remove('drag-insert'); const data=JSON.parse(event.dataTransfer.getData('text/library-book')||'{}'); if(data.id&&data.id!==el.dataset.bookId){if(data.from===el.dataset.shelf)reorderBook(data.id,data.from,el.dataset.bookId);else moveBook(data.id,data.from,el.dataset.shelf);}});
    el.addEventListener('dragend',()=>{el.classList.remove('is-dragging'); document.querySelectorAll('.drag-insert').forEach(slot=>slot.classList.remove('drag-insert'));});
  });
}
function shelfFooterStat(books) { return `${books.length} VOLUMES · ${new Set(books.map(book=>book.author)).size} AUTHORS`; }
function renderShelf() {
  $('empty').hidden=state.filtered.length>0;
  renderBookShelf('shelf',state.filtered,'read');
  renderBookShelf('to-read-shelf',state.toRead,'toRead');
  $('read-found').textContent=`${state.filtered.length} FOUND`;
  $('toread-found').textContent=`${state.toRead.length} WAITING`;
  $('read-stat').textContent=shelfFooterStat(state.filtered);
  $('to-read-stat').textContent=shelfFooterStat(state.toRead);
  const allBooks=[...state.books,...state.toRead];
  $('total-count').textContent=allBooks.length;
  $('total-stat').textContent=`VOLUMES · ${new Set(allBooks.map(b=>b.author)).size} AUTHORS`;
}

function neighboursFor(list, index) {
  const span=3, start=Math.max(0,index-span), end=Math.min(list.length,index+span+1);
  return list.slice(start,index).concat(list.slice(index+1,end)).slice(0,7);
}

function openDetail(index, shelfName='read') {
  state.detailBooks=shelfName==='toRead'?state.toRead:state.filtered;
  state.selected=index;
  const list=state.detailBooks, b=list[index], rating=b.rating||0;
  const neighbours=neighboursFor(list,index);
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
        <div class="detail-cover" style="--spine:${b.spine}">${coverHtml}</div>
        <div class="detail-actions-row">
          <button class="btn-primary" id="mark-reread">${b.rereadCount?`Re-read ${b.rereadCount}×`:'Mark as re-read'}</button>
          <button class="btn-secondary" id="detail-add">+ Add</button>
        </div>
      </div>
      <div>
        <div class="detail-meta">${shelfName==='toRead'?'TO BE READ':`READ ${String(b.finished).toUpperCase()}`} · ${b.pages} PAGES · ${shelfName==='toRead'?'WISHLIST':'KEPT'}</div>
        <h2 class="detail-title" contenteditable="true" spellcheck="false" data-field="title">${b.title}</h2>
        <div class="detail-author" contenteditable="true" spellcheck="false" data-field="author">${b.author}</div>
        <div class="rating-box"><span>MY RATING</span><div class="rating-diamonds">${diamondsHtml(rating)}</div><span class="rating-readout">${rating||'—'} / 5</span></div>
        <div class="note-label">NOTE</div>
        <p class="detail-note" contenteditable="true" spellcheck="false" data-field="note" data-placeholder="Click to add a note…">${b.note||''}</p>
        <div class="detail-tags"><span>${b.genre}</span><span>${shelfName==='toRead'?'To be read':'Kept'}</span><span>${b.pages} pages</span></div>
        <div class="sits-between">
          <div class="sits-between-label">SITS BETWEEN</div>
          <div class="sits-between-row">
            ${neighbours.map(n=>`<button class="neighbour-spine" data-book-id="${n.id}" style="width:${18+(hash(n.id)%14)}px;height:${Math.round((288+(hash(n.id)%108))*.38)}px;background-color:${n.spine};${n.cover?`background-image:url('${n.cover.replace(/'/g,"\\'")}')`:''}" aria-label="${n.title}"></button>`).join('')}
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
  document.querySelectorAll('.neighbour-spine').forEach(el=>el.onclick=()=>{ const targetId=el.dataset.bookId; const targetIndex=list.findIndex(book=>book.id===targetId); if(targetIndex>=0) openDetail(targetIndex,shelfName); });
}
function closeDetail() { $('detail').hidden=true; }
function moveDetail(delta) { const next=(state.selected+delta+state.detailBooks.length)%state.detailBooks.length; openDetail(next, state.detailBooks===state.toRead?'toRead':'read'); }

function swatchesHtml() { return SPINE_LIST.map(c=>`<button type="button" class="swatch ${c===modalSpine?'selected':''}" data-spine="${c}" style="background:${c}" aria-label="Spine colour"></button>`).join(''); }
function renderModalPickers() {
  $('add-spine-swatches').innerHTML=swatchesHtml();
  $('add-spine-swatches').querySelectorAll('.swatch').forEach(sw=>sw.onclick=()=>{ modalSpine=sw.dataset.spine; renderModalPickers(); });
  $('add-rating-diamonds').innerHTML=diamondsHtml(modalRating);
  $('add-rating-diamonds').querySelectorAll('.rating-diamond').forEach(d=>d.onclick=()=>{ modalRating=Number(d.dataset.rating); renderModalPickers(); });
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
  modalSpine=SPINE_LIST[0];
  modalRating=0;
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
  const spine=modalSpine||SPINE_LIST[0];
  const book={ id:`custom-${Date.now()}`, title, author, year:new Date().getFullYear(), rating:modalRating, pages:0, finished:'Added today', genre:classify(title), spine, ink:inkFor(spine), cover:'', rereadCount:0 };
  state.toRead.unshift(book);
  saveLibrary();
  renderShelf();
  closeAddModal();
  $('to-read-shelf').scrollTo({left:0,behavior:'smooth'});
}

function setupPointerDrag() {
  const updateDrag=()=>{
    if(!pointerDrag)return;
    pointerDrag.raf=0;
    const dx=pointerDrag.x-pointerDrag.startX, dy=Math.min(0,pointerDrag.y-pointerDrag.startY);
    pointerDrag.book.style.transform=`translate(${dx*0.5}px, ${Math.max(dy,-90)}px) rotate(${dx*0.06}deg)`;
    const hovered=document.elementFromPoint(pointerDrag.x,pointerDrag.y);
    const targetBook=hovered?.closest('.book');
    const target=hovered?.closest('.drop-shelf');
    if(pointerDrag.targetBook!==targetBook){pointerDrag.targetBook?.closest('.spine-wrap')?.classList.remove('drag-insert'); if(targetBook&&targetBook!==pointerDrag.book)targetBook.closest('.spine-wrap')?.classList.add('drag-insert'); pointerDrag.targetBook=targetBook;}
    if(pointerDrag.target!==target){pointerDrag.target?.classList.remove('drag-target'); if(target&&!targetBook)target.classList.add('drag-target'); pointerDrag.target=target;}
  };
  document.addEventListener('pointerdown',event=>{
    const book=event.target.closest('.book'); if(!book)return;
    book.setPointerCapture?.(event.pointerId);
    pointerDrag={book,id:book.dataset.bookId,from:book.dataset.shelf,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,moved:false,target:null,targetBook:null,raf:0,pointerId:event.pointerId};
  });
  document.addEventListener('pointermove',event=>{
    if(!pointerDrag||event.pointerId!==pointerDrag.pointerId)return;
    const distance=Math.hypot(event.clientX-pointerDrag.startX,event.clientY-pointerDrag.startY);
    if(distance<8)return;
    if(!pointerDrag.moved){ pointerDrag.book.style.transition='none'; pointerDrag.book.style.zIndex='30'; pointerDrag.book.style.cursor='grabbing'; }
    pointerDrag.moved=true;
    document.body.classList.add('is-dragging-shelf');
    pointerDrag.book.classList.add('is-dragging');
    pointerDrag.x=event.clientX; pointerDrag.y=event.clientY;
    if(!pointerDrag.raf)pointerDrag.raf=requestAnimationFrame(updateDrag);
    event.preventDefault();
  },{passive:false});
  const finish=()=>{
    if(!pointerDrag)return;
    const drag=pointerDrag;
    if(drag.raf)cancelAnimationFrame(drag.raf);
    drag.target?.classList.remove('drag-target');
    drag.targetBook?.closest('.spine-wrap')?.classList.remove('drag-insert');
    drag.book.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging-shelf');
    if(drag.moved){
      drag.book.style.transition='transform .5s cubic-bezier(.24,1.4,.3,1)';
      drag.book.style.transform='';
      drag.book.style.cursor='';
      setTimeout(()=>{ drag.book.style.zIndex=''; drag.book.style.transition=''; },500);
      drag.book.dataset.dragged='true';
      if(drag.targetBook&&drag.targetBook!==drag.book)reorderBook(drag.id,drag.from,drag.targetBook.dataset.bookId);
      else if(drag.target&&drag.target.dataset.shelf!==drag.from)moveBook(drag.id,drag.from,drag.target.dataset.shelf);
    }
    pointerDrag=null;
  };
  document.addEventListener('pointerup',finish);
  document.addEventListener('pointercancel',finish);
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
  renderGenres();
  filter();
  hydrateCovers();
}

document.querySelectorAll('.sort-row').forEach(control=>control.querySelectorAll('button').forEach(button=>button.onclick=()=>sortShelf(control.dataset.sortShelf,button.dataset.sort)));
$('nav-add-book').onclick=openAddModal;
$('add-modal-close').onclick=closeAddModal;
$('add-modal').addEventListener('click',event=>{ if(event.target.id==='add-modal') closeAddModal(); });
$('add-form').addEventListener('submit',submitAddForm);
setupPointerDrag();
document.querySelectorAll('.drop-shelf').forEach(shelf=>{
  shelf.addEventListener('dragover',event=>{event.preventDefault(); shelf.classList.add('drag-target');});
  shelf.addEventListener('dragleave',event=>{if(!shelf.contains(event.relatedTarget)) shelf.classList.remove('drag-target');});
  shelf.addEventListener('drop',event=>{event.preventDefault(); shelf.classList.remove('drag-target'); const data=JSON.parse(event.dataTransfer.getData('text/library-book')||'{}'); if(data.id) moveBook(data.id,data.from,shelf.dataset.shelf);});
});
document.addEventListener('keydown',e=>{
  if(!$('add-modal').hidden) return;
  if(e.key==='Escape')closeDetail();
  if(!$('detail').hidden&&(e.key==='ArrowLeft'||e.key==='ArrowRight'))moveDetail(e.key==='ArrowLeft'?-1:1);
});
$('shelf').addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){e.preventDefault();$('shelf').scrollLeft+=e.deltaY;}},{passive:false});
init().catch(()=>{$('read-stat').textContent='Could not load the library';});
