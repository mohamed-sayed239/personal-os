/* =========================================================
   Personal OS — Dashboard Engine v4.0
   READER only. Never creates data.
   ========================================================= */

const KEYS = {
  clients:       'po_clients',
  works:         'po_works',
  otherIncome:   'po_other_income',
  goals:         'po_goals',
  subscriptions: 'po_subscriptions',
  expenses:      'po_expenses',
};

const Store = {
  get(key, fallback = []) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const v = JSON.parse(raw);
      return v ?? fallback;
    } catch { return fallback; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
};

const getClients = () => Store.get(KEYS.clients);
const getWorks   = () => Store.get(KEYS.works);
const getOther   = () => Store.get(KEYS.otherIncome);
const getGoals   = () => Store.get(KEYS.goals);
const getSubs    = () => Store.get(KEYS.subscriptions);
const getExps    = () => Store.get(KEYS.expenses);

/* ---------- Unified Income ---------- */
function buildUnifiedIncome() {
  const clientMap = Object.fromEntries(getClients().map(c => [c.id, c]));
  const entries = [];
  for (const w of getWorks()) {
    const c = clientMap[w.clientId];
    const itemsCount = (w.services || []).reduce((s, x) => s + (Number(x.qty) || 0), 0);
    entries.push({
      id: w.id, kind: 'client', date: w.date,
      amount: Number(w.total) || 0,
      sourceLabel: c?.name || 'عميل غير معروف',
      sourceId: w.clientId, category: 'Freelance', itemsCount,
    });
  }
  for (const o of getOther()) {
    entries.push({
      id: o.id, kind: 'other', date: o.date,
      amount: Number(o.amount) || 0,
      sourceLabel: o.source || 'مصدر آخر',
      sourceId: o.id,
      category: o.category || o.type || 'Other',
      itemsCount: 1,
    });
  }
  return entries
    .filter(e => e.date && !isNaN(new Date(e.date)) && !isNaN(e.amount))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function buildOneTimeExpenses() {
  return getExps()
    .filter(e => e.date && !isNaN(new Date(e.date)))
    .map(e => ({
      id: e.id,
      date: e.date,
      amount: Number(e.amount) || 0,
      title: e.title || 'مصروف',
      category: e.category || 'Other',
      scope: e.scope || (e.relatedClientId ? 'project' : 'project'),
      relatedClientId: e.relatedClientId || null,
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

/* ---------- ✅ نموذج نقدي: يولّد "دفعات" لكل اشتراك من تاريخ إنشائه حتى الآن ---------- */
function buildSubPaymentEntries() {
  const subs = getSubs();
  const now = new Date();
  const endLimit = endOfDay(now);
  const entries = [];

  for (const s of subs) {
    const amount = Number(s.amount) || 0;
    if (amount <= 0) continue;

    /* تاريخ البدء: createdAt (أو اليوم كحل احتياطي) */
    const startDate = s.createdAt
      ? startOfDay(new Date(s.createdAt))
      : startOfDay(now);

    let cursor = new Date(startDate);
    let safety = 0;

    while (cursor <= endLimit && safety < 500) {
      safety++;
      entries.push({
        id: s.id + '-' + cursor.getTime(),
        date: cursor.toISOString().slice(0, 10),
        amount,
        title: s.name || 'اشتراك',
        category: s.category || 'Subscription',
        isSubscription: true,
      });

      if (s.cycle === 'yearly')         cursor.setFullYear(cursor.getFullYear() + 1);
      else if (s.cycle === 'quarterly') cursor.setMonth(cursor.getMonth() + 3);
      else                              cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  return entries.sort((a, b) => new Date(a.date) - new Date(b.date));
}

function monthlySubCost() {
  return getSubs()
    .filter(s => s.active)
    .reduce((sum, s) => {
      const amt = Number(s.amount) || 0;
      if (s.cycle === 'yearly')    return sum + amt / 12;
      if (s.cycle === 'quarterly') return sum + amt / 3;
      return sum + amt;
    }, 0);
}

/* ✅ حساب تكلفة الاشتراكات في نطاق = مجموع الدفعات داخل النطاق */
function subCostInRange(range) {
  return buildSubPaymentEntries()
    .filter(e => {
      const d = new Date(e.date);
      return d >= range.start && d <= range.end;
    })
    .reduce((s, e) => s + e.amount, 0);
}

function expensesBreakdownInRange(range, period, allIncome) {
  const oneTime = buildOneTimeExpenses()
    .filter(e => { const d = new Date(e.date); return d >= range.start && d <= range.end; })
    .reduce((s, e) => s + e.amount, 0);

  const subs = subCostInRange(range);
  return { oneTime, subs, total: oneTime + subs };
}

function expensesInRange(range, period, allIncome) {
  return expensesBreakdownInRange(range, period, allIncome).total;
}

/* ---------- Date Helpers ---------- */
const startOfDay = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay   = d => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
const AR_MONTHS  = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const AR_DAYS    = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];

function getRange(period, from, to) {
  const now = new Date();
  let start = new Date(0), end = endOfDay(now);
  switch (period) {
    case 'today': start = startOfDay(now); break;
    case 'week': {
      const day = now.getDay();
      start = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - day));
      break;
    }
    case 'month': start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)); break;
    case 'lastMonth':
      start = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      end   = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      break;
    case 'custom':
      start = from ? startOfDay(new Date(from)) : new Date(0);
      end   = to ? endOfDay(new Date(to)) : endOfDay(now);
      break;
    case 'all':
    default: start = new Date(0);
  }
  return { start, end };
}

function getPreviousRange(range) {
  const dur = range.end.getTime() - range.start.getTime();
  return {
    start: new Date(range.start.getTime() - dur - 1),
    end:   new Date(range.start.getTime() - 1),
  };
}

function filterByRange(entries, range) {
  return entries.filter(e => {
    const d = new Date(e.date);
    return d >= range.start && d <= range.end;
  });
}

/* ---------- Aggregations ---------- */
const sum = arr => arr.reduce((s, e) => s + e.amount, 0);

function groupSum(entries, keyFn) {
  const map = new Map();
  for (const e of entries) {
    const k = keyFn(e);
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + e.amount);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/* ---------- Formatting ---------- */
const nf = new Intl.NumberFormat('en-US');
const money = n => nf.format(Math.round(n)) + ' ج.م';
const pct   = n => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

function formatRangeLabel(range, period) {
  const f = d => `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (period === 'today')     return f(range.start);
  if (period === 'all')       return 'كل الفترات';
  if (period === 'lastMonth') return `${AR_MONTHS[range.start.getMonth()]} ${range.start.getFullYear()}`;
  return `${f(range.start)}  ←  ${f(range.end)}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

/* ---------- Charts ---------- */
Chart.defaults.color = '#8892a6';
Chart.defaults.font.family = "'Cairo', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';

const charts = {};
function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); charts[key] = null; }
}

function getBucketKey(date, unit) {
  const d = new Date(date);
  if (unit === 'hour')  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
  if (unit === 'month') return `${d.getFullYear()}-${d.getMonth()}`;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function bucketize(entries, range, unit) {
  const map = new Map();
  const keys = [];
  const labels = [];

  const cursor = new Date(range.start);
  const end = new Date(range.end);
  if (unit === 'hour')  cursor.setMinutes(0,0,0);
  if (unit === 'month') { cursor.setDate(1); cursor.setHours(0,0,0,0); }

  let safety = 0;
  while (cursor <= end && safety < 500) {
    safety++;
    const k = getBucketKey(cursor, unit);
    keys.push(k);
    map.set(k, 0);

    if (unit === 'hour')       labels.push(`${String(cursor.getHours()).padStart(2,'0')}:00`);
    else if (unit === 'month') labels.push(`${AR_MONTHS[cursor.getMonth()].slice(0,3)} ${cursor.getFullYear()}`);
    else                       labels.push(`${cursor.getDate()}/${cursor.getMonth()+1}`);

    if (unit === 'hour')       cursor.setHours(cursor.getHours() + 1);
    else if (unit === 'month') cursor.setMonth(cursor.getMonth() + 1);
    else                       cursor.setDate(cursor.getDate() + 1);
  }

  for (const e of entries) {
    const k = getBucketKey(e.date, unit);
    if (map.has(k)) map.set(k, map.get(k) + (Number(e.amount) || 0));
  }
  return { labels, values: keys.map(k => map.get(k)) };
}

function pickUnit(range, period) {
  if (period === 'today') return 'hour';
  const days = (range.end - range.start) / 86400000;
  if (period === 'all' || days > 120) return 'month';
  return 'day';
}

function renderIncomeOverTime(entries, range, period) {
  destroyChart('overTime');
  const unit = pickUnit(range, period);

  let effRange = range;
  if (period === 'all') {
    if (entries.length) {
      const earliest = new Date(entries[0].date);
      effRange = { start: startOfDay(new Date(earliest.getFullYear(), earliest.getMonth(), 1)), end: range.end };
    } else {
      const now = new Date();
      effRange = { start: startOfDay(new Date(now.getFullYear(), now.getMonth() - 5, 1)), end: range.end };
    }
  }

  const { labels, values } = bucketize(entries, effRange, unit);

  /* ✅ الاشتراكات تظهر كدفعات (spikes) بدل خط ثابت */
  const expEntries = [...buildOneTimeExpenses(), ...buildSubPaymentEntries()];
  const { values: expenseValues } = bucketize(expEntries, effRange, unit);

  const ctx = document.getElementById('chartIncomeOverTime').getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, 'rgba(74,222,128,0.35)');
  gradient.addColorStop(1, 'rgba(74,222,128,0.0)');

  charts.overTime = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'الدخل', data: values,
          borderColor: '#4ade80', backgroundColor: gradient,
          borderWidth: 2, fill: true, tension: 0.35,
          pointRadius: values.length > 40 ? 0 : 3,
          pointHoverRadius: 5, pointBackgroundColor: '#4ade80',
        },
        {
          label: 'المصروفات (شامل الاشتراكات)', data: expenseValues,
          borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.08)',
          borderWidth: 2, borderDash: [5, 4], fill: false, tension: 0.35,
          pointRadius: expenseValues.length > 40 ? 0 : 3,
          pointHoverRadius: 5, pointBackgroundColor: '#f87171',
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true, position: 'bottom', rtl: true, textDirection: 'rtl',
          labels: { boxWidth: 10, boxHeight: 10, padding: 14, usePointStyle: true, pointStyle: 'circle' }
        },
        tooltip: {
          rtl: true, textDirection: 'rtl',
          backgroundColor: '#131a28', borderColor: '#222d42', borderWidth: 1,
          padding: 10, titleColor: '#e8edf7', bodyColor: '#8892a6',
          callbacks: { label: c => ' ' + c.dataset.label + ': ' + money(c.parsed.y) }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => nf.format(v) } }
      }
    }
  });
}

