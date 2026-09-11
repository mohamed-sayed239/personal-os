/* =========================================================
   Personal OS — Clients Module v4.0
   Tiered pricing + Status + Tags + Bulk + CSV
   ========================================================= */

const KEYS = {
  clients:  'po_clients',
  works:    'po_works',
  services: 'po_services',
};

const Store = {
  get(key, fallback = []) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) ?? fallback;
    } catch { return fallback; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nf  = new Intl.NumberFormat('en-US');
const money = n => nf.format(Math.round(n)) + ' ج.م';
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = s => {
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
};

const WORK_STATUS = {
  draft:     { label: '📝 مسودة',      cls: 'draft' },
  review:    { label: '🔍 مراجعة',      cls: 'review' },
  delivered: { label: '✅ تم التسليم',  cls: 'delivered' },
  paid:      { label: '💰 مدفوع',       cls: 'paid' },
};

const CLIENT_STATUS = {
  active:   { label: 'نشط',       cls: 'active' },
  inactive: { label: 'غير نشط',   cls: 'inactive' },
  vip:      { label: 'VIP',       cls: 'vip' },
};

/* ---------- Data ---------- */
const getClients  = () => Store.get(KEYS.clients);
const saveClients = c => Store.set(KEYS.clients, c);
const getWorks    = () => Store.get(KEYS.works);
const saveWorks   = w => Store.set(KEYS.works, w);

/* ---------- Normalization for backward compat ---------- */
function normalizeWork(w) {
  return {
    ...w,
    status: w.status || 'delivered',
    notes: w.notes || '',
  };
}
function normalizeClient(c) {
  return {
    ...c,
    status: c.status || 'active',
    tags: Array.isArray(c.tags) ? c.tags : [],
  };
}

function getWorksNorm()   { return getWorks().map(normalizeWork); }
function getClientsNorm() { return getClients().map(normalizeClient); }

/* =========================================================
   TIER LOGIC (unchanged)
   ========================================================= */
function normalizeService(svc) {
  if (svc.tiers && Array.isArray(svc.tiers) && svc.tiers.length) {
    return {
      id: svc.id,
      name: svc.name,
      tiers: svc.tiers
        .map(t => ({ minQty: Number(t.minQty) || 1, price: Number(t.price) || 0 }))
        .sort((a, b) => a.minQty - b.minQty),
    };
  }
  return {
    id: svc.id,
    name: svc.name,
    tiers: [{ minQty: 1, price: Number(svc.price) || 0 }],
  };
}
function getServices() {
  return Store.get(KEYS.services, []).map(normalizeService);
}
const saveServices = arr => Store.set(KEYS.services, arr);

function getPriceForQty(service, qty) {
  const tiers = service.tiers && service.tiers.length
    ? [...service.tiers].sort((a, b) => b.minQty - a.minQty)
    : [{ minQty: 1, price: Number(service.price) || 0 }];
  for (const t of tiers) {
    if (qty >= t.minQty) return t.price;
  }
  return tiers[tiers.length - 1]?.price || 0;
}

function getTierForQty(service, qty) {
  const tiers = service.tiers && service.tiers.length
    ? [...service.tiers].sort((a, b) => b.minQty - a.minQty)
    : [{ minQty: 1, price: Number(service.price) || 0 }];
  for (const t of tiers) {
    if (qty >= t.minQty) return t;
  }
  return tiers[tiers.length - 1];
}

/* ---------- State ---------- */
const state = {
  currentClientId: null,
  editingClientId: null,
  editingWorkId:   null,
  editingServiceId: null,
  draftQuantities: {},
  draftPriceOverrides: {},
  editingPriceId: null,
  customService: null,
  draftTiers: null,
  draftClientTags: [],
  draftClientStatus: 'active',
  currentPage: 1,
  pageSize: 10,
  sortBy: 'date-desc',
  /* client list filters */
  clientSearch: '',
  clientStatusFilter: '',
  clientSort: 'activity-desc',
  /* works filters */
  workStatusFilter: '',
  /* bulk */
  selectedWorks: new Set(),
};

/* =========================================================
   VIEW: LIST
   ========================================================= */
function renderClientsList() {
  const allClients = getClientsNorm();
  const grid  = document.getElementById('clientsGrid');
  const empty = document.getElementById('clientsEmpty');
  const noRes = document.getElementById('clientsNoResults');
  const sub   = document.getElementById('clientsSub');
  const count = document.getElementById('clientsCount');

  sub.textContent = allClients.length
    ? `${allClients.length} عميل مسجّل`
    : 'لا يوجد عملاء بعد';

  /* Apply filters */
  const search = state.clientSearch.trim().toLowerCase();
  let clients = [...allClients];

  if (search) {
    clients = clients.filter(c =>
      (c.name || '').toLowerCase().includes(search) ||
      (c.company || '').toLowerCase().includes(search) ||
      (c.phone || '').toLowerCase().includes(search) ||
      (c.tags || []).some(t => t.toLowerCase().includes(search))
    );
  }

  if (state.clientStatusFilter) {
    clients = clients.filter(c => c.status === state.clientStatusFilter);
  }

  /* Compute aggregates for sorting */
  const allWorks = getWorksNorm();
  const enriched = clients.map(c => {
    const cw = allWorks.filter(w => w.clientId === c.id);
    const total = cw.reduce((s, w) => s + (Number(w.total) || 0), 0);
    const last = cw.map(w => w.date).sort().pop() || c.createdAt || '';
    return { ...c, _works: cw, _total: total, _last: last };
  });

  /* Apply sort */
  switch (state.clientSort) {
    case 'revenue-desc': enriched.sort((a, b) => b._total - a._total); break;
    case 'revenue-asc':  enriched.sort((a, b) => a._total - b._total); break;
    case 'name-asc':     enriched.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break;
    case 'name-desc':    enriched.sort((a, b) => (b.name || '').localeCompare(a.name || '')); break;
    case 'created-desc': enriched.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); break;
    case 'activity-desc':
    default:             enriched.sort((a, b) => (b._last || '').localeCompare(a._last || ''));
  }

  count.textContent = `${enriched.length} / ${allClients.length}`;

  /* Render */
  grid.innerHTML = '';

  if (!allClients.length) {
    empty.hidden = false;
    noRes.hidden = true;
    return;
  }
  empty.hidden = true;

  if (!enriched.length) {
    noRes.hidden = false;
    return;
  }
  noRes.hidden = true;

  for (const c of enriched) {
    const cw = c._works;
    const total = c._total;
    const last  = c._last;
    const status = CLIENT_STATUS[c.status] || CLIENT_STATUS.active;
    const tagsHTML = (c.tags || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('');

    const card = document.createElement('article');
    card.className = 'client-card';
    card.innerHTML = `
      <div class="client-card-head">
        <div class="client-avatar">${escapeHtml((c.name || '?').trim().charAt(0).toUpperCase())}</div>
        <div class="client-card-info">
          <div class="client-card-name">
            ${escapeHtml(c.name)}
            <span class="client-status-dot ${status.cls}" title="${status.label}" style="margin-right:4px;"></span>
          </div>
          <div class="client-card-sub">${escapeHtml(c.company || 'عميل مستقل')}</div>
          ${tagsHTML ? `<div style="margin-top:6px;">${tagsHTML}</div>` : ''}
        </div>
      </div>
      <div class="client-card-stats">
        <div>
          <div class="ccs-label">إجمالي الإيراد</div>
          <div class="ccs-value ccs-green">${money(total)}</div>
        </div>
        <div>
          <div class="ccs-label">الأعمال</div>
          <div class="ccs-value">${nf.format(cw.length)}</div>
        </div>
      </div>
      <div class="client-card-foot">
        <span>${last ? 'آخر عمل: ' + fmtDate(last) : 'لا يوجد نشاط بعد'}</span>
        <span class="link-open">فتح ←</span>
      </div>
    `;
    card.addEventListener('click', () => openClient(c.id));
    grid.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

/* =========================================================
   VIEW: DETAIL
   ========================================================= */
function openClient(id) {
  state.currentClientId = id;
  state.draftQuantities = {};
  state.draftPriceOverrides = {};
  state.editingWorkId = null;
  state.editingPriceId = null;
  state.currentPage = 1;
  state.selectedWorks = new Set();
  state.workStatusFilter = '';

  document.getElementById('listView').hidden = true;
  document.getElementById('detailView').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  renderClientDetail();
}

function closeClient() {
  state.currentClientId = null;
  document.getElementById('detailView').hidden = true;
  document.getElementById('listView').hidden = false;
  state.selectedWorks = new Set();
  renderClientsList();
}

function renderClientDetail() {
  const client = getClientsNorm().find(c => c.id === state.currentClientId);
  if (!client) return closeClient();

  const works = getWorksNorm().filter(w => w.clientId === client.id);

  /* Header */
  const status = CLIENT_STATUS[client.status] || CLIENT_STATUS.active;
  document.getElementById('detailName').innerHTML =
    escapeHtml(client.name) + ` <span class="client-status-dot ${status.cls}" style="margin-right:6px;vertical-align:middle;"></span>`;

  const meta = [];
  if (client.company) meta.push(client.company);
  if (client.phone)   meta.push(client.phone);
  if (client.tags && client.tags.length) meta.push('🏷 ' + client.tags.join(', '));
  document.getElementById('detailMeta').textContent = meta.join(' • ') || '—';

  /* Stats */
  const total = works.reduce((s, w) => s + (Number(w.total) || 0), 0);
  const avg   = works.length ? total / works.length : 0;
  const last  = works.map(w => w.date).sort().pop();

  document.getElementById('statTotal').textContent = money(total);
  document.getElementById('statWorks').textContent = nf.format(works.length);
  document.getElementById('statAvg').textContent   = money(avg);
  document.getElementById('statLast').textContent  = last ? fmtDate(last) : '—';

  /* Status distribution */
  renderStatusDist(works);

  /* Form reset */
  if (!state.editingWorkId) {
    document.getElementById('workDate').value = today();
    document.getElementById('productCode').value = '';
    document.getElementById('workNotes').value = '';
    document.getElementById('workStatus').value = 'delivered';
  }
  renderServicesBuilder();
  updateWorkTotal();
  updateWorkFormUI();
  renderWorksTable();
}

function renderStatusDist(works) {
  const el = document.getElementById('statusDist');
  const counts = { draft: 0, review: 0, delivered: 0, paid: 0 };
  const sums   = { draft: 0, review: 0, delivered: 0, paid: 0 };

  for (const w of works) {
    const st = w.status || 'delivered';
    if (counts[st] !== undefined) {
      counts[st] += 1;
      sums[st] += Number(w.total) || 0;
    }
  }

  el.innerHTML = '';
  for (const key of ['draft','review','delivered','paid']) {
    const info = WORK_STATUS[key];
    const box = document.createElement('div');
    box.className = 'status-dist-box';
    box.innerHTML = `
      <div class="status-dist-label">${info.label}</div>
      <div class="status-dist-value" style="color:${getStatusColor(key)};">${counts[key]}</div>
      <div style="font-size:10px;color:#5a6378;margin-top:2px;">${sums[key] > 0 ? money(sums[key]) : '—'}</div>
    `;
    el.appendChild(box);
  }
}

function getStatusColor(status) {
  switch (status) {
    case 'draft':     return '#94a3b8';
    case 'review':    return '#fbbf24';
    case 'delivered': return '#38bdf8';
    case 'paid':      return '#4ade80';
    default:          return '#8892a6';
  }
}

/* =========================================================
   SERVICES BUILDER (unchanged + tiers + override)
   ========================================================= */
function renderServicesBuilder() {
  const el = document.getElementById('servicesBuilder');
  const services = getServices();
  el.innerHTML = '';

  const list = [...services];
  if (state.customService) {
    list.push({
      id: '__custom__',
      name: state.customService.name,
      tiers: [{ minQty: 1, price: state.customService.price }],
    });
  }

  if (!list.length) {
    el.innerHTML = `<div class="empty-mini" style="padding:20px;text-align:center;color:#8892a6;font-size:14px">
      لا توجد خدمات بعد — اضغط "＋ خدمة جديدة" أو "⚙ إدارة الخدمات" لإضافة أول خدمة.
    </div>`;
    return;
  }

  for (const svc of list) {
    const isCustom = svc.id === '__custom__';
    const qty = state.draftQuantities[svc.id] || 0;

    const tierPrice = getPriceForQty(svc, qty || 1);
    const hasOverride = state.draftPriceOverrides[svc.id] !== undefined;
    const appliedPrice = hasOverride ? state.draftPriceOverrides[svc.id] : tierPrice;
    const subtotal = qty * appliedPrice;

    const applicableTier = getTierForQty(svc, qty || 1);
    const nextTier = (svc.tiers || []).find(t => t.minQty > qty);

    const row = document.createElement('div');
    row.className = 'service-row' + (qty > 0 ? ' active' : '');
    row.dataset.id = svc.id;

    let priceLineHTML;
    if (state.editingPriceId === svc.id) {
      priceLineHTML = `
        <div class="unit-price-line">
          <input type="number" class="unit-price-input" id="price-input-${svc.id}"
                 value="${appliedPrice}" min="0" step="1" />
          <span class="unit-price-text">ج.م/وحدة</span>
        </div>
      `;
    } else {
      priceLineHTML = `
        <div class="unit-price-line">
          <span class="unit-price-text ${hasOverride ? 'overridden' : ''}">
            ${nf.format(appliedPrice)} ج.م/وحدة
          </span>
          ${!isCustom ? `<button type="button" class="edit-price-btn" data-id="${svc.id}" title="تعديل السعر لهذا العمل">✎</button>` : ''}
          ${hasOverride ? `<button type="button" class="reset-price-btn" data-id="${svc.id}" title="استخدام سعر المستوى">↺</button>` : ''}
        </div>
      `;
    }

    let tierHint = '';
    if (!isCustom && svc.tiers && svc.tiers.length > 1) {
      tierHint = `<span class="tier-badge">من ${applicableTier.minQty}</span>`;
      if (nextTier) {
        tierHint += `<span style="font-size:10px;color:#5a6378;">خصم عند ${nextTier.minQty} → ${nf.format(nextTier.price)}</span>`;
      }
    }

    row.innerHTML = `
      <div class="service-info">
        <div class="service-name">${escapeHtml(svc.name)}</div>
        ${priceLineHTML}
        ${tierHint}
      </div>
      <div class="qty-ctrl">
        <button type="button" class="qty-btn" data-act="dec" data-id="${svc.id}">−</button>
        <span class="qty-val">${qty}</span>
        <button type="button" class="qty-btn" data-act="inc" data-id="${svc.id}">+</button>
      </div>
      <div class="service-subtotal">${money(subtotal)}</div>
    `;
    el.appendChild(row);
  }

  el.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id  = btn.dataset.id;
      const act = btn.dataset.act;
      const cur = state.draftQuantities[id] || 0;
      const next = act === 'inc' ? cur + 1 : Math.max(0, cur - 1);
      state.draftQuantities[id] = next;
      renderServicesBuilder();
      updateWorkTotal();
    });
  });

  el.querySelectorAll('.edit-price-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.editingPriceId = btn.dataset.id;
      renderServicesBuilder();
      setTimeout(() => {
        const input = document.getElementById(`price-input-${btn.dataset.id}`);
        if (input) { input.focus(); input.select(); }
      }, 30);
    });
  });

  el.querySelectorAll('.reset-price-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      delete state.draftPriceOverrides[btn.dataset.id];
      renderServicesBuilder();
      updateWorkTotal();
    });
  });

  const priceInput = el.querySelector('.unit-price-input');
  if (priceInput) {
    const id = priceInput.id.replace('price-input-', '');
    const commit = () => {
      const val = Number(priceInput.value);
      if (val > 0) {
        state.draftPriceOverrides[id] = val;
      } else {
        delete state.draftPriceOverrides[id];
      }
      state.editingPriceId = null;
      renderServicesBuilder();
      updateWorkTotal();
    };
    priceInput.addEventListener('blur', commit);
    priceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); priceInput.blur(); }
      if (e.key === 'Escape') {
        state.editingPriceId = null;
        renderServicesBuilder();
        updateWorkTotal();
      }
    });
  }
}

