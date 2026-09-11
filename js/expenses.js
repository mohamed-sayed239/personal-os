/* =========================================================
   Personal OS — Expenses & Subscriptions Module
   Writes to: po_subscriptions, po_expenses
   Reads from: po_clients (for linking project expenses)
   ========================================================= */

const KEYS = {
  subscriptions: 'po_subscriptions',
  expenses:      'po_expenses',
  clients:       'po_clients',
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

const getSubs    = () => Store.get(KEYS.subscriptions);
const saveSubs   = x => Store.set(KEYS.subscriptions, x);
const getExps    = () => Store.get(KEYS.expenses);
const saveExps   = x => Store.set(KEYS.expenses, x);
const getClients = () => Store.get(KEYS.clients);

const uid     = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nf      = new Intl.NumberFormat('en-US');
const money   = n => nf.format(Math.round(n)) + ' ج.م';
const today   = () => new Date().toISOString().slice(0, 10);
const fmtDate = s => {
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
};
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, ch => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[ch]));

/* ---------- Normalization (backward compat) ---------- */
function getScope(exp) {
  if (exp.scope) return exp.scope;
  return exp.relatedClientId ? 'project' : 'project';
}

/* ---------- Helpers ---------- */
function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  const now = new Date(); now.setHours(0,0,0,0);
  const d   = new Date(dateStr); d.setHours(0,0,0,0);
  return Math.round((d - now) / 86400000);
}

function monthlyEquivalent(sub) {
  const amt = Number(sub.amount) || 0;
  switch (sub.cycle) {
    case 'yearly':    return amt / 12;
    case 'quarterly': return amt / 3;
    case 'monthly':
    default:          return amt;
  }
}

const cycleLabel = {
  monthly:   'شهري',
  quarterly: 'ربع سنوي',
  yearly:    'سنوي',
};

const scopeLabel = {
  project:  'مشروع',
  personal: 'شخصي',
};

/* ---------- State ---------- */
const state = {
  activeTab: 'subs',
  editingSubId: null,
  editingExpId: null,
  expScope: 'project',
  subPage:  1,
  subPageSize: 10,
  expPage:  1,
  expPageSize: 10,
  subSort: 'renewal-asc',
  expSort: 'date-desc',
  expScopeFilter: '',
};

/* =========================================================
   SUMMARY
   ========================================================= */
function renderSummary() {
  const subs = getSubs();
  const exps = getExps();
  const now  = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const monthly = subs
    .filter(s => s.active)
    .reduce((sum, s) => sum + monthlyEquivalent(s), 0);

  const activeSubsCount = subs.filter(s => s.active).length;

  /* ✅ الإصلاح: الاشتراكات تُضاف لمصروفات هذا الشهر */
  const oneTimeThisMonth = exps
    .filter(e => new Date(e.date) >= monthStart)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  const monthExpTotal = oneTimeThisMonth + monthly;

  const expsTotal = exps.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const subsTotal = subs.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

  document.getElementById('expMonthly').textContent     = money(monthly);
  document.getElementById('expActiveSubs').textContent  = nf.format(activeSubsCount);
  document.getElementById('expMonthTotal').textContent  = money(monthExpTotal);
  document.getElementById('expAllTime').textContent     = money(expsTotal + subsTotal);

  const totalCount = subs.length + exps.length;
  document.getElementById('expensesSub').textContent = totalCount
    ? `${subs.length} اشتراك • ${exps.length} مصروف`
    : 'لا توجد بيانات بعد';
}

/* =========================================================
   RENEWAL ALERTS
   ========================================================= */
function renderRenewalAlerts() {
  const card = document.getElementById('renewalsCard');
  const list = document.getElementById('renewalsList');

  const upcoming = getSubs()
    .filter(s => s.active && s.nextRenewal)
    .map(s => ({ ...s, days: daysUntil(s.nextRenewal) }))
    .filter(s => s.days <= 14)
    .sort((a, b) => a.days - b.days);

  if (!upcoming.length) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  list.innerHTML = '';
  for (const s of upcoming) {
    const urgent = s.days <= 3;
    const row = document.createElement('div');
    row.className = 'renewal-row ' + (urgent ? 'urgent' : 'soon');
    let daysText;
    if (s.days < 0)        daysText = `متأخر ${Math.abs(s.days)} يوم`;
    else if (s.days === 0) daysText = 'اليوم';
    else                   daysText = `بعد ${s.days} يوم`;

    row.innerHTML = `
      <div class="renewal-info">
        <strong>${escapeHtml(s.name)}</strong>
        <span class="renewal-days">${daysText} • ${cycleLabel[s.cycle] || '—'}</span>
      </div>
      <div class="renewal-amount">${money(s.amount)}</div>
    `;
    list.appendChild(row);
  }
}