function renderBySource(entries) {
  destroyChart('bySource');
  const grouped = groupSum(entries, e => e.kind === 'client' ? 'Freelance' : (e.category || 'Other'));
  const palette = ['#4ade80', '#38bdf8', '#a78bfa', '#fbbf24', '#f87171', '#34d399', '#60a5fa'];
  const ctx = document.getElementById('chartBySource').getContext('2d');

  charts.bySource = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: grouped.length ? grouped.map(g => g[0]) : ['لا توجد بيانات'],
      datasets: [{
        data: grouped.length ? grouped.map(g => g[1]) : [1],
        backgroundColor: grouped.length ? palette.slice(0, grouped.length) : ['#1a2333'],
        borderWidth: 0, hoverOffset: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: {
        legend: { position: 'bottom', rtl: true, textDirection: 'rtl', labels: { boxWidth: 10, boxHeight: 10, padding: 14, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: {
          rtl: true, textDirection: 'rtl',
          backgroundColor: '#131a28', borderColor: '#222d42', borderWidth: 1,
          callbacks: {
            label: c => {
              const total = c.dataset.data.reduce((a, b) => a + b, 0);
              const v = c.parsed;
              const p = total ? ((v / total) * 100).toFixed(1) : 0;
              return ` ${money(v)} (${p}%)`;
            }
          }
        }
      }
    }
  });
}

function renderByClient(entries) {
  destroyChart('byClient');
  const clientOnly = entries.filter(e => e.kind === 'client');
  const grouped = groupSum(clientOnly, e => e.sourceLabel).slice(0, 6);
  const ctx = document.getElementById('chartByClient').getContext('2d');

  charts.byClient = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: grouped.length ? grouped.map(g => g[0]) : ['لا توجد بيانات'],
      datasets: [{
        data: grouped.length ? grouped.map(g => g[1]) : [0],
        backgroundColor: '#38bdf8', borderRadius: 8, barThickness: 18,
      }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true, textDirection: 'rtl',
          backgroundColor: '#131a28', borderColor: '#222d42', borderWidth: 1,
          callbacks: { label: c => ' ' + money(c.parsed.x) }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => nf.format(v) } },
        y: { grid: { display: false } }
      }
    }
  });
}

/* ---------- Expense Breakdown ---------- */
function renderExpenseBreakdown() {
  destroyChart('expenseBreakdown');
  const exps = buildOneTimeExpenses();
  const sixMonthsAgo = new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1);
  const recent = exps.filter(e => new Date(e.date) >= sixMonthsAgo);
  const projRecent = recent.filter(e => e.scope === 'project').reduce((s, e) => s + e.amount, 0);
  const persRecent = recent.filter(e => e.scope === 'personal').reduce((s, e) => s + e.amount, 0);

  /* ✅ اشتراكات = دفعات فعلية في آخر 6 أشهر */
  const subsRecent = buildSubPaymentEntries()
    .filter(e => new Date(e.date) >= sixMonthsAgo)
    .reduce((s, e) => s + e.amount, 0);

  const hasData = projRecent > 0 || persRecent > 0 || subsRecent > 0;
  const ctx = document.getElementById('chartExpenseBreakdown').getContext('2d');

  charts.expenseBreakdown = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: hasData ? ['اشتراكات', 'مشاريع', 'شخصي'] : ['لا توجد بيانات'],
      datasets: [{
        data: hasData ? [subsRecent, projRecent, persRecent] : [1],
        backgroundColor: hasData ? ['#f87171', '#38bdf8', '#a78bfa'] : ['#1a2333'],
        borderWidth: 0, hoverOffset: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: {
        legend: { position: 'bottom', rtl: true, textDirection: 'rtl', labels: { boxWidth: 10, boxHeight: 10, padding: 14, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: {
          rtl: true, textDirection: 'rtl',
          backgroundColor: '#131a28', borderColor: '#222d42', borderWidth: 1,
          callbacks: {
            label: c => {
              const total = c.dataset.data.reduce((a, b) => a + b, 0);
              const v = c.parsed;
              const p = total ? ((v / total) * 100).toFixed(1) : 0;
              return ` ${money(v)} (${p}%)`;
            }
          }
        }
      }
    }
  });
}