function updateWorkTotal() {
  const services = getServices();
  let total = 0;

  for (const svc of services) {
    const qty = state.draftQuantities[svc.id] || 0;
    if (qty === 0) continue;
    const tierPrice = getPriceForQty(svc, qty);
    const appliedPrice = state.draftPriceOverrides[svc.id] ?? tierPrice;
    total += qty * appliedPrice;
  }
  if (state.customService) {
    const qty = state.draftQuantities['__custom__'] || 0;
    if (qty > 0) {
      const price = state.draftPriceOverrides['__custom__'] ?? state.customService.price;
      total += qty * price;
    }
  }
  document.getElementById('workTotal').textContent = money(total);
}

function updateWorkFormUI() {
  const btn = document.getElementById('addWorkBtn');
  if (!btn) return;
  btn.textContent = state.editingWorkId ? '✓ حفظ التعديل' : '+ إضافة العمل';
}

/* =========================================================
   SERVICE MODAL — Tiers Editor
   ========================================================= */
function openServiceModal(serviceId = null) {
  state.editingServiceId = serviceId;
  const title = document.getElementById('serviceModalTitle');

  if (serviceId) {
    const s = getServices().find(x => x.id === serviceId);
    if (!s) return;
    title.textContent = 'تعديل الخدمة';
    document.getElementById('sName').value = s.name;
    state.draftTiers = s.tiers.map(t => ({ ...t }));
  } else {
    title.textContent = 'خدمة جديدة';
    document.getElementById('sName').value = '';
    state.draftTiers = [{ minQty: 1, price: '' }];
  }

  renderTiersEditor();
  document.getElementById('serviceModal').hidden = false;
  setTimeout(() => document.getElementById('sName').focus(), 50);
}