/* =========================================================
   SUBSCRIPTIONS TABLE
   ========================================================= */
function renderSubsTable() {
  const tbody = document.getElementById('subsBody');
  const empty = document.getElementById('subsEmpty');

  const allSubs = getSubs();
  const cats = [...new Set(allSubs.map(s => s.category).filter(Boolean))].sort();
  const catSel = document.getElementById('subCategoryFilter');
  const curCat = catSel.value;
  catSel.innerHTML = '<option value="">كل التصنيفات</option>' +
    cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  catSel.value = curCat;

  let items = allSubs.slice();

  const search = (document.getElementById('subSearch').value || '').toLowerCase().trim();
  const cat    = catSel.value;

  if (search) items = items.filter(s =>
    (s.name || '').toLowerCase().includes(search) ||
    (s.category || '').toLowerCase().includes(search) ||
    (s.notes || '').toLowerCase().includes(search)
  );
  if (cat) items = items.filter(s => (s.category || '') === cat);

  items.sort((a, b) => {
    switch (state.subSort) {
      case 'renewal-asc':  return (a.nextRenewal || '9999').localeCompare(b.nextRenewal || '9999');
      case 'renewal-desc': return (b.nextRenewal || '').localeCompare(a.nextRenewal || '');
      case 'amount-desc':  return (Number(b.amount) || 0) - (Number(a.amount) || 0);
      case 'amount-asc':   return (Number(a.amount) || 0) - (Number(b.amount) || 0);
      case 'name-asc':     return (a.name || '').localeCompare(b.name || '');
      default:             return 0;
    }
  });

  if (!items.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    renderPagination('subs', 0, 0);
    return;
  }
  empty.hidden = true;

  const totalPages = Math.max(1, Math.ceil(items.length / state.subPageSize));
  if (state.subPage > totalPages) state.subPage = totalPages;
  if (state.subPage < 1) state.subPage = 1;

  const startIdx = (state.subPage - 1) * state.subPageSize;
  const pageItems = items.slice(startIdx, startIdx + state.subPageSize);

  tbody.innerHTML = '';
  for (const s of pageItems) {
    const days = daysUntil(s.nextRenewal);
    let daysText = '';
    if (s.active && s.nextRenewal) {
      if (days < 0) daysText = `(${Math.abs(days)} يوم متأخر)`;
      else if (days === 0) daysText = '(اليوم)';
      else daysText = `(بعد ${days} يوم)`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <button class="toggle-active" data-id="${s.id}" title="${s.active ? 'إيقاف' : 'تفعيل'}">
          <span class="status-dot ${s.active ? 'active' : 'inactive'}"></span>
          ${s.active ? 'نشط' : 'موقوف'}
        </button>
      </td>
      <td><b>${escapeHtml(s.name)}</b></td>
      <td><span class="cat-chip">${escapeHtml(s.category || '—')}</span></td>
      <td><span class="cycle-chip ${s.cycle}">${cycleLabel[s.cycle] || '—'}</span></td>
      <td class="td-total">${money(s.amount)}</td>
      <td>${s.nextRenewal ? fmtDate(s.nextRenewal) + ' <span style="color:#5a6378;font-size:11px;">' + daysText + '</span>' : '—'}</td>
      <td class="td-actions">
        <button class="icon-btn edit" data-id="${s.id}" title="تعديل">✎</button>
        <button class="icon-btn del"  data-id="${s.id}" title="حذف">🗑</button>
      </td>
    `;
    tr.querySelector('.toggle-active').addEventListener('click', () => toggleSub(s.id));
    tr.querySelector('.edit').addEventListener('click', () => openSubModal(s.id));
    tr.querySelector('.del').addEventListener('click', () => deleteSub(s.id));
    tbody.appendChild(tr);
  }

  renderPagination('subs', state.subPage, totalPages);
}

function toggleSub(id) {
  const subs = getSubs();
  const idx = subs.findIndex(s => s.id === id);
  if (idx > -1) {
    subs[idx].active = !subs[idx].active;
    saveSubs(subs);
    renderAll();
  }
}

/* =========================================================
   EXPENSES TABLE
   ========================================================= */
function renderExpTable() {
  const tbody = document.getElementById('expBody');
  const empty = document.getElementById('expEmpty');

  const allExps = getExps();
  const cats = [...new Set(allExps.map(e => e.category).filter(Boolean))].sort();
  const catSel = document.getElementById('exCategoryFilter');
  const curCat = catSel.value;
  catSel.innerHTML = '<option value="">كل التصنيفات</option>' +
    cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  catSel.value = curCat;

  let items = allExps.slice();

  const search = (document.getElementById('exSearch').value || '').toLowerCase().trim();
  const cat    = catSel.value;
  const scope  = state.expScopeFilter;

  if (search) items = items.filter(e =>
    (e.title || '').toLowerCase().includes(search) ||
    (e.category || '').toLowerCase().includes(search) ||
    (e.notes || '').toLowerCase().includes(search)
  );
  if (cat)   items = items.filter(e => (e.category || '') === cat);
  if (scope) items = items.filter(e => getScope(e) === scope);

  items.sort((a, b) => {
    switch (state.expSort) {
      case 'date-asc':    return (a.date || '').localeCompare(b.date || '');
      case 'amount-desc': return (Number(b.amount) || 0) - (Number(a.amount) || 0);
      case 'amount-asc':  return (Number(a.amount) || 0) - (Number(b.amount) || 0);
      case 'date-desc':
      default:            return (b.date || '').localeCompare(a.date || '');
    }
  });

  if (!items.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    renderPagination('exp', 0, 0);
    return;
  }
  empty.hidden = true;

  const totalPages = Math.max(1, Math.ceil(items.length / state.expPageSize));
  if (state.expPage > totalPages) state.expPage = totalPages;
  if (state.expPage < 1) state.expPage = 1;

  const startIdx = (state.expPage - 1) * state.expPageSize;
  const pageItems = items.slice(startIdx, startIdx + state.expPageSize);

  const clientMap = Object.fromEntries(getClients().map(c => [c.id, c]));

  tbody.innerHTML = '';
  for (const e of pageItems) {
    const scope = getScope(e);
    const clientName = (scope === 'project' && e.relatedClientId)
      ? (clientMap[e.relatedClientId]?.name || '—')
      : '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtDate(e.date)}</td>
      <td><b>${escapeHtml(e.title)}</b></td>
      <td><span class="scope-chip ${scope}">${scopeLabel[scope] || '—'}</span></td>
      <td><span class="cat-chip">${escapeHtml(e.category || '—')}</span></td>
      <td>${clientName === '—' ? '—' : escapeHtml(clientName)}</td>
      <td class="td-total">${money(e.amount)}</td>
      <td class="td-actions">
        <button class="icon-btn edit" data-id="${e.id}" title="تعديل">✎</button>
        <button class="icon-btn del"  data-id="${e.id}" title="حذف">🗑</button>
      </td>
    `;
    tr.querySelector('.edit').addEventListener('click', () => openExpModal(e.id));
    tr.querySelector('.del').addEventListener('click', () => deleteExp(e.id));
    tbody.appendChild(tr);
  }

  renderPagination('exp', state.expPage, totalPages);
}

/* =========================================================
   PAGINATION
   ========================================================= */
function ensurePaginationEl(kind) {
  const id = kind === 'subs' ? 'subsPagination' : 'expPagination';
  let el = document.getElementById(id);
  if (el) return el;
  const tbodyId = kind === 'subs' ? 'subsBody' : 'expBody';
  const wrap = document.querySelector(`#${tbodyId}`)?.closest('.table-wrap');
  if (!wrap) return null;
  el = document.createElement('div');
  el.id = id;
  el.className = 'pagination';
  wrap.parentNode.insertBefore(el, wrap.nextSibling);
  return el;
}

function renderPagination(kind, current, total) {
  const el = ensurePaginationEl(kind);
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
        if (kind === 'subs') state.subPage = p;
        else state.expPage = p;
        if (kind === 'subs') renderSubsTable();
        else renderExpTable();
      }
    });
  });
}