/* ---------- Cash Flow Forecast ---------- */
function renderCashFlow() {
  destroyChart('cashFlow');
  const now = new Date();
  const byMonth = new Map();
  for (const e of buildUnifiedIncome()) {
    const d = new Date(e.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    byMonth.set(key, (byMonth.get(key) || 0) + e.amount);
  }

  let incomeSum = 0, count = 0;
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const v = byMonth.get(key) || 0;
    if (v > 0) { incomeSum += v; count++; }
  }
  const avgIncome = count > 0 ? incomeSum / count : 0;

  const oneTime = buildOneTimeExpenses();
  const subPayments = buildSubPaymentEntries();
  let oneTimeSum = 0, subSum = 0;
  for (let i = 1; i <= 3; i++) {
    const s = startOfDay(new Date(now.getFullYear(), now.getMonth() - i, 1));
    const e2 = endOfDay(new Date(now.getFullYear(), now.getMonth() - i + 1, 0));
    oneTimeSum += oneTime.filter(x => { const d = new Date(x.date); return d >= s && d <= e2; })
                         .reduce((sum, x) => sum + x.amount, 0);
    subSum += subPayments.filter(x => { const d = new Date(x.date); return d >= s && d <= e2; })
                         .reduce((sum, x) => sum + x.amount, 0);
  }
  const avgOneTime = oneTimeSum / 3;
  const avgSub = subSum / 3;
  const avgExpense = avgOneTime + avgSub;

  const labels = [], incomeData = [], expenseData = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    labels.push(AR_MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear());
    incomeData.push(avgIncome);
    expenseData.push(avgExpense);
  }

  const ctx = document.getElementById('chartCashFlow').getContext('2d');

  charts.cashFlow = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'دخل متوقع', data: incomeData, backgroundColor: 'rgba(74,222,128,0.7)', borderRadius: 6 },
        { label: 'مصروفات متوقعة', data: expenseData, backgroundColor: 'rgba(248,113,113,0.7)', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', rtl: true, textDirection: 'rtl', labels: { boxWidth: 10, boxHeight: 10, padding: 14, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: {
          rtl: true, textDirection: 'rtl',
          backgroundColor: '#131a28', borderColor: '#222d42', borderWidth: 1,
          callbacks: { label: c => ' ' + c.dataset.label + ': ' + money(c.parsed.y) }
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => nf.format(v) } }
      }
    }
  });
}

/* ---------- Financial Snapshot ---------- */
function computeBurnRate() {
  const now = new Date();
  const oneTime = buildOneTimeExpenses();
  const subPayments = buildSubPaymentEntries();
  let burnSum = 0;
  for (let i = 1; i <= 3; i++) {
    const s = startOfDay(new Date(now.getFullYear(), now.getMonth() - i, 1));
    const e = endOfDay(new Date(now.getFullYear(), now.getMonth() - i + 1, 0));
    const m = oneTime.filter(x => { const d = new Date(x.date); return d >= s && d <= e; })
                     .reduce((sum, x) => sum + x.amount, 0);
    const subM = subPayments.filter(x => { const d = new Date(x.date); return d >= s && d <= e; })
                            .reduce((sum, x) => sum + x.amount, 0);
    burnSum += m + subM;
  }
  return burnSum / 3;
}

function renderFinancialSnapshot(range, period, allIncome) {
  const mrr = monthlySubCost();
  const arr = mrr * 12;

  const { total: totalExp } = expensesBreakdownInRange(range, period, allIncome);
  const totalIncome = sum(filterByRange(allIncome, range));
  const net = totalIncome - totalExp;
  const margin = totalIncome > 0 ? (net / totalIncome) * 100 : 0;
  const burnRate = computeBurnRate();

  let runway = null;
  if (net > 0 && burnRate > 0) runway = net / burnRate;
  else if (net <= 0) runway = 0;

  document.getElementById('finMRR').textContent  = money(mrr);
  document.getElementById('finARR').textContent  = money(arr);

  const marginEl = document.getElementById('finMargin');
  marginEl.textContent = margin.toFixed(0) + '%';
  marginEl.classList.remove('positive','negative','warn');
  marginEl.classList.add(margin >= 50 ? 'positive' : margin >= 20 ? 'warn' : 'negative');

  document.getElementById('finBurn').textContent = money(burnRate);

  const runwayEl = document.getElementById('finRunway');
  runwayEl.classList.remove('positive','warn','negative');
  if (runway === null) {
    runwayEl.textContent = '∞';
    runwayEl.classList.add('positive');
  } else if (runway === 0) {
    runwayEl.textContent = '0';
    runwayEl.classList.add('negative');
  } else {
    runwayEl.textContent = runway.toFixed(1) + ' شهر';
    runwayEl.classList.add(runway >= 6 ? 'positive' : runway >= 3 ? 'warn' : 'negative');
  }

  const netEl = document.getElementById('finNet');
  netEl.textContent = money(net);
  netEl.classList.remove('positive','negative','warn');
  netEl.classList.add(net >= 0 ? 'positive' : 'negative');
}

/* ---------- ✅ Period Summary (was YTD) — يستجيب للفلتر ---------- */
function renderPeriodSummary(range, period, allIncome) {
  const income = sum(filterByRange(allIncome, range));

  const oneTime = buildOneTimeExpenses()
    .filter(e => { const d = new Date(e.date); return d >= range.start && d <= range.end; })
    .reduce((s, e) => s + e.amount, 0);

  const subs = subCostInRange(range);
  const totalExp = oneTime + subs;
  const net = income - totalExp;

  const works = getWorks()
    .filter(w => { const d = new Date(w.date); return d >= range.start && d <= range.end; }).length;

  document.getElementById('ytdIncome').textContent   = money(income);
  document.getElementById('ytdExpenses').textContent = money(totalExp);
  document.getElementById('ytdNet').textContent      = money(net);
  document.getElementById('ytdWorks').textContent    = nf.format(works);

  /* النصوص الفرعية تتغير حسب الفترة */
  document.getElementById('ytdIncomeSub').textContent   = formatRangeLabel(range, period);
  document.getElementById('ytdExpensesSub').textContent = subs > 0
    ? `${money(oneTime)} + اشتراكات ${money(subs)}`
    : `${money(oneTime)} مصروفات`;
  document.getElementById('ytdNetSub').textContent      = net >= 0 ? 'ربح' : 'خسارة';
  document.getElementById('ytdWorksSub').textContent    = `${works} عمل في هذه الفترة`;

  document.getElementById('ytdNet').style.color = net >= 0 ? '#4ade80' : '#f87171';
}