function renderTiersEditor() {
  const el = document.getElementById('tiersList');
  el.innerHTML = '';

  const tiers = state.draftTiers || [];
  const sorted = [...tiers].sort((a, b) => (Number(a.minQty) || 1) - (Number(b.minQty) || 1));

  sorted.forEach((tier, i) => {
    const isFirst = i === 0;
    const row = document.createElement('div');
    row.className = 'tier-row';
    row.innerHTML = `
      <span class="tl">من كمية</span>
      <input type="number" class="tier-min" value="${tier.minQty || ''}" min="1" step="1" ${isFirst ? 'readonly' : ''} />
      <span class="tl">← السعر</span>
      <input type="number" class="tier-price" value="${tier.price || ''}" min="1" step="1" />
      <span class="tl">ج.م/وحدة</span>
      <button type="button" class="tier-remove" ${sorted.length <= 1 ? 'disabled' : ''} data-idx="${i}">🗑</button>
    `;
    el.appendChild(row);
  });

  el.querySelectorAll('.tier-min').forEach(inp => {
    inp.addEventListener('input', () => {
      const row = inp.closest('.tier-row');
      const idx = [...el.children].indexOf(row);
      state.draftTiers[idx].minQty = Number(inp.value) || 1;
    });
  });

  el.querySelectorAll('.tier-price').forEach(inp => {
    inp.addEventListener('input', () => {
      const row = inp.closest('.tier-row');
      const idx = [...el.children].indexOf(row);
      state.draftTiers[idx].price = Number(inp.value) || 0;
    });
  });

  el.querySelectorAll('.tier-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      if (state.draftTiers.length <= 1) return;
      state.draftTiers.splice(idx, 1);
      if (state.draftTiers[0]) state.draftTiers[0].minQty = 1;
      renderTiersEditor();
    });
  });
}

