/* =========================================================
   Personal OS — Other Income Module
   ========================================================= */

const KEYS = { otherIncome: 'po_other_income' };

const Store = {
  get(key, fallback = []) {
    try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) ?? fallback) : fallback; }
    catch { return fallback; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
};

const getIncome  = () => Store.get(KEYS.otherIncome);
const saveIncome = x => Store.set(KEYS.otherIncome, x);

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

const state = {
  editingId:   null,
  currentPage: 1,
  pageSize:    10,
  sortBy:      'date-desc',   // date-desc | date-asc | amount-desc | amount-asc
};

/* ---------- Render ---------- */
function render() {
  const allItems = getIncome().slice();

  /* ===== populate category filter (من كل العناصر، مش بس المفصولة) ===== */
  const cats = [...new Set(allItems.map(i => i.category).filter(Boolean))].sort();
  const sel = document.getElementById('incCategoryFilter');
  const curVal = sel.value;
  sel.innerHTML = '<option value="">كل التصنيفات</option>' +
    cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  sel.value = curVal;

  /* ===== summary (يحسب على كل العناصر بدون فلترة) ===== */
  const total = allItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  document.getElementById('incTotal').textContent = money(total);
  document.getElementById('incCount').textContent = allItems.length;
  document.getElementById('incLast').textContent  = allItems.length
    ? fmtDate([...allItems].sort((a,b)=>b.date.localeCompare(a.date))[0].date)
    : '—';

  const byCat = new Map();
  allItems.forEach(i => {
    const k = i.category || 'Other';
    byCat.set(k, (byCat.get(k) || 0) + (Number(i.amount) || 0));
  });
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
  document.getElementById('incTop').textContent = top ? `${top[0]} (${money(top[1])})` : '—';

  document.getElementById('incomeSub').textContent = allItems.length
    ? `${allItems.length} مصدر دخل إضافي`
    : 'لا يوجد دخل إضافي بعد';

  /* ===== filters ===== */
  let items = allItems.slice();
  const search = (document.getElementById('incSearch').value || '').toLowerCase().trim();
  const cat    = sel.value;

  if (search) items = items.filter(i =>
    (i.source || '').toLowerCase().includes(search) ||
    (i.category || '').toLowerCase().includes(search) ||
    (i.notes || '').toLowerCase().includes(search)
  );
  if (cat) items = items.filter(i => (i.category || '') === cat);

  /* ===== sort ===== */
  items.sort((a, b) => {
    switch (state.sortBy) {
      case 'date-asc':    return a.date.localeCompare(b.date);
      case 'amount-desc': return (Number(b.amount) || 0) - (Number(a.amount) || 0);
      case 'amount-asc':  return (Number(a.amount) || 0) - (Number(b.amount) || 0);
      case 'date-desc':
      default:            return b.date.localeCompare(a.date);
    }
  });

  /* ===== table + empty ===== */
  const tbody = document.getElementById('incomeBody');
  const empty = document.getElementById('incomeEmpty');
  const table = tbody.closest('table');

  if (!items.length) {
    tbody.innerHTML = '';
    renderPagination(0, 0);
    if (!allItems.length) {
      table.style.display = 'none';
      empty.hidden = false;
    } else {
      table.style.display = '';
      empty.hidden = true;
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:30px">لا توجد نتائج مطابقة</td></tr>`;
    }
    return;
  }
  table.style.display = '';
  empty.hidden = true;

  /* ===== pagination math ===== */
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
  if (state.currentPage > totalPages) state.currentPage = totalPages;
  if (state.currentPage < 1) state.currentPage = 1;

  const startIdx  = (state.currentPage - 1) * state.pageSize;
  const pageItems = items.slice(startIdx, startIdx + state.pageSize);

  tbody.innerHTML = '';
  for (const i of pageItems) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtDate(i.date)}</td>
      <td><b>${escapeHtml(i.source || '—')}</b></td>
      <td><span class="cat-chip">${escapeHtml(i.category || 'Other')}</span></td>
      <td class="td-notes">${escapeHtml(i.notes || '—')}</td>
      <td class="td-total">${money(i.amount)}</td>
      <td class="td-actions">
        <button class="icon-btn edit" data-id="${i.id}" title="تعديل">✎</button>
        <button class="icon-btn del"  data-id="${i.id}" title="حذف">🗑</button>
      </td>
    `;
    tr.querySelector('.edit').addEventListener('click', () => openModal(i.id));
    tr.querySelector('.del').addEventListener('click', () => delIncome(i.id));
    tbody.appendChild(tr);
  }

  renderPagination(state.currentPage, totalPages);
  ensureSortSelect();
}

/* ---------- Sort select (يُنشأ ديناميكيًا) ---------- */
function ensureSortSelect() {
  if (document.getElementById('incSort')) return;
  const search = document.getElementById('incSearch');
  if (!search) return;
  const toolbar = search.closest('.toolbar');
  if (!toolbar) return;

  const sel = document.createElement('select');
  sel.id = 'incSort';
  sel.className = 'input-select';
  sel.innerHTML = `
    <option value="date-desc">التاريخ (الأحدث)</option>
    <option value="date-asc">التاريخ (الأقدم)</option>
    <option value="amount-desc">المبلغ (الأعلى)</option>
    <option value="amount-asc">المبلغ (الأدنى)</option>
  `;
  sel.value = state.sortBy;
  sel.addEventListener('change', () => {
    state.sortBy = sel.value;
    state.currentPage = 1;
    render();
  });
  toolbar.appendChild(sel);
}

/* ---------- Pagination (يُنشأ ديناميكيًا) ---------- */
function ensurePaginationEl() {
  let el = document.getElementById('incomePagination');
  if (el) return el;
  const wrap = document.querySelector('#incomeBody')?.closest('.table-wrap');
  if (!wrap) return null;
  el = document.createElement('div');
  el.id = 'incomePagination';
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

  if (startP > 1) {
    html += `<button class="pg-btn" data-page="1">1</button><span class="pg-dots">…</span>`;
  }
  for (let p = startP; p <= endP; p++) {
    html += `<button class="pg-btn ${p === current ? 'active' : ''}" data-page="${p}">${p}</button>`;
  }
  if (endP < total) {
    html += `<span class="pg-dots">…</span><button class="pg-btn" data-page="${total}">${total}</button>`;
  }

  html += `<button class="pg-btn" ${current === total ? 'disabled' : ''} data-page="${current + 1}">›</button>`;
  el.innerHTML = html;

  el.querySelectorAll('.pg-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = Number(btn.dataset.page);
      if (p >= 1 && p <= total && p !== current) {
        state.currentPage = p;
        render();
      }
    });
  });
}

/* ---------- Modal ---------- */
function openModal(id = null) {
  state.editingId = id;
  const title = document.getElementById('incomeModalTitle');
  const modal = document.getElementById('incomeModal');

  if (id) {
    const i = getIncome().find(x => x.id === id);
    title.textContent = 'تعديل مصدر الدخل';
    document.getElementById('iSource').value   = i?.source   || '';
    document.getElementById('iCategory').value = i?.category || '';
    document.getElementById('iAmount').value   = i?.amount   || '';
    document.getElementById('iDate').value     = i?.date     || today();
    document.getElementById('iNotes').value    = i?.notes    || '';
  } else {
    title.textContent = 'مصدر دخل جديد';
    document.getElementById('iSource').value   = '';
    document.getElementById('iCategory').value = '';
    document.getElementById('iAmount').value   = '';
    document.getElementById('iDate').value     = today();
    document.getElementById('iNotes').value    = '';
  }
  modal.hidden = false;
  setTimeout(() => document.getElementById('iSource').focus(), 50);
}

function saveIncomeEntry() {
  const source   = document.getElementById('iSource').value.trim();
  const category = document.getElementById('iCategory').value.trim() || 'Other';
  const amount   = Number(document.getElementById('iAmount').value);
  const date     = document.getElementById('iDate').value || today();
  const notes    = document.getElementById('iNotes').value.trim();

  if (!source) return alert('اسم المصدر مطلوب');
  if (!amount || amount <= 0) return alert('المبلغ يجب أن يكون أكبر من صفر');
  if (!date) return alert('التاريخ مطلوب');

  const items = getIncome();

  if (state.editingId) {
    const idx = items.findIndex(i => i.id === state.editingId);
    if (idx > -1) items[idx] = { ...items[idx], source, category, amount, date, notes };
    flash('تم التحديث ✓');
  } else {
    items.push({ id: uid(), source, category, amount, date, notes, createdAt: new Date().toISOString() });
    state.currentPage = 1;
    flash('تم الإضافة ✓');
  }
  saveIncome(items);
  document.getElementById('incomeModal').hidden = true;
  render();
}

function delIncome(id) {
  if (!confirm('حذف هذا المصدر؟')) return;
  saveIncome(getIncome().filter(i => i.id !== id));
  render();
  flash('تم الحذف');
}

/* ---------- Flash ---------- */
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

/* ---------- Styles (Pagination) ---------- */
(function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .pagination { display: flex; gap: 6px; justify-content: center; align-items: center; padding: 16px 0 4px; flex-wrap: wrap; }
    .pg-btn { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: #8892a6; padding: 6px 12px; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 13px; min-width: 34px; transition: .15s; }
    .pg-btn:hover:not(:disabled) { background: rgba(74,222,128,0.1); border-color: rgba(74,222,128,0.3); color: #4ade80; }
    .pg-btn.active { background: #4ade80; color: #0a1018; border-color: #4ade80; font-weight: 700; }
    .pg-btn:disabled { opacity: .35; cursor: not-allowed; }
    .pg-dots { color: #5a6378; padding: 0 4px; }
  `;
  document.head.appendChild(style);
})();

/* ---------- Events ---------- */
document.getElementById('addIncomeBtn').addEventListener('click', () => openModal());
document.getElementById('saveIncomeBtn').addEventListener('click', saveIncomeEntry);

document.getElementById('incSearch').addEventListener('input', () => {
  state.currentPage = 1;
  render();
});

document.getElementById('incCategoryFilter').addEventListener('change', () => {
  state.currentPage = 1;
  render();
});

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-close]');
  if (btn) document.getElementById(btn.dataset.close).hidden = true;
  if (e.target.classList.contains('modal-backdrop')) e.target.hidden = true;
});

document.addEventListener('DOMContentLoaded', render);