/* ---------- Monthly Comparison ---------- */
function renderMonthlyComparison() {
  const el = document.getElementById('monthlyComparison');
  if (!el) return;
  const allIncome = buildUnifiedIncome();
  const exps = buildOneTimeExpenses();
  const subPayments = buildSubPaymentEntries();
  const now = new Date();

  const rows = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = startOfDay(d);
    const end = endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));

    const income = allIncome
      .filter(e => { const dd = new Date(e.date); return dd >= start && dd <= end; })
      .reduce((s, e) => s + e.amount, 0);

    const oneTime = exps
      .filter(e => { const dd = new Date(e.date); return dd >= start && dd <= end; })
      .reduce((s, e) => s + e.amount, 0);

    /* ✅ اشتراكات فعلية لكل شهر */
    const subs = subPayments
      .filter(e => { const dd = new Date(e.date); return dd >= start && dd <= end; })
      .reduce((s, e) => s + e.amount, 0);

    const expTotal = oneTime + subs;
    const net = income - expTotal;

    rows.push({
      label: `${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
      income, oneTime, subs, expTotal, net,
    });
  }

  let html = `<div class="table-wrap"><table class="mc-table"><thead><tr>
    <th>الشهر</th><th>الدخل</th><th>مصروفات لمرة واحدة</th><th>اشتراكات</th><th>إجمالي</th><th>صافي الربح</th><th>النمو</th>
  </tr></thead><tbody>`;

  rows.forEach((r, idx) => {
    const prev = idx > 0 ? rows[idx - 1] : null;
    let growthHTML = '<span class="mc-growth flat">—</span>';
    if (prev && prev.income > 0) {
      const g = ((r.income - prev.income) / prev.income) * 100;
      const cls = g > 2 ? 'positive' : g < -2 ? 'negative' : 'flat';
      const arrow = g > 2 ? '↑' : g < -2 ? '↓' : '→';
      growthHTML = `<span class="mc-growth ${cls}">${arrow} ${g.toFixed(1)}%</span>`;
    }

    html += `<tr>
      <td class="mc-month">${r.label}</td>
      <td class="mc-rev">${money(r.income)}</td>
      <td style="color:#fbbf24">${r.oneTime > 0 ? money(r.oneTime) : '—'}</td>
      <td style="color:#f87171">${r.subs > 0 ? money(r.subs) : '—'}</td>
      <td class="mc-exp">${money(r.expTotal)}</td>
      <td class="mc-net ${r.net >= 0 ? 'positive' : 'negative'}">${money(r.net)}</td>
      <td>${growthHTML}</td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  el.innerHTML = html;
}

/* ---------- Client Profitability ---------- */
function renderClientProfitability() {
  const el = document.getElementById('clientProfitability');
  if (!el) return;
  const clients = getClients();
  const works = getWorks();
  const exps = buildOneTimeExpenses();

  if (!clients.length) {
    el.innerHTML = `<div class="empty-mini">لا يوجد عملاء بعد</div>`;
    return;
  }

  const rows = clients.map(c => {
    const cWorks = works.filter(w => w.clientId === c.id);
    const rev = cWorks.reduce((s, w) => s + (Number(w.total) || 0), 0);
    const cost = exps
      .filter(e => e.relatedClientId === c.id)
      .reduce((s, e) => s + e.amount, 0);
    const net = rev - cost;
    const margin = rev > 0 ? (net / rev) * 100 : 0;

    const avgWork = cWorks.length ? rev / cWorks.length : 0;
    let monthlyFreq = 0;
    if (cWorks.length > 1) {
      const dates = cWorks.map(w => new Date(w.date).getTime()).sort();
      const span = Math.max(1, (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24));
      monthlyFreq = cWorks.length / Math.max(1, span / 30.44);
    } else if (cWorks.length === 1) {
      monthlyFreq = 1;
    }
    const ltv = avgWork * monthlyFreq * 12;

    return { name: c.name, rev, cost, net, margin, ltv };
  }).sort((a, b) => b.net - a.net);

  const maxAbs = Math.max(...rows.map(r => Math.abs(r.net)), 1);

  let html = `<div class="table-wrap"><table class="profit-table"><thead><tr>
    <th>العميل</th><th>الإيراد</th><th>التكلفة</th><th>صافي الربح</th><th>هامش</th><th>LTV سنوي متوقع</th>
  </tr></thead><tbody>`;

  for (const r of rows) {
    const pctW = (Math.abs(r.net) / maxAbs) * 100;
    const color = r.net >= 0 ? '#4ade80' : '#f87171';
    html += `<tr>
      <td class="p-client">${escapeHtml(r.name)}</td>
      <td class="p-rev">${money(r.rev)}</td>
      <td class="p-cost">${r.cost > 0 ? money(r.cost) : '—'}</td>
      <td class="p-net ${r.net >= 0 ? 'positive' : 'negative'}">
        ${money(r.net)}
        <div class="profit-bar"><div class="profit-bar-fill" style="width:${pctW}%;background:${color}"></div></div>
      </td>
      <td style="color:${r.margin >= 50 ? '#4ade80' : r.margin >= 0 ? '#fbbf24' : '#f87171'}">
        ${r.rev > 0 ? r.margin.toFixed(0) + '%' : '—'}
      </td>
      <td class="p-ltv">${r.ltv > 0 ? money(r.ltv) : '—'}</td>
    </tr>`;
  }

  html += `</tbody></table></div>`;
  el.innerHTML = html;
}

/* ---------- Weekly Rhythm ---------- */
function renderWeeklyRhythm() {
  const el = document.getElementById('weeklyRhythm');
  if (!el) return;
  const byDay = new Array(7).fill(0);
  for (const e of buildUnifiedIncome()) byDay[new Date(e.date).getDay()] += e.amount;

  const total = byDay.reduce((s, v) => s + v, 0);
  const max = Math.max(...byDay, 1);
  const bestIdx = byDay.indexOf(max);

  if (total === 0) {
    el.innerHTML = `<div class="empty-mini" style="grid-column:1/-1;padding:20px;">لا توجد بيانات كافية</div>`;
    return;
  }

  el.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const val = byDay[i];
    const h = max > 0 ? (val / max) * 60 : 0;
    const isBest = i === bestIdx && val > 0;
    const div = document.createElement('div');
    div.className = 'rhythm-day' + (isBest ? ' best' : '');
    div.innerHTML = `
      <span class="rl">${AR_DAYS[i]}</span>
      <div class="rhythm-bar-wrap">
        <div class="rhythm-bar" style="height:${Math.max(h, 2)}px;${isBest ? '' : 'background:linear-gradient(180deg,#38bdf8,#0ea5e9);'}"></div>
      </div>
      <span class="rv">${val > 0 ? nf.format(Math.round(val)) : '—'}</span>
    `;
    el.appendChild(div);
  }
}