function saveService() {
  const name = document.getElementById('sName').value.trim();
  if (!name) return alert('اسم الخدمة مطلوب');

  const tiers = (state.draftTiers || [])
    .map(t => ({
      minQty: Math.max(1, Number(t.minQty) || 1),
      price: Number(t.price) || 0,
    }))
    .filter(t => t.price > 0)
    .sort((a, b) => a.minQty - b.minQty);

  if (!tiers.length) return alert('أضف مستوى سعر واحد على الأقل بسعر أكبر من صفر');
  if (tiers[0].minQty !== 1) tiers[0].minQty = 1;

  const seen = new Set();
  const cleanTiers = [];
  for (const t of tiers) {
    if (seen.has(t.minQty)) continue;
    seen.add(t.minQty);
    cleanTiers.push(t);
  }

  const services = getServices();

  if (state.editingServiceId) {
    const idx = services.findIndex(s => s.id === state.editingServiceId);
    if (idx > -1) services[idx] = { ...services[idx], name, tiers: cleanTiers };
    saveServices(services);
    closeModal('serviceModal');
    renderServicesBuilder();
    updateWorkTotal();
    if (!document.getElementById('manageServicesModal').hidden) renderManageServicesList();
    flash('تم تحديث الخدمة ✓');
  } else {
    services.push({ id: uid(), name, tiers: cleanTiers });
    saveServices(services);
    closeModal('serviceModal');
    renderServicesBuilder();
    if (!document.getElementById('manageServicesModal').hidden) renderManageServicesList();
    flash('تم إضافة الخدمة ✓');
  }
  state.editingServiceId = null;
  state.draftTiers = null;
}

function deleteService(serviceId) {
  const services = getServices();
  const svc = services.find(s => s.id === serviceId);
  if (!svc) return;

  const usedInWorks = getWorks().some(w =>
    (w.services || []).some(s => s.name === svc.name));

  const msg = usedInWorks
    ? `الخدمة "${svc.name}" مستخدمة في أعمال سابقة (لن تتأثر).\nحذفها من القائمة؟`
    : `حذف الخدمة "${svc.name}"؟`;
  if (!confirm(msg)) return;

  saveServices(services.filter(s => s.id !== serviceId));
  delete state.draftQuantities[serviceId];
  delete state.draftPriceOverrides[serviceId];

  renderServicesBuilder();
  updateWorkTotal();
  if (!document.getElementById('manageServicesModal').hidden) renderManageServicesList();
  flash('تم حذف الخدمة');
}