/* =========================================================
   SUBSCRIPTION MODAL
   ========================================================= */
function openSubModal(id = null) {
  state.editingSubId = id;
  const title = document.getElementById('subModalTitle');

  if (id) {
    const s = getSubs().find(x => x.id === id);
    title.textContent = 'تعديل الاشتراك';
    document.getElementById('sName').value        = s?.name || '';
    document.getElementById('sAmount').value      = s?.amount || '';
    document.getElementById('sCycle').value       = s?.cycle || 'monthly';
    document.getElementById('sCategory').value    = s?.category || '';
    document.getElementById('sNextRenewal').value = s?.nextRenewal || today();
    document.getElementById('sNotes').value       = s?.notes || '';
    document.getElementById('sActive').checked    = s?.active !== false;
  } else {
    title.textContent = 'اشتراك جديد';
    document.getElementById('sName').value        = '';
    document.getElementById('sAmount').value      = '';
    document.getElementById('sCycle').value       = 'monthly';
    document.getElementById('sCategory').value    = '';
    document.getElementById('sNextRenewal').value = today();
    document.getElementById('sNotes').value       = '';
    document.getElementById('sActive').checked    = true;
  }

  document.getElementById('subModal').hidden = false;
  setTimeout(() => document.getElementById('sName').focus(), 50);
}