/* ---------- Insights ---------- */
function generateInsights(entries, prevEntries, range, period) {
  const out = [];
  const total = sum(entries);
  const prevTotal = sum(prevEntries);

  if (!entries.length) {
    out.push({ type: 'info', title: 'لا توجد بيانات في هذه الفترة', text: 'ابدأ بتسجيل عمل من صفحة العملاء أو أضف مصدر دخل.' });
    return out;
  }

  if (prevTotal > 0) {
    const change = ((total - prevTotal) / prevTotal) * 100;
    if (change >= 15)      out.push({ type: 'good', title: 'الدخل في ارتفاع', text: `الدخل زاد بنسبة ${pct(change)} مقارنة بالفترة السابقة.` });
    else if (change <= -15) out.push({ type: 'bad',  title: 'الدخل في انخفاض', text: `الدخل انخفض بنسبة ${pct(change)}.` });
    else                    out.push({ type: 'info', title: 'الدخل مستقر', text: `التغيير طفيف (${pct(change)}).` });
  }

  const byClient = groupSum(entries.filter(e => e.kind === 'client'), e => e.sourceLabel);
  if (byClient.length && total > 0) {
    const [topName, topVal] = byClient[0];
    const share = (topVal / total) * 100;
    if (share >= 60) out.push({ type: 'warn', title: 'اعتماد مرتفع على عميل واحد', text: `${share.toFixed(0)}% من دخلك من "${topName}".` });
    else if (byClient.length >= 3) out.push({ type: 'good', title: 'تنويع جيد للعملاء', text: `${byClient.length} عملاء نشطين.` });
  }

  const weeklyTotals = weeklyBuckets(entries, 6);
  if (weeklyTotals.filter(v => v > 0).length >= 3) {
    const mean = weeklyTotals.reduce((a, b) => a + b, 0) / weeklyTotals.length;
    const variance = weeklyTotals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / weeklyTotals.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    if (cv > 0.8)      out.push({ type: 'warn', title: 'دخل غير مستقر', text: `تذبذب كبير (CV = ${cv.toFixed(2)}).` });
    else if (cv < 0.35) out.push({ type: 'good', title: 'دخل مستقر نسبيًا', text: `توزيع منتظم (CV = ${cv.toFixed(2)}).` });
  }

  const works = entries.filter(e => e.kind === 'client');
  if (works.length >= 5) {
    const avg = sum(works) / works.length;
    if (avg < 60) out.push({ type: 'warn', title: 'متوسط قيمة العمل منخفض', text: `المتوسط ${money(avg)}.` });
  }

  const dayCount = Math.max(1, Math.round((range.end - range.start) / 86400000));
  const activeDays = new Set(entries.map(e => new Date(e.date).toDateString())).size;
  if (dayCount >= 7 && dayCount <= 90 && activeDays / dayCount < 0.3) {
    out.push({ type: 'info', title: 'فترات بدون دخل', text: `${activeDays} من ${dayCount} يوم بها نشاط فقط.` });
  }

  const byCat = groupSum(entries, e => e.kind === 'client' ? 'Freelance' : (e.category || 'Other'));
  if (byCat.length > 1) {
    const [name, val] = byCat[0];
    out.push({ type: 'good', title: 'أفضل مصدر دخل', text: `"${name}" يحقق ${money(val)}.` });
  }

  const { total: exp, subs } = expensesBreakdownInRange(range, period, entries);
  if (total > 0 && exp > 0) {
    const profitPct = ((total - exp) / total) * 100;
    if (profitPct < 30) out.push({ type: 'bad', title: 'هامش ربح منخفض', text: `مصروفاتك ${(100 - profitPct).toFixed(0)}% من دخلك.` });
    else if (profitPct > 70) out.push({ type: 'good', title: 'هامش ربح صحي', text: `هامش ${profitPct.toFixed(0)}% — ممتاز.` });
  }

  if (exp > 0 && subs > 0) {
    const subShare = (subs / exp) * 100;
    if (subShare > 60) out.push({ type: 'warn', title: 'الاشتراكات تمثل نسبة كبيرة', text: `${subShare.toFixed(0)}% من مصروفات الفترة اشتراكات.` });
  }

  const net = total - exp;
  const burn = computeBurnRate();
  if (burn > 0 && net > 0) {
    const runway = net / burn;
    if (runway >= 6) out.push({ type: 'good', title: 'Runway صحي', text: `صافي ربحك يغطي ${runway.toFixed(1)} شهر.` });
    else if (runway < 2) out.push({ type: 'warn', title: 'Runway قصير', text: `صافي ربحك يغطي ${runway.toFixed(1)} شهر فقط.` });
  }

  const dayAgg = new Array(7).fill(0);
  for (const e of entries) dayAgg[new Date(e.date).getDay()] += e.amount;
  const bestDay = dayAgg.indexOf(Math.max(...dayAgg));
  if (dayAgg[bestDay] > 0 && total > 0 && dayAgg[bestDay] / total > 0.35) {
    out.push({ type: 'info', title: 'أفضل يوم في الأسبوع', text: `${AR_DAYS[bestDay]} يمثل ${(dayAgg[bestDay] / total * 100).toFixed(0)}% من دخلك.` });
  }

  return out;
}

function weeklyBuckets(entries, weeksBack) {
  const now = new Date();
  const buckets = new Array(weeksBack).fill(0);
  for (const e of entries) {
    const d = new Date(e.date);
    const diffDays = Math.floor((now - d) / 86400000);
    const idx = Math.floor(diffDays / 7);
    if (idx >= 0 && idx < weeksBack) buckets[weeksBack - 1 - idx] += e.amount;
  }
  return buckets;
}

/* ---------- KPIs ---------- */
function renderKPIs(entries, prevEntries, range, prevRange, period, allIncome) {
  const total = sum(entries);
  const prevTotal = sum(prevEntries);
  const works = entries.filter(e => e.kind === 'client');
  const prevWorks = prevEntries.filter(e => e.kind === 'client');

  const allClients    = getClients().length;
  const activeClients = new Set(works.map(w => w.sourceId)).size;

  const avg     = works.length     ? sum(works) / works.length         : 0;
  const prevAvg = prevWorks.length ? sum(prevWorks) / prevWorks.length : 0;

  const expNow  = expensesInRange(range,     period, allIncome);
  const expPrev = expensesInRange(prevRange, period, allIncome);
  const profit     = total - expNow;
  const prevProfit = prevTotal - expPrev;

  document.getElementById('kpiIncome').textContent  = money(total);
  document.getElementById('kpiWorks').textContent   = nf.format(works.length);
  document.getElementById('kpiAvg').textContent     = money(avg);
  document.getElementById('kpiClients').textContent = nf.format(allClients);

  const profitEl = document.getElementById('kpiProfit');
  profitEl.textContent = money(profit);
  profitEl.classList.remove('positive', 'negative');
  profitEl.classList.add(profit >= 0 ? 'positive' : 'negative');

  document.getElementById('kpiIncomeDelta').innerHTML = deltaHTML(total, prevTotal);
  document.getElementById('kpiWorksDelta').innerHTML  = deltaHTML(works.length, prevWorks.length, false);
  document.getElementById('kpiAvgDelta').innerHTML    = deltaHTML(avg, prevAvg);

  const profitDeltaEl = document.getElementById('kpiProfitDelta');
  if (prevProfit === 0 && profit === 0) {
    profitDeltaEl.innerHTML = `<span class="delta-flat">لا توجد بيانات</span>`;
  } else if (expNow > 0) {
    profitDeltaEl.innerHTML = `<span class="delta-muted">مصروفات المدة (شامل الاشتراكات): ${money(expNow)}</span>`;
  } else {
    profitDeltaEl.innerHTML = `<span class="delta-muted">بدون مصروفات</span>`;
  }

  document.getElementById('kpiClientsDelta').textContent =
    allClients === 0 ? 'أضف عميلك الأول'
    : (activeClients ? `${activeClients} نشط` : 'لا نشاط');
}