function renderManageServicesList() {
  const el = document.getElementById('servicesManageList');
  const empty = document.getElementById('servicesManageEmpty');
  const services = getServices();

  if (!services.length) {
    el.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  el.innerHTML = '';
  for (const svc of services) {
    const row = document.createElement('div');
    row.className = 'svc-list-row';

    const tiersHTML = svc.tiers
      .sort((a, b) => a.minQty - b.minQty)
      .map(t => `<span class="t">من ${t.minQty} → ${nf.format(t.price)} ج.م</span>`)
      .join('');

    row.innerHTML = `
      <div class="svc-list-info">
        <div class="svc-list-name">${escapeHtml(svc.name)}</div>
        <div class="svc-list-tiers">${tiersHTML}</div>
      </div>
      <div class="svc-list-actions">
        <button type="button" class="edit" data-id="${svc.id}" title="تعديل">✎</button>
        <button type="button" class="del" data-id="${svc.id}" title="حذف">🗑</button>
      </div>
    `;
    row.querySelector('.edit').addEventListener('click', () => openServiceModal(svc.id));
    row.querySelector('.del').addEventListener('click', () => deleteService(svc.id));
    el.appendChild(row);
  }
}

function openManageServices() {
  document.getElementById('manageServicesModal').hidden = false;
  renderManageServicesList();
}

/* =========================================================
   ADD / UPDATE WORK
   ========================================================= */
function saveWork() {
  const clientId = state.currentClientId;
  const code     = document.getElementById('productCode').value.trim();
  const date     = document.getElementById('workDate').value || today();
  const status   = document.getElementById('workStatus').value || 'delivered';
  const notes    = document.getElementById('workNotes').value.trim();

  if (!code) return alert('أدخل كود المنتج');
  if (!date) return alert('اختر التاريخ');

  const services = getServices();
  const chosen = [];
  let total = 0;

  for (const svc of services) {
    const qty = state.draftQuantities[svc.id] || 0;
    if (qty === 0) continue;

    const tierPrice = getPriceForQty(svc, qty);
    const appliedPrice = state.draftPriceOverrides[svc.id] ?? tierPrice;

    chosen.push({ name: svc.name, price: appliedPrice, qty, tierMin: (getTierForQty(svc, qty)?.minQty || 1) });
    total += qty * appliedPrice;
  }
  if (state.customService) {
    const qty = state.draftQuantities['__custom__'] || 0;
    if (qty > 0) {
      const appliedPrice = state.draftPriceOverrides['__custom__'] ?? state.customService.price;
      chosen.push({ name: state.customService.name, price: appliedPrice, qty });
      total += qty * appliedPrice;
    }
  }

  if (!chosen.length) return alert('اختر خدمة واحدة على الأقل');

  const works = getWorks();
  const wasEditing = !!state.editingWorkId;

  if (wasEditing) {
    const idx = works.findIndex(w => w.id === state.editingWorkId);
    if (idx > -1) {
      works[idx] = { ...works[idx], productCode: code, date, services: chosen, total, status, notes };
    }
    saveWorks(works);
    flash('تم تحديث العمل ✓');
  } else {
    works.push({
      id: uid(),
      clientId,
      productCode: code,
      date,
      services: chosen,
      total,
      status,
      notes,
      createdAt: new Date().toISOString(),
    });
    saveWorks(works);
    state.currentPage = 1;
    flash('تم تسجيل العمل ✓');
  }

  resetWorkForm();
  renderClientDetail();
}

function resetWorkForm() {
  state.editingWorkId = null;
  state.draftQuantities = {};
  state.draftPriceOverrides = {};
  state.editingPriceId = null;
  state.customService = null;
  document.getElementById('productCode').value = '';
  document.getElementById('workDate').value = today();
  document.getElementById('workNotes').value = '';
  document.getElementById('workStatus').value = 'delivered';
  renderServicesBuilder();
  updateWorkTotal();
  updateWorkFormUI();
}

function editWork(id) {
  const w = getWorksNorm().find(x => x.id === id);
  if (!w) return;

  state.editingWorkId = id;
  state.draftQuantities = {};
  state.draftPriceOverrides = {};
  state.customService = null;

  document.getElementById('productCode').value = w.productCode || '';
  document.getElementById('workDate').value    = w.date || today();
  document.getElementById('workNotes').value   = w.notes || '';
  document.getElementById('workStatus').value  = w.status || 'delivered';

  const services = getServices();
  for (const item of (w.services || [])) {
    const svc = services.find(s => s.name === item.name);
    if (svc) {
      state.draftQuantities[svc.id] = item.qty;
      const currentTierPrice = getPriceForQty(svc, item.qty);
      if (Number(item.price) !== currentTierPrice) {
        state.draftPriceOverrides[svc.id] = Number(item.price);
      }
    } else {
      if (!state.customService) {
        state.customService = { name: item.name, price: item.price };
        state.draftQuantities['__custom__'] = item.qty;
      }
    }
  }

  renderServicesBuilder();
  updateWorkTotal();
  updateWorkFormUI();
  document.getElementById('productCode').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cloneWork(id) {
  const w = getWorksNorm().find(x => x.id === id);
  if (!w) return;

  /* Clear current form, then fill with the work's data */
  state.editingWorkId = null;
  state.draftQuantities = {};
  state.draftPriceOverrides = {};
  state.customService = null;

  document.getElementById('productCode').value = w.productCode || '';
  document.getElementById('workDate').value    = today();
  document.getElementById('workNotes').value   = w.notes || '';
  document.getElementById('workStatus').value  = 'draft';

  const services = getServices();
  for (const item of (w.services || [])) {
    const svc = services.find(s => s.name === item.name);
    if (svc) {
      state.draftQuantities[svc.id] = item.qty;
      const currentTierPrice = getPriceForQty(svc, item.qty);
      if (Number(item.price) !== currentTierPrice) {
        state.draftPriceOverrides[svc.id] = Number(item.price);
      }
    } else {
      if (!state.customService) {
        state.customService = { name: item.name, price: item.price };
        state.draftQuantities['__custom__'] = item.qty;
      }
    }
  }

  renderServicesBuilder();
  updateWorkTotal();
  updateWorkFormUI();
  flash('تم استنساخ العمل — عدّل ثم احفظ');
  document.getElementById('productCode').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function deleteWork(id) {
  if (!confirm('تأكيد حذف هذا العمل؟')) return;
  const works = getWorks().filter(w => w.id !== id);
  saveWorks(works);
  state.selectedWorks.delete(id);
  if (state.editingWorkId === id) resetWorkForm();
  renderClientDetail();
}

/* =========================================================
   Works Table (with bulk + status + notes)
   ========================================================= */
function renderWorksTable() {
  ensureSortSelect();
  const tbody = document.getElementById('worksBody');
  const empty = document.getElementById('worksEmpty');
  const search = (document.getElementById('workSearch').value || '').toLowerCase().trim();

  let works = getWorksNorm().filter(w => w.clientId === state.currentClientId);

  if (search) {
    works = works.filter(w =>
      String(w.productCode).toLowerCase().includes(search) ||
      (w.services || []).some(s => s.name.toLowerCase().includes(search)) ||
      (w.notes || '').toLowerCase().includes(search)
    );
  }
  if (state.workStatusFilter) {
    works = works.filter(w => w.status === state.workStatusFilter);
  }

  works.sort((a, b) => {
    switch (state.sortBy) {
      case 'date-asc':   return a.date.localeCompare(b.date);
      case 'total-desc': return (b.total || 0) - (a.total || 0);
      case 'total-asc':  return (a.total || 0) - (b.total || 0);
      case 'date-desc':
      default:           return b.date.localeCompare(a.date);
    }
  });

  if (!works.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    renderPagination(0, 0);
    updateBulkBar();
    return;
  }
  empty.hidden = true;

  const totalItems = works.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
  if (state.currentPage > totalPages) state.currentPage = totalPages;
  if (state.currentPage < 1) state.currentPage = 1;

  const startIdx  = (state.currentPage - 1) * state.pageSize;
  const pageItems = works.slice(startIdx, startIdx + state.pageSize);

  tbody.innerHTML = '';

  for (const w of pageItems) {
    const qty    = (w.services || []).reduce((s, x) => s + (Number(x.qty) || 0), 0);
    const svcStr = (w.services || []).map(s => `${s.name} ×${s.qty}`).join(' • ');
    const st     = WORK_STATUS[w.status] || WORK_STATUS.delivered;
    const isChecked = state.selectedWorks.has(w.id);

    const tr = document.createElement('tr');
    if (w.id === state.editingWorkId) tr.classList.add('row-editing');
    tr.innerHTML = `
      <td class="col-check">
        <input type="checkbox" class="row-checkbox" data-id="${w.id}" ${isChecked ? 'checked' : ''} />
      </td>
      <td>${fmtDate(w.date)}</td>
      <td><span class="code-chip">${escapeHtml(w.productCode)}</span></td>
      <td>${escapeHtml(svcStr)}</td>
      <td>${qty}</td>
      <td class="td-total">${money(w.total)}</td>
      <td class="col-status">
        <button type="button" class="status-badge ${st.cls} status-change-btn"
                data-id="${w.id}" title="تغيير الحالة" style="border:none; cursor:pointer;">
          ${st.label}
        </button>
      </td>
      <td class="col-notes">${escapeHtml(w.notes || '—')}</td>
      <td class="col-actions">
        <div class="row-actions">
          <button class="icon-btn edit" data-id="${w.id}" title="تعديل">✎</button>
          <button class="icon-btn clone" data-id="${w.id}" title="استنساخ">📋</button>
          <button class="icon-btn del"  data-id="${w.id}" title="حذف">🗑</button>
        </div>
      </td>
    `;

    tr.querySelector('.edit').addEventListener('click', () => editWork(w.id));
    tr.querySelector('.clone').addEventListener('click', () => cloneWork(w.id));
    tr.querySelector('.del').addEventListener('click', () => deleteWork(w.id));
    tr.querySelector('.row-checkbox').addEventListener('change', (e) => {
      if (e.target.checked) state.selectedWorks.add(w.id);
      else state.selectedWorks.delete(w.id);
      updateBulkBar();
    });
    tr.querySelector('.status-change-btn').addEventListener('click', () => cycleWorkStatus(w.id));

    tbody.appendChild(tr);
  }

  /* Update select-all state */
  const selectAll = document.getElementById('selectAllWorks');
  if (selectAll) {
    const pageIds = pageItems.map(w => w.id);
    const selectedOnPage = pageIds.filter(id => state.selectedWorks.has(id)).length;
    selectAll.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
    selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
  }

  renderPagination(state.currentPage, totalPages);
  updateBulkBar();
}

function cycleWorkStatus(workId) {
  const works = getWorks();
  const idx = works.findIndex(w => w.id === workId);
  if (idx === -1) return;
  const order = ['draft', 'review', 'delivered', 'paid'];
  const curr = works[idx].status || 'delivered';
  const next = order[(order.indexOf(curr) + 1) % order.length];
  works[idx].status = next;
  saveWorks(works);
  renderWorksTable();
  renderStatusDist(getWorksNorm().filter(w => w.clientId === state.currentClientId));
  flash('الحالة: ' + WORK_STATUS[next].label);
}

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  const count = document.getElementById('bulkCount');
  const n = state.selectedWorks.size;
  if (n === 0) {
    bar.hidden = true;
  } else {
    bar.hidden = false;
    count.textContent = `${n} محدد`;
  }
}

function bulkDelete() {
  const n = state.selectedWorks.size;
  if (!n) return;
  if (!confirm(`حذف ${n} عمل نهائيًا؟`)) return;
  const works = getWorks().filter(w => !state.selectedWorks.has(w.id));
  saveWorks(works);
  state.selectedWorks = new Set();
  renderClientDetail();
  flash(`تم حذف ${n} عمل`);
}

function bulkChangeStatus(newStatus) {
  const works = getWorks();
  let count = 0;
  for (const w of works) {
    if (state.selectedWorks.has(w.id)) {
      w.status = newStatus;
      count++;
    }
  }
  saveWorks(works);
  state.selectedWorks = new Set();
  closeModal('bulkStatusModal');
  renderClientDetail();
  flash(`تم تحديث ${count} عمل`);
}

function ensureSortSelect() {
  if (document.getElementById('workSort')) return;
  const search = document.getElementById('workSearch');
  if (!search) return;
  const toolbar = search.closest('.toolbar');
  if (!toolbar) return;

  const sel = document.createElement('select');
  sel.id = 'workSort';
  sel.className = 'input-select';
  sel.innerHTML = `
    <option value="date-desc">التاريخ (الأحدث)</option>
    <option value="date-asc">التاريخ (الأقدم)</option>
    <option value="total-desc">الإجمالي (الأعلى)</option>
    <option value="total-asc">الإجمالي (الأدنى)</option>
  `;
  sel.value = state.sortBy;
  sel.addEventListener('change', () => {
    state.sortBy = sel.value;
    state.currentPage = 1;
    renderWorksTable();
  });
  toolbar.appendChild(sel);
}

function ensurePaginationEl() {
  let el = document.getElementById('worksPagination');
  if (el) return el;
  const wrap = document.querySelector('#worksBody')?.closest('.table-wrap');
  if (!wrap) return null;
  el = document.createElement('div');
  el.id = 'worksPagination';
  el.className = 'pagination';
  wrap.parentNode.insertBefore(el, wrap.nextSibling);
  return el;
}

function renderPagination(current, total) {
  const el = ensurePaginationEl();
  if (!el) return;
  if (total <= 1) { el.innerHTML = ''; return; }

  let html = '';
  html += `<button class="pg-btn" ${current === 1 ? 'disabled' : ''} data-page="${current - 1}">‹</button>`;

  const windowSize = 5;
  let startP = Math.max(1, current - Math.floor(windowSize / 2));
  let endP   = Math.min(total, startP + windowSize - 1);
  if (endP - startP < windowSize - 1) startP = Math.max(1, endP - windowSize + 1);

  if (startP > 1) html += `<button class="pg-btn" data-page="1">1</button><span class="pg-dots">…</span>`;
  for (let p = startP; p <= endP; p++) {
    html += `<button class="pg-btn ${p === current ? 'active' : ''}" data-page="${p}">${p}</button>`;
  }
  if (endP < total) html += `<span class="pg-dots">…</span><button class="pg-btn" data-page="${total}">${total}</button>`;

  html += `<button class="pg-btn" ${current === total ? 'disabled' : ''} data-page="${current + 1}">›</button>`;
  el.innerHTML = html;

  el.querySelectorAll('.pg-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = Number(btn.dataset.page);
      if (p >= 1 && p <= total && p !== current) {
        state.currentPage = p;
        renderWorksTable();
      }
    });
  });
}