function saveSub() {
  const name        = document.getElementById('sName').value.trim();
  const amount      = Number(document.getElementById('sAmount').value);
  const cycle       = document.getElementById('sCycle').value;
  const category    = document.getElementById('sCategory').value.trim() || 'Other';
  const nextRenewal = document.getElementById('sNextRenewal').value || today();
  const notes       = document.getElementById('sNotes').value.trim();
  const active      = document.getElementById('sActive').checked;

  if (!name) return alert('اسم الاشتراك مطلوب');
  if (!amount || amount <= 0) return alert('المبلغ يجب أن يكون أكبر من صفر');
  if (!nextRenewal) return alert('تاريخ التجديد مطلوب');

  const subs = getSubs();

  if (state.editingSubId) {
    const idx = subs.findIndex(s => s.id === state.editingSubId);
    if (idx > -1) {
      subs[idx] = { ...subs[idx], name, amount, cycle, category, nextRenewal, notes, active };
    }
    flash('تم تحديث الاشتراك ✓');
  } else {
    subs.push({
      id: uid(), name, amount, cycle, category, nextRenewal, notes, active,
      createdAt: new Date().toISOString(),
    });
    state.subPage = 1;
    flash('تم إضافة الاشتراك ✓');
  }

  saveSubs(subs);
  document.getElementById('subModal').hidden = true;
  renderAll();
}

function deleteSub(id) {
  if (!confirm('حذف هذا الاشتراك؟')) return;
  saveSubs(getSubs().filter(s => s.id !== id));
  renderAll();
  flash('تم الحذف');
}

/* =========================================================
   EXPENSE MODAL
   ========================================================= */