function deltaHTML(curr, prev, isMoney = true) {
  if (prev === 0 && curr === 0) return `<span class="delta-flat">لا توجد بيانات</span>`;
  if (prev === 0) return `<span class="delta-up">↑ جديد</span>`;
  const change = ((curr - prev) / prev) * 100;
  const cls = change > 2 ? 'delta-up' : change < -2 ? 'delta-down' : 'delta-flat';
  const arrow = change > 2 ? '↑' : change < -2 ? '↓' : '→';
  const prevStr = isMoney ? money(prev) : nf.format(prev);
  return `<span class="${cls}">${arrow} ${pct(change)}</span> <span class="delta-muted">مقابل ${prevStr}</span>`;
}

function renderInsights(insights) {
  const el = document.getElementById('insightsList');
  el.innerHTML = '';
  const icons = { good: '✓', warn: '!', bad: '✕', info: 'i' };
  insights.forEach(i => {
    const li = document.createElement('li');
    li.className = `insight insight-${i.type}`;
    li.innerHTML = `
      <div class="insight-icon">${icons[i.type] || 'i'}</div>
      <div class="insight-body">
        <div class="insight-title">${i.title}</div>
        <div class="insight-text">${i.text}</div>
      </div>
    `;
    el.appendChild(li);
  });
}

function renderTopSources(entries) {
  const el = document.getElementById('topSources');
  el.innerHTML = '';
  const grouped = groupSum(entries, e => e.sourceLabel).slice(0, 6);
  if (!grouped.length) { el.innerHTML = `<div class="empty-mini">لا توجد مصادر دخل بعد</div>`; return; }
  const total = sum(entries);
  const palette = ['#4ade80', '#38bdf8', '#a78bfa', '#fbbf24', '#f87171', '#34d399'];
  grouped.forEach(([name, val], idx) => {
    const share = total ? (val / total) * 100 : 0;
    const row = document.createElement('div');
    row.className = 'source-row';
    row.innerHTML = `
      <span class="source-dot" style="background:${palette[idx % palette.length]}"></span>
      <div class="source-info">
        <div class="source-name">${escapeHtml(name)}</div>
        <div class="source-meta">${share.toFixed(0)}% من إجمالي الدخل</div>
      </div>
      <div class="source-amount">${money(val)}</div>
    `;
    el.appendChild(row);
  });
}