/* =========================================================
   CLIENT MODAL
   ========================================================= */
function openClientModal(clientId = null) {
  state.editingClientId = clientId;
  const modal = document.getElementById('clientModal');
  const title = document.getElementById('clientModalTitle');

  if (clientId) {
    const c = getClientsNorm().find(x => x.id === clientId);
    title.textContent = 'تعديل العميل';
    document.getElementById('cName').value    = c?.name    || '';
    document.getElementById('cCompany').value = c?.company || '';
    document.getElementById('cPhone').value   = c?.phone   || '';
    document.getElementById('cNotes').value   = c?.notes   || '';
    state.draftClientStatus = c?.status || 'active';
    state.draftClientTags = [...(c?.tags || [])];
  } else {
    title.textContent = 'عميل جديد';
    document.getElementById('cName').value    = '';
    document.getElementById('cCompany').value = '';
    document.getElementById('cPhone').value   = '';
    document.getElementById('cNotes').value   = '';
    state.draftClientStatus = 'active';
    state.draftClientTags = [];
  }

  renderClientStatusPicker();
  renderTagsInput();

  modal.hidden = false;
  setTimeout(() => document.getElementById('cName').focus(), 50);
}

function renderClientStatusPicker() {
  const el = document.getElementById('clientStatusPicker');
  el.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === state.draftClientStatus);
  });
}