function populateClientSelect() {
  const sel = document.getElementById('eClient');
  const clients = getClients();
  sel.innerHTML = '<option value="">— بدون —</option>' +
    clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

function setExpScope(scope) {
  state.expScope = scope;
  document.querySelectorAll('#expScopeSeg button').forEach(b => {
    b.classList.toggle('active', b.dataset.scope === scope);
  });
  document.getElementById('eClientField').hidden = (scope !== 'project');
  const titleInput = document.getElementById('eTitle');
  titleInput.placeholder = scope === 'personal'
    ? 'مثال: ملابس، خروج، صيدلية…'
    : 'مثال: شراء دومين، تصميم إعلان…';
}

function openExpModal(id = null) {
  state.editingExpId = id;
  populateClientSelect();
  const title = document.getElementById('expModalTitle');

  if (id) {
    const e = getExps().find(x => x.id === id);
    const scope = getScope(e);
    setExpScope(scope);
    title.textContent = 'تعديل المصروف';
    document.getElementById('eTitle').value    = e?.title || '';
    document.getElementById('eAmount').value   = e?.amount || '';
    document.getElementById('eDate').value     = e?.date || today();
    document.getElementById('eCategory').value = e?.category || '';
    document.getElementById('eClient').value   = e?.relatedClientId || '';
    document.getElementById('eNotes').value    = e?.notes || '';
  } else {
    setExpScope('project');
    title.textContent = 'مصروف جديد';
    document.getElementById('eTitle').value    = '';
    document.getElementById('eAmount').value   = '';
    document.getElementById('eDate').value     = today();
    document.getElementById('eCategory').value = '';
    document.getElementById('eClient').value   = '';
    document.getElementById('eNotes').value    = '';
  }

  document.getElementById('expModal').hidden = false;
  setTimeout(() => document.getElementById('eTitle').focus(), 50);
}

function saveExp() {
  const scope    = state.expScope;
  const title    = document.getElementById('eTitle').value.trim();
  const amount   = Number(document.getElementById('eAmount').value);
  const date     = document.getElementById('eDate').value || today();
  const category = document.getElementById('eCategory').value.trim() || 'Other';
  const clientId = scope === 'project'
    ? (document.getElementById('eClient').value || null)
    : null;
  const notes    = document.getElementById('eNotes').value.trim();

  if (!title) return alert('عنوان المصروف مطلوب');
  if (!amount || amount <= 0) return alert('المبلغ يجب أن يكون أكبر من صفر');
  if (!date) return alert('التاريخ مطلوب');

  const exps = getExps();

  if (state.editingExpId) {
    const idx = exps.findIndex(e => e.id === state.editingExpId);
    if (idx > -1) {
      exps[idx] = {
        ...exps[idx],
        scope, title, amount, date, category,
        relatedClientId: clientId,
        notes,
      };
    }
    flash('تم تحديث المصروف ✓');
  } else {
    exps.push({
      id: uid(),
      scope,
      title, amount, date, category,
      relatedClientId: clientId,
      notes,
      createdAt: new Date().toISOString(),
    });
    state.expPage = 1;
    flash('تم إضافة المصروف ✓');
  }

  saveExps(exps);
  document.getElementById('expModal').hidden = true;
  renderAll();
}

function deleteExp(id) {
  if (!confirm('حذف هذا المصروف؟')) return;
  saveExps(getExps().filter(e => e.id !== id));
  renderAll();
  flash('تم الحذف');
}

/* =========================================================
   FLASH
   ========================================================= */
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
   TABS
   ========================================================= */
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('tab-subs').hidden     = tab !== 'subs';
  document.getElementById('tab-expenses').hidden = tab !== 'expenses';
}

/* =========================================================
   MAIN RENDER
   ========================================================= */
function renderAll() {
  renderSummary();
  renderRenewalAlerts();
  renderSubsTable();
  renderExpTable();
}

/* =========================================================
   EVENTS
   ========================================================= */
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => switchTab(t.dataset.tab));
});

document.getElementById('addBtn').addEventListener('click', () => {
  if (state.activeTab === 'subs') openSubModal();
  else openExpModal();
});

document.getElementById('saveSubBtn').addEventListener('click', saveSub);
document.getElementById('saveExpBtn').addEventListener('click', saveExp);

document.querySelectorAll('#expScopeSeg button').forEach(btn => {
  btn.addEventListener('click', () => setExpScope(btn.dataset.scope));
});

document.getElementById('subSearch').addEventListener('input', () => {
  state.subPage = 1; renderSubsTable();
});
document.getElementById('subCategoryFilter').addEventListener('change', () => {
  state.subPage = 1; renderSubsTable();
});
document.getElementById('subSort').addEventListener('change', (e) => {
  state.subSort = e.target.value;
  state.subPage = 1;
  renderSubsTable();
});

document.getElementById('exSearch').addEventListener('input', () => {
  state.expPage = 1; renderExpTable();
});
document.getElementById('exScopeFilter').addEventListener('change', (e) => {
  state.expScopeFilter = e.target.value;
  state.expPage = 1;
  renderExpTable();
});
document.getElementById('exCategoryFilter').addEventListener('change', () => {
  state.expPage = 1; renderExpTable();
});
document.getElementById('exSort').addEventListener('change', (e) => {
  state.expSort = e.target.value;
  state.expPage = 1;
  renderExpTable();
});

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-close]');
  if (btn) document.getElementById(btn.dataset.close).hidden = true;
  if (e.target.classList.contains('modal-backdrop')) e.target.hidden = true;
});

/* =========================================================
   BOOT
   ========================================================= */
document.addEventListener('DOMContentLoaded', renderAll);