/* ---------- Smart Goals ---------- */
function computeSmartGoals() {
  const allIncome = buildUnifiedIncome();
  const now = new Date();
  if (!allIncome.length) return { hasAnyData: false };

  const byMonth = new Map();
  for (const e of allIncome) {
    const d = new Date(e.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    byMonth.set(key, (byMonth.get(key) || 0) + e.amount);
  }

  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey  = `${lastMonthDate.getFullYear()}-${lastMonthDate.getMonth()}`;
  const lastMonthTotal = byMonth.get(lastMonthKey) || 0;

  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const prevMonthKey  = `${prevMonthDate.getFullYear()}-${prevMonthDate.getMonth()}`;
  const prevMonthTotal = byMonth.get(prevMonthKey) || 0;

  const currMonthKey  = `${now.getFullYear()}-${now.getMonth()}`;
  const currMonthTotal = byMonth.get(currMonthKey) || 0;

  let growthRate = 0.10;
  let growthReason = 'افتراضي +10%';
  if (prevMonthTotal > 0 && lastMonthTotal > 0) {
    const actual = (lastMonthTotal - prevMonthTotal) / prevMonthTotal;
    growthRate = Math.max(0.05, Math.min(0.25, actual));
    growthReason = `نمو فعلي ${(actual * 100).toFixed(0)}%`;
  } else if (lastMonthTotal > 0) {
    growthRate = 0.15;
    growthReason = 'شهر أول +15%';
  }

  const base = lastMonthTotal > 0 ? lastMonthTotal : currMonthTotal;
  let monthTarget = base > 0 ? Math.ceil(base * (1 + growthRate) / 100) * 100 : 5000;
  if (currMonthTotal > monthTarget) monthTarget = Math.ceil(currMonthTotal * 1.15 / 100) * 100;

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const daysLeft    = Math.max(0, daysInMonth - daysElapsed);
  const pace        = daysElapsed > 0 ? currMonthTotal / daysElapsed : 0;
  const needed      = Math.max(0, monthTarget - currMonthTotal);
  const perDay      = daysLeft > 0 ? needed / daysLeft : 0;
  const projected   = pace * daysInMonth;

  const bySource = new Map();
  for (const e of allIncome) {
    const d = new Date(e.date);
    const mKey = `${d.getFullYear()}-${d.getMonth()}`;
    const src = e.sourceLabel || 'غير معروف';
    if (!bySource.has(src)) bySource.set(src, {});
    const rec = bySource.get(src);
    rec[mKey] = (rec[mKey] || 0) + e.amount;
  }

  let bestSource = null;
  let bestScore = -Infinity;
  for (const [name, months] of bySource.entries()) {
    const lastM = months[lastMonthKey] || 0;
    const prevM = months[prevMonthKey] || 0;
    const currM = months[currMonthKey] || 0;
    if (lastM === 0 && prevM === 0 && currM === 0) continue;
    const changePct = prevM > 0 ? (lastM - prevM) / prevM : (lastM > 0 ? 1 : 0);
    const score = lastM * 0.6 + changePct * 500 + currM * 0.4;
    if (score > bestScore) { bestScore = score; bestSource = { name, lastM, prevM, currM, changePct }; }
  }

  return { hasAnyData: true, monthTarget, lastMonthTotal, prevMonthTotal, currMonthTotal, daysLeft, daysElapsed, daysInMonth, needed, perDay, pace, projected, growthRate, growthReason, bestSource };
}

function getGoalStatus(g) {
  if (g.currMonthTotal >= g.monthTarget) return { cls: 'success', label: '✓ تم' };
  if (g.daysLeft === 0) return { cls: 'danger', label: 'انتهى الشهر' };
  const neededPace = (g.monthTarget - g.currMonthTotal) / g.daysLeft;
  if (g.pace >= neededPace) return { cls: 'success', label: '▲ متقدم' };
  if (g.pace >= neededPace * 0.7) return { cls: 'warn', label: '→ على المسار' };
  return { cls: 'danger', label: '▼ متأخر' };
}

function renderGoals() {
  const el = document.getElementById('goalsList');
  if (!el) return;
  el.innerHTML = '';
  const g = computeSmartGoals();
  const now = new Date();

  if (!g.hasAnyData) {
    el.innerHTML = `<div class="empty-mini">ابدأ بتسجيل أعمالك — وسيقوم النظام ببناء أهداف واقعية.</div>`;
    return;
  }

  const status   = getGoalStatus(g);
  const progress = Math.min(100, (g.currMonthTotal / g.monthTarget) * 100);
  const monthName     = AR_MONTHS[now.getMonth()];
  const lastMonthName = AR_MONTHS[(now.getMonth() + 11) % 12];

  const mainGoal = document.createElement('div');
  mainGoal.className = 'goal goal-main';
  mainGoal.innerHTML = `
    <div class="goal-head">
      <div>
        <div class="goal-title">هدف ${monthName} ${now.getFullYear()}</div>
        <div class="goal-reason">بناءً على ${lastMonthName}: ${money(g.lastMonthTotal)} • ${g.growthReason}</div>
      </div>
      <span class="goal-status status-${status.cls}">${status.label}</span>
    </div>
    <div class="progress"><div class="progress-bar ${status.cls}" style="width:${progress}%"></div></div>
    <div class="goal-amounts">
      <span>${money(g.currMonthTotal)}</span>
      <span class="goal-target">من ${money(g.monthTarget)}</span>
    </div>
    <div class="goal-foot">
      <span>${progress.toFixed(0)}%</span>
      ${g.needed > 0 ? `<span>متبقي ${money(g.needed)}</span>` : `<span>🎉 تم تحقيق الهدف</span>`}
    </div>
  `;
  el.appendChild(mainGoal);

  if (g.daysLeft > 0 && g.needed > 0) {
    const onTrack = g.pace >= g.perDay;
    const paceCard = document.createElement('div');
    paceCard.className = 'goal-pace';
    paceCard.innerHTML = `
      <div class="pace-row"><span class="pace-label">المطلوب يوميًا</span><strong class="pace-value">${money(g.perDay)}</strong></div>
      <div class="pace-row"><span class="pace-label">معدلك الحالي</span><strong class="pace-value ${onTrack ? 'positive' : 'negative'}">${money(g.pace)}</strong></div>
      <div class="pace-row"><span class="pace-label">المتبقي</span><strong class="pace-value">${g.daysLeft} يوم</strong></div>
    `;
    el.appendChild(paceCard);
  }

  if (g.daysLeft > 0 && g.pace > 0) {
    const projCard = document.createElement('div');
    projCard.className = 'goal-projection';
    projCard.innerHTML = `<span>بمعدلك الحالي، المتوقع نهاية الشهر:</span><strong>${money(g.projected)}</strong>`;
    el.appendChild(projCard);
  }

  if (g.bestSource) {
    const trend = g.bestSource.changePct > 0.05 ? '▲' : g.bestSource.changePct < -0.05 ? '▼' : '→';
    const trendText = g.bestSource.prevM > 0
      ? `تغيّر ${trend} ${(g.bestSource.changePct * 100).toFixed(0)}%`
      : 'مصدر واعد';
    const actCard = document.createElement('div');
    actCard.className = 'goal-action';
    actCard.innerHTML = `
      <div class="action-icon">🎯</div>
      <div class="action-body">
        <div class="action-title">ركّز على: ${escapeHtml(g.bestSource.name)}</div>
        <div class="action-text">${trendText} — حقّق ${money(g.bestSource.lastM)} الشهر الماضي.</div>
      </div>
    `;
    el.appendChild(actCard);
  }
}

/* ---------- Trend Badge ---------- */
function renderTrendBadge(entries) {
  const badge = document.getElementById('trendBadge');
  if (!badge) return;
  if (entries.length < 3) { badge.textContent = '—'; badge.className = 'card-hint'; return; }
  const half = Math.floor(entries.length / 2);
  const firstSum = sum(entries.slice(0, half));
  const secondSum = sum(entries.slice(half));
  if (secondSum > firstSum * 1.15) { badge.textContent = '↑ اتجاه صاعد'; badge.className = 'card-hint hint-up'; }
  else if (secondSum < firstSum * 0.85) { badge.textContent = '↓ اتجاه نازل'; badge.className = 'card-hint hint-down'; }
  else { badge.textContent = '→ اتجاه ثابت'; badge.className = 'card-hint'; }
}

/* ---------- Business Health ---------- */
function computeHealthScore() {
  const allIncome = buildUnifiedIncome();
  const now = new Date();
  if (!allIncome.length) return null;

  const monthStart     = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const lastMonthStart = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lastMonthEnd   = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));

  const thisMonth = sum(allIncome.filter(e => new Date(e.date) >= monthStart));
  const lastMonth = sum(allIncome.filter(e => { const d = new Date(e.date); return d >= lastMonthStart && d <= lastMonthEnd; }));

  let momentumScore = 10;
  if (lastMonth > 0) {
    const change = (thisMonth - lastMonth) / lastMonth;
    momentumScore = Math.max(0, Math.min(20, 10 + change * 20));
  } else if (thisMonth > 0) momentumScore = 15;
  else momentumScore = 0;

  const bySource = groupSum(allIncome, e => e.sourceLabel);
  const diversityScore = bySource.length >= 4 ? 20 : bySource.length === 3 ? 15 : bySource.length === 2 ? 10 : bySource.length === 1 ? 5 : 0;

  const totalAll = sum(allIncome);
  let concentrationScore = 20;
  if (bySource.length && totalAll > 0) {
    const topShare = bySource[0][1] / totalAll;
    concentrationScore = Math.max(0, Math.min(20, 20 * (1 - topShare)));
  }

  const goalsData = computeSmartGoals();
  let goalScore = 10;
  if (goalsData.hasAnyData) {
    const progress = Math.min(1, goalsData.currMonthTotal / goalsData.monthTarget);
    goalScore = Math.round(progress * 20);
  }

  const thirtyDaysAgo = startOfDay(new Date(now.getTime() - 30 * 86400000));
  const recent = allIncome.filter(e => new Date(e.date) >= thirtyDaysAgo);
  const activeDays = new Set(recent.map(e => new Date(e.date).toDateString())).size;
  const consistencyScore = Math.min(20, Math.round((activeDays / 30) * 20 * 2.5));

  const raw = momentumScore + diversityScore + concentrationScore + goalScore + consistencyScore;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  let grade = 'F', color = '#f87171';
  if (score >= 85)      { grade = 'A+'; color = '#4ade80'; }
  else if (score >= 75) { grade = 'A';  color = '#4ade80'; }
  else if (score >= 65) { grade = 'B';  color = '#38bdf8'; }
  else if (score >= 50) { grade = 'C';  color = '#fbbf24'; }
  else if (score >= 35) { grade = 'D';  color = '#fb923c'; }

  return {
    score, grade, color,
    metrics: [
      { label: 'الزخم الشهري', value: Math.round(momentumScore), max: 20 },
      { label: 'تنوع المصادر', value: Math.round(diversityScore), max: 20 },
      { label: 'عدم التركيز', value: Math.round(concentrationScore), max: 20 },
      { label: 'تقدم الهدف',  value: Math.round(goalScore), max: 20 },
      { label: 'الانتظام',    value: Math.round(consistencyScore), max: 20 },
    ],
  };
}