function renderTagsInput() {
  const wrap = document.getElementById('tagsWrap');
  const input = document.getElementById('tagInput');
  /* Remove existing chips */
  wrap.querySelectorAll('.tg-chip').forEach(c => c.remove());

  /* Add chips before input */
  for (const tag of state.draftClientTags) {
    const chip = document.createElement('span');
    chip.className = 'tg-chip';
    chip.innerHTML = `${escapeHtml(tag)} <button type="button" data-tag="${escapeHtml(tag)}">✕</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      state.draftClientTags = state.draftClientTags.filter(t => t !== tag);
      renderTagsInput();
    });
    wrap.insertBefore(chip, input);
  }
}

function saveClient() {
  const name    = document.getElementById('cName').value.trim();
  const company = document.getElementById('cCompany').value.trim();
  const phone   = document.getElementById('cPhone').value.trim();
  const notes   = document.getElementById('cNotes').value.trim();
  const status  = state.draftClientStatus;
  const tags    = [...state.draftClientTags];

  if (!name) return alert('اسم العميل مطلوب');

  const clients = getClients();

  if (state.editingClientId) {
    const idx = clients.findIndex(c => c.id === state.editingClientId);
    if (idx > -1) clients[idx] = { ...clients[idx], name, company, phone, notes, status, tags };
    saveClients(clients);
    closeModal('clientModal');
    renderClientDetail();
    flash('تم تحديث بيانات العميل ✓');
  } else {
    clients.push({ id: uid(), name, company, phone, notes, status, tags, createdAt: today() });
    saveClients(clients);
    closeModal('clientModal');
    renderClientsList();
    flash('تم إضافة العميل ✓');
  }
}

function deleteClient() {
  const client = getClientsNorm().find(c => c.id === state.currentClientId);
  if (!client) return;
  const worksCount = getWorks().filter(w => w.clientId === client.id).length;

  const msg = worksCount
    ? `سيتم حذف العميل "${client.name}" و${worksCount} عمل مرتبط به. متأكد؟`
    : `حذف العميل "${client.name}"؟`;
  if (!confirm(msg)) return;

  saveClients(getClients().filter(c => c.id !== client.id));
  saveWorks(getWorks().filter(w => w.clientId !== client.id));

  closeClient();
  flash('تم حذف العميل');
}

/* =========================================================
   CSV EXPORT
   ========================================================= */
function exportClientWorksCsv() {
  const client = getClientsNorm().find(c => c.id === state.currentClientId);
  if (!client) return;
  const works = getWorksNorm().filter(w => w.clientId === client.id);

  if (!works.length) return alert('لا توجد أعمال للتصدير');

  const rows = [
    ['التاريخ', 'كود المنتج', 'الخدمات', 'الكمية', 'الإجمالي', 'الحالة', 'ملاحظات']
  ];

  for (const w of works.sort((a, b) => a.date.localeCompare(b.date))) {
    const svcStr = (w.services || []).map(s => `${s.name} x${s.qty} (${s.price}/unit)`).join(' + ');
    const qty    = (w.services || []).reduce((s, x) => s + (Number(x.qty) || 0), 0);
    const st     = (WORK_STATUS[w.status] || WORK_STATUS.delivered).label;
    rows.push([
      w.date,
      w.productCode || '',
      svcStr,
      qty,
      w.total || 0,
      st,
      (w.notes || '').replace(/"/g, '""'),
    ]);
  }

  const csv = '\uFEFF' + rows.map(r =>
    r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(client.name || 'client').replace(/\s+/g, '_')}_works_${today()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  flash('تم تصدير CSV ✓');
}

/* =========================================================
   INVOICE (unchanged — with summary)
   ========================================================= */
function generateInvoice() {
  const client = getClientsNorm().find(c => c.id === state.currentClientId);
  if (!client) return;
  const works = getWorksNorm()
    .filter(w => w.clientId === client.id)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!works.length) return alert('لا توجد أعمال لإنشاء فاتورة');

  const invoiceNo = 'INV-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + client.id.slice(-4).toUpperCase();
  const dateStr   = new Date().toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' });

  let grandTotal = 0, grandQty = 0;
  const rowsHTML = works.map((w, i) => {
    const svcStr = (w.services || []).map(s => `${s.name} ×${s.qty} (${nf.format(s.price)}/وحدة)`).join(' + ');
    const qty = (w.services || []).reduce((s, x) => s + (Number(x.qty)||0), 0);
    grandTotal += Number(w.total) || 0;
    grandQty += qty;
    return `
      <tr>
        <td>${i + 1}</td>
        <td>${fmtDate(w.date)}</td>
        <td><b>${escapeHtml(w.productCode)}</b></td>
        <td>${escapeHtml(svcStr)}</td>
        <td style="text-align:center">${qty}</td>
        <td style="text-align:left">${money(w.total)}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>Invoice ${invoiceNo}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Cairo',-apple-system,system-ui,sans-serif; background:#fff; color:#1a2333; padding:40px; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #0f766e; padding-bottom:20px; margin-bottom:30px; }
  .brand h1 { font-size:28px; letter-spacing:1px; color:#0f766e; }
  .brand p  { font-size:13px; color:#666; margin-top:4px; }
  .inv-meta { text-align:left; }
  .inv-meta h2 { font-size:22px; color:#1a2333; letter-spacing:2px; margin-bottom:8px; }
  .inv-meta p  { font-size:13px; color:#444; line-height:1.7; }
  .section { margin-bottom:24px; }
  .section-label { font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#888; margin-bottom:6px; }
  .client-name { font-size:18px; font-weight:700; }
  .client-info { font-size:13px; color:#555; line-height:1.7; }
  table { width:100%; border-collapse:collapse; margin-top:20px; }
  th { background:#f3f7f7; text-align:right; padding:12px 10px; font-size:12px; text-transform:uppercase; letter-spacing:.5px; color:#0f766e; border-bottom:2px solid #0f766e; }
  td { padding:12px 10px; border-bottom:1px solid #eee; font-size:13px; }
  .summary { display:flex; justify-content:flex-end; margin-top:24px; }
  .summary-box { min-width:320px; border:2px solid #0f766e; border-radius:12px; overflow:hidden; background:#fff; }
  .summary-row { display:flex; justify-content:space-between; align-items:center; padding:12px 20px; font-size:13px; border-bottom:1px solid #eef3f3; }
  .summary-row:last-child { border-bottom:none; }
  .summary-row.total { background:#0f766e; color:#fff; padding:16px 20px; font-size:17px; font-weight:800; }
  .summary-row.total .s-label { color:#fff; }
  .summary-row.total .s-value { color:#fff; font-size:20px; }
  .footer { margin-top:40px; padding-top:20px; border-top:1px dashed #ccc; text-align:center; font-size:12px; color:#888; }
  @media print { body { padding:20px; } }
</style>
</head>
<body>
  <div class="head">
    <div class="brand"><h1>AURA VISUALS</h1><p>Professional Image Editing & AI Services</p></div>
    <div class="inv-meta">
      <h2>INVOICE</h2>
      <p><b>#</b> ${invoiceNo}</p>
      <p><b>Date:</b> ${dateStr}</p>
    </div>
  </div>

  <div class="section">
    <div class="section-label">Billed To</div>
    <div class="client-name">${escapeHtml(client.name)}</div>
    <div class="client-info">
      ${client.company ? escapeHtml(client.company) + '<br>' : ''}
      ${client.phone   ? escapeHtml(client.phone)   + '<br>' : ''}
    </div>
  </div>

  <table>
    <thead><tr>
      <th>#</th><th>Date</th><th>Product Code</th><th>Services</th>
      <th style="text-align:center">Qty</th>
      <th style="text-align:left">Amount</th>
    </tr></thead>
    <tbody>${rowsHTML}</tbody>
  </table>

  <div class="summary">
    <div class="summary-box">
      <div class="summary-row"><span>عدد البنود</span><span class="s-value">${works.length}</span></div>
      <div class="summary-row"><span>إجمالي الكميات</span><span class="s-value">${grandQty}</span></div>
      <div class="summary-row"><span>متوسط قيمة العمل</span><span class="s-value">${money(works.length ? grandTotal / works.length : 0)}</span></div>
      <div class="summary-row total"><span class="s-label">الإجمالي</span><span class="s-value">${money(grandTotal)}</span></div>
    </div>
  </div>

  <div class="footer">Thank you for your business — AURA VISUALS</div>
  <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>
</body>
</html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

/* =========================================================
   UTILS
   ========================================================= */
function closeModal(id) { document.getElementById(id).hidden = true; }

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-close]');
  if (btn) closeModal(btn.dataset.close);
  if (e.target.classList.contains('modal-backdrop')) e.target.hidden = true;
});

function flash(msg) {
  let el = document.getElementById('__flash');
  if (!el) {
    el = document.createElement('div');
    el.id = '__flash';
    el.className = 'flash';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el.__t);
  el.__t = setTimeout(() => el.classList.remove('show'), 2200);
}

/* =========================================================
   EVENTS
   ========================================================= */
document.getElementById('addClientBtn').addEventListener('click', () => openClientModal());
document.getElementById('saveClientBtn').addEventListener('click', saveClient);
document.getElementById('backBtn').addEventListener('click', closeClient);
document.getElementById('deleteClientBtn').addEventListener('click', deleteClient);
document.getElementById('editClientBtn').addEventListener('click', () => openClientModal(state.currentClientId));
document.getElementById('invoiceBtn').addEventListener('click', generateInvoice);
document.getElementById('exportCsvBtn').addEventListener('click', exportClientWorksCsv);
document.getElementById('addWorkBtn').addEventListener('click', saveWork);
document.getElementById('resetWorkBtn').addEventListener('click', resetWorkForm);

/* Client list filters */
document.getElementById('clientSearch').addEventListener('input', (e) => {
  state.clientSearch = e.target.value;
  renderClientsList();
});
document.getElementById('clientStatusFilter').addEventListener('change', (e) => {
  state.clientStatusFilter = e.target.value;
  renderClientsList();
});
document.getElementById('clientSort').addEventListener('change', (e) => {
  state.clientSort = e.target.value;
  renderClientsList();
});

/* Work search + filter */
document.getElementById('workSearch').addEventListener('input', () => {
  state.currentPage = 1;
  renderWorksTable();
});
document.getElementById('workStatusFilter').addEventListener('change', (e) => {
  state.workStatusFilter = e.target.value;
  state.currentPage = 1;
  renderWorksTable();
});

/* Select all */
document.getElementById('selectAllWorks').addEventListener('change', (e) => {
  const tbody = document.getElementById('worksBody');
  const pageIds = [...tbody.querySelectorAll('.row-checkbox')].map(cb => cb.dataset.id);
  if (e.target.checked) {
    pageIds.forEach(id => state.selectedWorks.add(id));
  } else {
    pageIds.forEach(id => state.selectedWorks.delete(id));
  }
  renderWorksTable();
});

/* Bulk bar */
document.getElementById('bulkDelete').addEventListener('click', bulkDelete);
document.getElementById('bulkCancel').addEventListener('click', () => {
  state.selectedWorks = new Set();
  renderWorksTable();
});
document.getElementById('bulkChangeStatus').addEventListener('click', () => {
  if (state.selectedWorks.size === 0) return;
  document.getElementById('bulkStatusModal').hidden = false;
});
document.querySelectorAll('[data-bulk-status]').forEach(btn => {
  btn.addEventListener('click', () => bulkChangeStatus(btn.dataset.bulkStatus));
});

/* Service modal */
document.getElementById('addServiceBtn').addEventListener('click', () => openServiceModal());
document.getElementById('saveServiceBtn').addEventListener('click', saveService);
document.getElementById('addTierBtn').addEventListener('click', () => {
  const tiers = state.draftTiers || [];
  const sorted = [...tiers].sort((a, b) => (a.minQty || 1) - (b.minQty || 1));
  const lastMin = sorted.length ? (sorted[sorted.length - 1].minQty || 1) : 1;
  state.draftTiers = [...tiers, { minQty: lastMin + 1, price: '' }];
  renderTiersEditor();
});

/* Manage services */
document.getElementById('manageServicesBtn').addEventListener('click', openManageServices);
document.getElementById('addServiceFromManage').addEventListener('click', () => openServiceModal());

/* Client status picker in modal */
document.querySelectorAll('#clientStatusPicker button').forEach(btn => {
  btn.addEventListener('click', () => {
    state.draftClientStatus = btn.dataset.status;
    renderClientStatusPicker();
  });
});

/* Tag input */
document.getElementById('tagInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const val = e.target.value.trim();
    if (!val) return;
    if (!state.draftClientTags.includes(val)) {
      state.draftClientTags.push(val);
    }
    e.target.value = '';
    renderTagsInput();
  } else if (e.key === 'Backspace' && !e.target.value && state.draftClientTags.length) {
    state.draftClientTags.pop();
    renderTagsInput();
  }
});

/* =========================================================
   Injected Styles
   ========================================================= */
(function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .pagination { display:flex; gap:6px; justify-content:center; align-items:center; padding:16px 0 4px; flex-wrap:wrap; }
    .pg-btn { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); color:#8892a6; padding:6px 12px; border-radius:8px; cursor:pointer; font-family:inherit; font-size:13px; min-width:34px; transition:.15s; }
    .pg-btn:hover:not(:disabled) { background:rgba(74,222,128,0.1); border-color:rgba(74,222,128,0.3); color:#4ade80; }
    .pg-btn.active { background:#4ade80; color:#0a1018; border-color:#4ade80; font-weight:700; }
    .pg-btn:disabled { opacity:.35; cursor:not-allowed; }
    .pg-dots { color:#5a6378; padding:0 4px; }
    tr.row-editing td { background:rgba(74,222,128,0.06) !important; }
    .icon-btn.clone:hover { background:rgba(167,139,250,0.15); color:#a78bfa; }
  `;
  document.head.appendChild(style);
})();

/* =========================================================
   Boot
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
  /* pre-fill client sort select */
  document.getElementById('clientSort').value = state.clientSort;

  if (location.hash.startsWith('#client=')) {
    const id = location.hash.slice(8);
    if (getClients().some(c => c.id === id)) {
      openClient(id);
      return;
    }
  }
  renderClientsList();
});