function renderHealthScore() {
  const ringEl = document.getElementById('healthRing');
  const gradeEl = document.getElementById('healthGrade');
  const scoreEl = document.getElementById('healthScore');
  const breakEl = document.getElementById('healthBreakdown');
  if (!ringEl || !gradeEl || !scoreEl || !breakEl) return;

  const h = computeHealthScore();
  if (!h) {
    gradeEl.textContent = '—';
    gradeEl.style.color = '#5a6378';
    scoreEl.textContent = 'لا بيانات';
    breakEl.innerHTML = '';
    ringEl.style.stroke = '#5a6378';
    ringEl.setAttribute('stroke-dashoffset', 326.73);
    return;
  }

  const offset = 326.73 * (1 - h.score / 100);
  ringEl.style.stroke = h.color;
  ringEl.setAttribute('stroke-dashoffset', offset);
  gradeEl.textContent = h.grade;
  gradeEl.style.color = h.color;
  scoreEl.textContent = `${h.score}/100`;

  breakEl.innerHTML = '';
  for (const m of h.metrics) {
    const pctVal = (m.value / m.max) * 100;
    const fillColor = pctVal >= 70 ? '#4ade80' : pctVal >= 40 ? '#fbbf24' : '#f87171';
    const div = document.createElement('div');
    div.className = 'health-metric';
    div.innerHTML = `
      <div class="health-metric-label">${m.label}</div>
      <div class="health-metric-value">${m.value}<span>/${m.max}</span></div>
      <div class="health-bar"><div class="health-bar-fill" style="width:${pctVal}%;background:${fillColor}"></div></div>
    `;
    breakEl.appendChild(div);
  }
}

/* ---------- Service Leaderboard ---------- */
function renderServiceLeaderboard() {
  const el = document.getElementById('serviceLeaderboard');
  if (!el) return;
  const services = new Map();
  for (const w of getWorks()) {
    for (const s of (w.services || [])) {
      const name  = s.name || 'غير معروف';
      const qty   = Number(s.qty) || 0;
      const price = Number(s.price) || 0;
      if (!services.has(name)) services.set(name, { count: 0, revenue: 0 });
      const rec = services.get(name);
      rec.count   += qty;
      rec.revenue += qty * price;
    }
  }
  const list = [...services.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 6);
  if (!list.length) { el.innerHTML = `<div class="empty-mini">لا توجد خدمات بعد</div>`; return; }

  el.innerHTML = '';
  list.forEach(([name, data], i) => {
    const row = document.createElement('div');
    row.className = 'lb-row';
    row.innerHTML = `
      <div class="lb-rank ${i === 0 ? 'top' : ''}">${i + 1}</div>
      <div class="lb-info">
        <div class="lb-name">${escapeHtml(name)}</div>
        <div class="lb-meta">${nf.format(data.count)} × استخدام</div>
      </div>
      <div class="lb-amount">${money(data.revenue)}</div>
    `;
    el.appendChild(row);
  });
}

/* ---------- Recent Activity ---------- */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const d = new Date(dateStr);
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'الآن';
  if (diff < 3600) return `قبل ${Math.floor(diff / 60)} دقيقة`;
  if (diff < 86400) return `قبل ${Math.floor(diff / 3600)} ساعة`;
  if (diff < 604800) return `قبل ${Math.floor(diff / 86400)} يوم`;
  if (diff < 2592000) return `قبل ${Math.floor(diff / 604800)} أسبوع`;
  const dd = new Date(dateStr);
  return `${dd.getDate()}/${dd.getMonth() + 1}/${dd.getFullYear()}`;
}

function renderRecentActivity() {
  const el = document.getElementById('recentActivity');
  if (!el) return;
  const events = [];
  for (const w of getWorks()) {
    events.push({
      type: 'work',
      title: `عمل: ${w.productCode || '—'}`,
      subtitle: (w.services || []).map(s => s.name).join(' • ') || 'بدون خدمات',
      amount: Number(w.total) || 0,
      date: w.createdAt || w.date,
    });
  }
  for (const o of getOther()) {
    events.push({
      type: 'income',
      title: `دخل: ${o.source || '—'}`,
      subtitle: o.category || 'Other',
      amount: Number(o.amount) || 0,
      date: o.createdAt || o.date,
    });
  }
  for (const e of getExps()) {
    events.push({
      type: 'expense',
      title: `مصروف: ${e.title || '—'}`,
      subtitle: e.category || 'Other',
      amount: Number(e.amount) || 0,
      date: e.createdAt || e.date,
    });
  }
  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  const recent = events.slice(0, 10);
  if (!recent.length) { el.innerHTML = `<div class="empty-mini">لا يوجد نشاط بعد</div>`; return; }

  el.innerHTML = '';
  for (const e of recent) {
    const icon = e.type === 'work' ? '✦' : e.type === 'income' ? '₤' : '💸';
    const sign = e.type === 'expense' ? '−' : '+';
    const amountCls = e.type === 'expense' ? 'af-amount expense' : 'af-amount';
    const row = document.createElement('div');
    row.className = 'af-row';
    row.innerHTML = `
      <div class="af-icon ${e.type}">${icon}</div>
      <div class="af-body">
        <div class="af-title">${escapeHtml(e.title)}</div>
        <div class="af-meta">${escapeHtml(e.subtitle)} • ${timeAgo(e.date)}</div>
      </div>
      <div class="${amountCls}">${sign}${money(e.amount)}</div>
    `;
    el.appendChild(row);
  }
}

/* ---------- Main Render ---------- */
const state = { period: 'week', customFrom: null, customTo: null };

function render() {
  const allIncome = buildUnifiedIncome();
  const range = getRange(state.period, state.customFrom, state.customTo);
  const prevRange = getPreviousRange(range);

  const entries = filterByRange(allIncome, range);
  const prevEntries = filterByRange(allIncome, prevRange);

  document.getElementById('rangeLabel').textContent = formatRangeLabel(range, state.period);

  renderKPIs(entries, prevEntries, range, prevRange, state.period, allIncome);
  renderFinancialSnapshot(range, state.period, allIncome);
  renderPeriodSummary(range, state.period, allIncome);  /* ✅ جديد */
  renderHealthScore();
  renderTrendBadge(entries);
  renderIncomeOverTime(entries, range, state.period);
  renderBySource(entries);
  renderByClient(entries);
  renderExpenseBreakdown();
  renderCashFlow();
  renderInsights(generateInsights(entries, prevEntries, range, state.period));
  renderTopSources(entries);
  renderGoals();
  renderMonthlyComparison();
  renderClientProfitability();
  renderWeeklyRhythm();
  renderServiceLeaderboard();
  renderRecentActivity();
}

/* ---------- Events ---------- */
document.getElementById('periodFilter').addEventListener('click', e => {
  const btn = e.target.closest('button[data-period]');
  if (!btn) return;
  const period = btn.dataset.period;
  document.querySelectorAll('#periodFilter button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const customBox = document.getElementById('customRange');
  if (period === 'custom') { customBox.hidden = false; return; }
  customBox.hidden = true;
  state.period = period;
  render();
});

document.getElementById('applyRange').addEventListener('click', () => {
  state.customFrom = document.getElementById('fromDate').value || null;
  state.customTo   = document.getElementById('toDate').value || null;
  state.period = 'custom';
  render();
});

document.addEventListener('DOMContentLoaded', render);
window.addEventListener('focus', render);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
window.addEventListener('storage', render);

let __lastSnapshot = '';
setInterval(() => {
  const snap = JSON.stringify({
    c: localStorage.getItem(KEYS.clients),
    w: localStorage.getItem(KEYS.works),
    o: localStorage.getItem(KEYS.otherIncome),
    g: localStorage.getItem(KEYS.goals),
    s: localStorage.getItem(KEYS.subscriptions),
    e: localStorage.getItem(KEYS.expenses),
  });
  if (snap !== __lastSnapshot) { __lastSnapshot = snap; render(); }
}, 3000);