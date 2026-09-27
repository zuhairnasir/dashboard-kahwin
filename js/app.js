// Dashboard Perkahwinan Aisyah & Zuhair - app.js
// Dilengkapi:
// 1. Pengelasan teratur: Part Pengantin Lelaki, Part Pengantin Perempuan, & Barangan Bersama
// 2. Butang Tick Interaktif untuk status bayaran pantas
// 3. Penjejak Perjalanan Milestone & Bar Kemajuan Kewangan Visual (Glowing Progress Bar)
// 4. Peti Simpanan Resit & Dokumen berasaskan IndexedDB (gambar resit & invois PDF)

(function() {
  'use strict';

  // --- State Initialization ---
  const STORAGE_KEY = 'wedding_dashboard_aisyah_zuhair_v2';
  const DB_NAME = 'WeddingReceiptsDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'receipts';

  let appData = loadInitialData();
  let currentTab = 'all'; // 'all', 'tunang', 'nikah', 'bertandang', 'guests', 'receipts', 'charts'

  // View & Filter states
  let viewMode = 'grouped'; // 'grouped' (Kad Kelompok Kategori) atau 'table' (Jadual Penuh)
  let activePihakFilter = 'all'; // 'all', 'Lelaki', 'Perempuan', 'Kongsi'
  let activeCategoryFilter = 'all'; // 'all' atau nama kategori kumpulan spesifik
  let lastActiveGroupKey = null; // groupKey yang baru ditambah atau diedit
  let expandedGroupCardIds = new Set(); // Menyimpan rekod kad yang sedang terbuka supaya tidak tertutup sendiri

  function getStandardGroupKey(groupTitle, fallbackItem = null) {
    if (fallbackItem && fallbackItem.groupKey && fallbackItem.groupTitle === groupTitle) {
      return fallbackItem.groupKey;
    }
    const match = appData.expenses.find(e => e.groupTitle === groupTitle && e.groupKey);
    if (match) return match.groupKey;
    return (groupTitle || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'group-custom';
  }

  const expenseFilters = {
    search: '',
    category: 'all',
    status: 'all'
  };

  const guestFilters = {
    search: '',
    side: 'all',
    kad: 'all',
    attendance: 'all'
  };

  // Editing state
  let editingExpenseId = null;
  let editingGuestId = null;
  let pendingReceiptExpenseId = null;
  let activeViewingReceiptId = null;

  // Drag and drop state
  let draggedItemId = null;
  let draggedGroupTitle = null;

  // Chart instances
  let charts = {};

  // --- IndexedDB Helper for Receipts & Documents ---
  function openReceiptsDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('expenseId', 'expenseId', { unique: false });
          store.createIndex('uploadDate', 'uploadDate', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbSaveReceipt(receiptObj) {
    try {
      const db = await openReceiptsDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(receiptObj);
        req.onsuccess = () => resolve(receiptObj);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error('IndexedDB save error:', err);
      throw err;
    }
  }

  async function dbGetReceipt(id) {
    try {
      const db = await openReceiptsDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error('IndexedDB get error:', err);
      return null;
    }
  }

  async function dbDeleteReceipt(id) {
    try {
      const db = await openReceiptsDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error('IndexedDB delete error:', err);
      return false;
    }
  }

  async function dbGetAllReceipts() {
    try {
      const db = await openReceiptsDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error('IndexedDB getAll error:', err);
      return [];
    }
  }

  async function syncReceiptFlags() {
    try {
      const receipts = await dbGetAllReceipts();
      const receiptIds = new Set(receipts.map(r => r.id));
      let changed = false;

      appData.expenses.forEach(e => {
        const has = receiptIds.has(e.id);
        if (e.hasReceipt !== has) {
          e.hasReceipt = has;
          changed = true;
        }
      });

      const badge = document.getElementById('tab-receipts-badge');
      if (badge) badge.textContent = receipts.length;

      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
      }
    } catch (e) {
      console.warn('Gagal selaraskan status resit:', e);
    }
  }

  // --- Initial Data Loader ---
  function loadInitialData() {
    let data = null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        data = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Gagal membaca LocalStorage, guna data awal.', e);
    }
    if (!data || !data.expenses) {
      const fallback = (typeof window !== 'undefined' && window.INITIAL_WEDDING_DATA) ? window.INITIAL_WEDDING_DATA : (typeof INITIAL_WEDDING_DATA !== 'undefined' ? INITIAL_WEDDING_DATA : {});
      data = JSON.parse(JSON.stringify(fallback));
    }

    // Auto-migration: alihkan dokumen nikah & barangan nikah daripada fasa 'tunang' ke fasa 'nikah'
    if (data && Array.isArray(data.expenses)) {
      let migrated = false;
      data.expenses.forEach(item => {
        if (item.phase === 'tunang') {
          const desc = item.description || '';
          const grp = item.groupTitle || '';
          const isNikahDoc = grp === '📜 Dokumen & Prosedur Nikah' || 
                             item.groupKey === 'dokumen' ||
                             desc.includes('Passport') ||
                             desc.includes('Kursus Perkahwinan') ||
                             desc.includes('Ujian HIV') ||
                             desc.includes('Kebenaran Berkahwin') ||
                             desc.includes('Pendaftaran Nikah') ||
                             desc.includes('Perakuan Nikah') ||
                             desc.includes('Borang Nikah') ||
                             desc.includes('Penghulu') ||
                             desc.includes('Wang Hantaran') ||
                             desc.includes('Gelang Kahwin') ||
                             desc.includes('Kad Jemputan') ||
                             (desc.includes('Photostat I/C') && !desc.includes('Tunang'));

          if (isNikahDoc) {
            item.phase = 'nikah';
            item.phaseTitle = 'Akad Nikah';
            if (desc.includes('Wang Hantaran') || desc.includes('Gelang Kahwin')) {
              item.groupTitle = '📜 Upacara Akad & Mas Kahwin';
              item.groupKey = 'akad-nikah';
              item.pihak = 'Lelaki';
            } else if (desc.includes('Kad Jemputan')) {
              item.groupTitle = '💌 Jemputan & Doorgift';
              item.groupKey = 'jemputan';
            } else {
              item.groupTitle = '📜 Dokumen & Prosedur Nikah';
              item.groupKey = 'dokumen';
              if (desc.includes('(L)')) item.pihak = 'Lelaki';
              if (desc.includes('(P)') || desc.includes('Wali')) item.pihak = 'Perempuan';
            }
            migrated = true;
          }
        }
      });
      if (migrated) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (err) {}
      }
    }

    // Auto-migration: Masukkan semua item perbelanjaan 'sanding' (Sanding Belah Perempuan) ke dalam 'nikah' (Akad Nikah)
    if (data && Array.isArray(data.expenses)) {
      let migratedSanding = false;
      const nikahItems = data.expenses.filter(e => e.phase === 'nikah');

      data.expenses.forEach(item => {
        if (item.phase === 'sanding') {
          item.phase = 'nikah';
          item.phaseTitle = 'Akad Nikah';
          if (!item.notes && nikahItems.some(n => n.description === item.description && n.groupTitle === item.groupTitle)) {
            item.notes = 'Untuk Majlis Sanding';
          }
          migratedSanding = true;
        }
      });

      if (migratedSanding) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (err) {}
      }
    }

    if (data && Array.isArray(data.phases)) {
      data.phases = data.phases.filter(p => p.id !== 'sanding');
    }

    if (data && Array.isArray(data.expenses)) {
      data.expenses = deduplicateExpenses(data.expenses);
    }

    return data;
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
      renderMasterKPI();
      renderMilestoneTracker();
      renderPhaseBanners();
      if (currentTab === 'charts') {
        renderCharts();
      }
    } catch (e) {
      console.error('Gagal menyimpan ke LocalStorage:', e);
      showToast('Amaran: Gagal menyimpan data ke pelayar!', 'error');
    }
  }

  // --- Undo / Redo History System ---
  const undoStack = [];
  const redoStack = [];
  const MAX_HISTORY = 40;

  function pushHistoryState(actionName = 'Perubahan') {
    try {
      const snapshot = JSON.stringify(appData);
      if (undoStack.length > 0 && undoStack[undoStack.length - 1].data === snapshot) {
        return;
      }
      undoStack.push({
        name: actionName,
        data: snapshot,
        tab: currentTab,
        groupKey: lastActiveGroupKey
      });
      if (undoStack.length > MAX_HISTORY) {
        undoStack.shift();
      }
      redoStack.length = 0;
      updateUndoButtonState();
    } catch (e) {
      console.warn('Gagal rekod history:', e);
    }
  }

  function undoLastAction() {
    if (undoStack.length === 0) {
      showToast('Tiada perubahan untuk di-undo.', 'info');
      return;
    }

    const currentSnapshot = JSON.stringify(appData);
    const lastState = undoStack.pop();

    redoStack.push({
      data: currentSnapshot,
      tab: currentTab,
      groupKey: lastActiveGroupKey
    });

    try {
      appData = JSON.parse(lastState.data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));

      if (lastState.groupKey) {
        lastActiveGroupKey = lastState.groupKey;
        expandedGroupCardIds.add('card-' + lastState.groupKey);
      }

      updateUndoButtonState();

      const scrollY = window.scrollY;
      renderMasterKPI();
      renderMilestoneTracker();
      renderPhaseBanners();
      if (currentTab === 'guests') {
        renderGuestTable();
      } else if (currentTab === 'receipts') {
        renderReceiptsGallery();
      } else if (currentTab === 'charts') {
        renderCharts();
      } else {
        renderExpensesView();
      }
      window.scrollTo({ top: scrollY, behavior: 'instant' });

      showToast(`↩️ Undo: '${lastState.name || 'Perubahan'}' telah dibatalkan!`, 'info');
    } catch (e) {
      console.error('Error undo:', e);
      showToast('Gagal melakukan undo.', 'error');
    }
  }

  function redoLastAction() {
    if (redoStack.length === 0) return;
    const nextState = redoStack.pop();
    const currentSnapshot = JSON.stringify(appData);
    undoStack.push({
      data: currentSnapshot,
      tab: currentTab,
      groupKey: lastActiveGroupKey
    });

    try {
      appData = JSON.parse(nextState.data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));

      if (nextState.groupKey) {
        lastActiveGroupKey = nextState.groupKey;
        expandedGroupCardIds.add('card-' + nextState.groupKey);
      }

      updateUndoButtonState();

      const scrollY = window.scrollY;
      renderMasterKPI();
      renderMilestoneTracker();
      renderPhaseBanners();
      if (currentTab === 'guests') {
        renderGuestTable();
      } else if (currentTab === 'receipts') {
        renderReceiptsGallery();
      } else if (currentTab === 'charts') {
        renderCharts();
      } else {
        renderExpensesView();
      }
      window.scrollTo({ top: scrollY, behavior: 'instant' });

      showToast(`↪️ Redo berjaya digunakan!`, 'info');
    } catch (e) {
      console.error('Error redo:', e);
    }
  }

  function updateUndoButtonState() {
    const btnUndo = document.getElementById('btn-undo-header');
    if (btnUndo) {
      if (undoStack.length > 0) {
        btnUndo.disabled = false;
        btnUndo.style.opacity = '1';
        btnUndo.style.cursor = 'pointer';
        const lastAction = undoStack[undoStack.length - 1];
        btnUndo.title = `Undo: ${lastAction.name || 'Tindakan terakhir'} (Cmd+Z / Ctrl+Z)`;
      } else {
        btnUndo.disabled = true;
        btnUndo.style.opacity = '0.5';
        btnUndo.style.cursor = 'not-allowed';
        btnUndo.title = 'Tiada tindakan untuk di-undo (Cmd+Z / Ctrl+Z)';
      }
    }
    const btnRedo = document.getElementById('btn-redo-header');
    if (btnRedo) {
      if (redoStack.length > 0) {
        btnRedo.disabled = false;
        btnRedo.style.opacity = '1';
        btnRedo.style.display = 'inline-flex';
      } else {
        btnRedo.disabled = true;
        btnRedo.style.opacity = '0.5';
        btnRedo.style.display = 'none';
      }
    }
  }

  // --- Helpers & Standard Group Ordering ---
  const PHASE_DEFAULT_GROUPS = {
    all: [
      "📜 Dokumen & Prosedur Nikah",
      "📜 Upacara Akad & Mas Kahwin",
      "👰 Part Pengantin Perempuan",
      "🤵 Part Pengantin Lelaki",
      "🎁 Barang Hantaran (Lelaki Sediakan)",
      "🎁 Barang Hantaran (Perempuan Sediakan)",
      "🏰 Lokasi, Dewan & Khemah",
      "🍽️ Jamuan & Katering",
      "📸 Fotografi & Media",
      "🎵 Hiburan & PA System",
      "💌 Jemputan & Doorgift",
      "🚙 Penginapan & Logistik",
      "✨ Lain-lain Persiapan"
    ],
    tunang: [
      "👰 Part Pengantin Perempuan",
      "🤵 Part Pengantin Lelaki",
      "🎁 Barang Hantaran (Lelaki Sediakan)",
      "🎁 Barang Hantaran (Perempuan Sediakan)",
      "🏰 Lokasi, Dewan & Khemah",
      "🍽️ Jamuan & Katering",
      "📸 Fotografi & Media",
      "💌 Jemputan & Doorgift",
      "🚙 Penginapan & Logistik",
      "✨ Lain-lain Persiapan"
    ],
    nikah: [
      "📜 Dokumen & Prosedur Nikah",
      "📜 Upacara Akad & Mas Kahwin",
      "👰 Part Pengantin Perempuan",
      "🤵 Part Pengantin Lelaki",
      "🎁 Barang Hantaran (Lelaki Sediakan)",
      "🎁 Barang Hantaran (Perempuan Sediakan)",
      "🏰 Lokasi, Dewan & Khemah",
      "🍽️ Jamuan & Katering",
      "📸 Fotografi & Media",
      "🎵 Hiburan & PA System",
      "💌 Jemputan & Doorgift",
      "🚙 Penginapan & Logistik",
      "✨ Lain-lain Persiapan"
    ],
    bertandang: [
      "🤵 Part Pengantin Lelaki",
      "👰 Part Pengantin Perempuan",
      "🏰 Lokasi, Dewan & Khemah",
      "🍽️ Jamuan & Katering",
      "📸 Fotografi & Media",
      "🎵 Hiburan & PA System",
      "💌 Jemputan & Doorgift",
      "🚙 Penginapan & Logistik",
      "🎁 Barang Hantaran (Lelaki Sediakan)",
      "🎁 Barang Hantaran (Perempuan Sediakan)",
      "✨ Lain-lain Persiapan"
    ]
  };

  function getGroupOrderScore(groupTitle, phase) {
    if (!groupTitle) return 999;
    const targetPhase = (phase && PHASE_DEFAULT_GROUPS[phase]) ? phase : 'all';
    const list = PHASE_DEFAULT_GROUPS[targetPhase] || PHASE_DEFAULT_GROUPS.all;

    const norm = groupTitle.trim().toLowerCase();
    const idx = list.findIndex(item => {
      const itemNorm = item.trim().toLowerCase();
      if (norm === itemNorm) return true;
      const strippedItem = itemNorm.replace(/^[^\w\s]+/, '').trim();
      const strippedNorm = norm.replace(/^[^\w\s]+/, '').trim();
      return strippedNorm.includes(strippedItem) || strippedItem.includes(strippedNorm);
    });

    return idx !== -1 ? idx : 999;
  }

  function deduplicateExpenses(expenses) {
    if (!Array.isArray(expenses)) return expenses;
    const seen = new Set();
    return expenses.filter(item => {
      const desc = (item.description || '').trim().toLowerCase();
      if (!desc) return true;
      const key = [
        item.phase || '',
        item.groupTitle || '',
        desc,
        Number(item.budget) || 0,
        Number(item.actual) || 0,
        item.pihak || '',
        item.status || '',
        (item.notes || '').trim()
      ].join('||');

      if (seen.has(key)) {
        console.warn('Membuang item pendua tidak sengaja:', item.description);
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function formatRM(val) {
    const num = Number(val) || 0;
    return 'RM ' + num.toLocaleString('ms-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function showToast(message, type = 'info', allowUndo = false) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    let icon = '✨';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';
    if (type === 'info') icon = '💡';

    let undoBtnHtml = '';
    if (allowUndo && undoStack.length > 0) {
      undoBtnHtml = `<button type="button" class="toast-undo-btn" onclick="event.stopPropagation(); window.dashboardApp.undoLastAction(); this.closest('.toast').remove();">↩️ Undo</button>`;
    }

    toast.innerHTML = `<div style="display:flex; align-items:center; gap:8px;"><span>${icon}</span> <span>${message}</span></div> ${undoBtnHtml}`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, allowUndo ? 4500 : 3200);
  }

  // --- Master KPI Calculations ---
  function calculateMasterStats() {
    let totalBudget = 0;
    let totalActual = 0;
    let totalPaid = 0;
    let completedItems = 0;

    appData.expenses.forEach(item => {
      const budget = Number(item.budget) || 0;
      const actual = Number(item.actual) || 0;
      totalBudget += budget;
      totalActual += actual;

      if (item.status === 'Selesai') {
        completedItems += 1;
        totalPaid += (actual > 0 ? actual : budget);
      } else if (item.status === 'Deposit' && item.notes && item.notes.toLowerCase().includes('deposit')) {
        const match = item.notes.match(/deposit\s*(\d+)/i);
        if (match) {
          totalPaid += Number(match[1]);
        }
      }
    });

    const balanceToPay = Math.max(0, totalActual - totalPaid);
    const paidPercentage = totalActual > 0 ? Math.min(100, Math.round((totalPaid / totalActual) * 100)) : 0;
    const itemsPercentage = appData.expenses.length > 0 ? Math.round((completedItems / appData.expenses.length) * 100) : 0;

    // Guests calculations
    let totalGuests = appData.guests.length;
    let totalPax = 0;
    let confirmedPax = 0;
    let declinedPax = 0;
    let pendingPax = 0;

    appData.guests.forEach(g => {
      const pax = Number(g.pax) || 1;
      totalPax += pax;
      if (g.attendance === 'Akan Hadir' || g.attendance === 'Hadir') {
        confirmedPax += pax;
      } else if (g.attendance === 'Tidak Hadir') {
        declinedPax += pax;
      } else {
        pendingPax += pax;
      }
    });

    return {
      totalBudget,
      totalActual,
      totalPaid,
      balanceToPay,
      paidPercentage,
      itemsPercentage,
      totalItems: appData.expenses.length,
      completedItems,
      totalGuests,
      totalPax,
      confirmedPax,
      declinedPax,
      pendingPax
    };
  }

  function renderMasterKPI() {
    const stats = calculateMasterStats();

    const elBudget = document.getElementById('kpi-total-budget');
    const elActual = document.getElementById('kpi-total-actual');
    const elPaid = document.getElementById('kpi-total-paid');
    const elBalance = document.getElementById('kpi-total-balance');
    const elGuests = document.getElementById('kpi-total-guests');
    const elPaidProgress = document.getElementById('kpi-paid-progress');
    const elPaidPercentText = document.getElementById('kpi-paid-percentage');

    if (elBudget) elBudget.textContent = formatRM(stats.totalBudget);
    if (elActual) elActual.textContent = formatRM(stats.totalActual);
    if (elPaid) elPaid.textContent = formatRM(stats.totalPaid);
    if (elBalance) elBalance.textContent = formatRM(stats.balanceToPay);
    if (elGuests) elGuests.innerHTML = `${stats.totalGuests} <span style="font-size:0.9rem; font-weight:500; color:var(--text-muted);">(~${stats.totalPax} Pax)</span>`;

    if (elPaidProgress) elPaidProgress.style.width = `${stats.paidPercentage}%`;
    if (elPaidPercentText) elPaidPercentText.textContent = `${stats.paidPercentage}% Selesai`;

    const tabGuestBadge = document.getElementById('tab-guest-badge');
    if (tabGuestBadge) tabGuestBadge.textContent = stats.totalGuests;

    const tabExpBadge = document.getElementById('tab-all-exp-badge');
    if (tabExpBadge) tabExpBadge.textContent = `${stats.totalItems} item`;
  }

  // --- Milestone & Financial Progress Tracker ---
  function renderMilestoneTracker() {
    const stats = calculateMasterStats();

    const paidBadge = document.getElementById('milestone-paid-badge');
    const itemsBadge = document.getElementById('milestone-items-badge');
    const barText = document.getElementById('progress-bar-text');
    const barFill = document.getElementById('glowing-progress-fill');
    const stepsGrid = document.getElementById('milestone-steps-grid');

    if (paidBadge) {
      paidBadge.innerHTML = `💳 ${stats.paidPercentage}% Sudah Bayar (${formatRM(stats.totalPaid)})`;
    }

    if (itemsBadge) {
      itemsBadge.innerHTML = `✅ ${stats.completedItems}/${stats.totalItems} Item Selesai (${stats.itemsPercentage}%)`;
    }

    if (barText) {
      barText.innerHTML = `<strong style="color:var(--emerald-dark);">${stats.paidPercentage}% Sudah Bayar</strong> (${formatRM(stats.totalPaid)} / ${formatRM(stats.totalActual || stats.totalBudget)})`;
    }

    if (barFill) {
      barFill.style.width = `${stats.paidPercentage}%`;
    }

    if (!stepsGrid) return;

    const milestones = [
      { id: 'tunang', icon: '🌸', title: '1. Pertunangan', date: '5 Sept 2026', venue: 'Rumah Pengantin Perempuan' },
      { id: 'nikah', icon: '💍', title: '2. Akad Nikah', date: '27 Mac 2027', venue: 'Masjid / Dewan Nikah' },
      { id: 'bertandang', icon: '🏛️', title: '3. Bertandang Lelaki', date: '30 Mei 2027', venue: 'Dewan Majlis (800 Pax)' }
    ];

    let stepsHtml = '';
    milestones.forEach(m => {
      const items = appData.expenses.filter(e => e.phase === m.id);
      const totalCost = items.reduce((acc, c) => acc + (Number(c.actual) || Number(c.budget) || 0), 0);
      const paidCost = items.reduce((acc, c) => c.status === 'Selesai' ? acc + (Number(c.actual) || Number(c.budget) || 0) : acc, 0);
      const completedCount = items.filter(e => e.status === 'Selesai').length;
      const isComplete = items.length > 0 && completedCount === items.length;
      const progressPercent = totalCost > 0 ? Math.round((paidCost / totalCost) * 100) : (isComplete ? 100 : 0);

      stepsHtml += `
        <div class="milestone-step-item ${isComplete ? 'step-complete' : 'step-pending'}" 
             onclick="window.dashboardApp.switchTab('${m.id}')" 
             style="cursor:pointer;" 
             title="Klik untuk lihat butiran ${m.title}">
          <div class="milestone-step-icon">${m.icon}</div>
          <div class="milestone-step-name">${m.title}</div>
          <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">${m.date}</div>
          
          <div style="height:4px; background:#e2e8f0; border-radius:10px; overflow:hidden; margin:6px 0;">
            <div style="width:${progressPercent}%; height:100%; background:${isComplete ? 'var(--emerald)' : 'var(--primary)'}; transition: width 0.4s ease;"></div>
          </div>

          <div class="milestone-step-status">
            ${isComplete ? '✅ Selesai Semua' : `${progressPercent}% Selesai`}
          </div>
          <div style="font-size:0.68rem; color:var(--text-muted); margin-top:2px;">
            ${completedCount}/${items.length} item • ${formatRM(paidCost)}
          </div>
        </div>
      `;
    });

    stepsGrid.innerHTML = stepsHtml;
  }

  // --- Phase Banners Update ---
  function renderPhaseBanners() {
    const phases = ['tunang', 'nikah', 'bertandang'];
    phases.forEach(pId => {
      const items = appData.expenses.filter(e => e.phase === pId);
      const budget = items.reduce((acc, c) => acc + (Number(c.budget) || 0), 0);
      const actual = items.reduce((acc, c) => acc + (Number(c.actual) || 0), 0);
      const paid = items.reduce((acc, c) => c.status === 'Selesai' ? acc + (Number(c.actual) || Number(c.budget) || 0) : acc, 0);
      const balance = Math.max(0, actual - paid);

      const elBudget = document.getElementById(`${pId}-stat-budget`);
      const elActual = document.getElementById(`${pId}-stat-actual`);
      const elPaid = document.getElementById(`${pId}-stat-paid`);
      const elBalance = document.getElementById(`${pId}-stat-balance`);

      if (elBudget) elBudget.textContent = formatRM(budget);
      if (elActual) elActual.textContent = formatRM(actual);
      if (elPaid) elPaid.textContent = formatRM(paid);
      if (elBalance) elBalance.textContent = formatRM(balance);
    });
  }

  // --- Tab Navigation ---
  function switchTab(tabId, targetGroupKey = null) {
    if (tabId === 'sanding') tabId = 'nikah';
    if (currentTab !== tabId) {
      expandedGroupCardIds.clear();
    }
    currentTab = tabId;
    activePihakFilter = 'all'; // reset sub-filter on tab change
    activeCategoryFilter = 'all'; // reset category filter on tab change
    if (targetGroupKey) {
      lastActiveGroupKey = targetGroupKey;
      expandedGroupCardIds.add('card-' + targetGroupKey);
    }

    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      if (btn.dataset.tab === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.remove('active');
    });

    const targetPane = document.getElementById(`tab-pane-${tabId}`);
    if (targetPane) {
      targetPane.classList.add('active');
    }

    if (tabId === 'guests') {
      renderGuestTable();
    } else if (tabId === 'receipts') {
      renderReceiptsGallery();
    } else if (tabId === 'charts') {
      renderCharts();
    } else {
      renderExpensesView();
    }
  }

  // --- Expenses View (Grouped vs Table) ---
  function renderExpensesView() {
    const isAll = currentTab === 'all';
    const activePhaseId = isAll ? null : currentTab;
    const containerId = isAll ? 'all-content-area' : `${activePhaseId}-content-area`;
    const container = document.getElementById(containerId);
    if (!container) return;

    // Bersihkan sebarang item pendua tidak sengaja (akibat klik/submit berulang)
    const prevCount = appData.expenses.length;
    appData.expenses = deduplicateExpenses(appData.expenses);
    if (appData.expenses.length !== prevCount) {
      saveData();
    }

    // Simpan rekod kad yang sedang dibuka di skrin supaya tidak tertutup sendiri semasa render
    document.querySelectorAll('.group-card:not(.collapsed)').forEach(el => {
      if (el.id) expandedGroupCardIds.add(el.id);
    });
    if (lastActiveGroupKey) {
      expandedGroupCardIds.add('card-' + lastActiveGroupKey);
    }

    // Get items for current phase
    const phaseItems = isAll ? appData.expenses : appData.expenses.filter(e => e.phase === activePhaseId);

    // Calculate 3-Pillar stats (Lelaki, Perempuan, Kongsi) for current phase
    const pStats = {
      Lelaki: { total: 0, paid: 0, count: 0 },
      Perempuan: { total: 0, paid: 0, count: 0 },
      Kongsi: { total: 0, paid: 0, count: 0 }
    };

    let totalActual = 0;
    phaseItems.forEach(item => {
      const val = Number(item.actual) || Number(item.budget) || 0;
      totalActual += val;
      const isPaid = item.status === 'Selesai';
      const side = item.pihak || 'Kongsi';
      if (!pStats[side]) pStats[side] = { total: 0, paid: 0, count: 0 };
      pStats[side].total += val;
      pStats[side].count += 1;
      if (isPaid) pStats[side].paid += val;
    });

    // Calculate available distinct category groups for current phase and party
    const groupsMapAll = new Map();
    phaseItems.forEach(item => {
      if (activePihakFilter !== 'all' && item.pihak !== activePihakFilter) return;
      const grp = item.groupTitle || '✨ Lain-lain Persiapan';
      if (!groupsMapAll.has(grp)) {
        groupsMapAll.set(grp, { title: grp, count: 0, actual: 0, paid: 0 });
      }
      const gObj = groupsMapAll.get(grp);
      gObj.count += 1;
      const val = Number(item.actual) || Number(item.budget) || 0;
      gObj.actual += val;
      if (item.status === 'Selesai') gObj.paid += val;
    });
    const availableGroups = Array.from(groupsMapAll.values());
    availableGroups.sort((a, b) => {
      return getGroupOrderScore(a.title, activePhaseId) - getGroupOrderScore(b.title, activePhaseId);
    });

    // Filter items based on active filters
    const filteredItems = filterExpenseItems(phaseItems);

    let html = `
      <!-- 1. Unified Segmented Party Control Bar (Kemas & Jimat Ruang) -->
      <div class="party-segmented-bar">
        <button class="seg-btn ${activePihakFilter === 'all' ? 'active' : ''}" onclick="window.dashboardApp.setPartyFilter('all')">
          <div class="seg-btn-left">
            <span class="seg-icon">🌟</span>
            <span class="seg-name">Semua Pihak</span>
            <span class="seg-badge">${phaseItems.length}</span>
          </div>
          <div class="seg-amount">${formatRM(totalActual)}</div>
        </button>

        <button class="seg-btn seg-perempuan ${activePihakFilter === 'Perempuan' ? 'active' : ''}" onclick="window.dashboardApp.setPartyFilter('Perempuan')">
          <div class="seg-btn-left">
            <span class="seg-icon">👰</span>
            <span class="seg-name">Pihak Perempuan</span>
            <span class="seg-badge">${pStats.Perempuan.count}</span>
          </div>
          <div class="seg-amount" style="color:#be185d;">${formatRM(pStats.Perempuan.total)}</div>
        </button>

        <button class="seg-btn seg-lelaki ${activePihakFilter === 'Lelaki' ? 'active' : ''}" onclick="window.dashboardApp.setPartyFilter('Lelaki')">
          <div class="seg-btn-left">
            <span class="seg-icon">🤵</span>
            <span class="seg-name">Pihak Lelaki</span>
            <span class="seg-badge">${pStats.Lelaki.count}</span>
          </div>
          <div class="seg-amount" style="color:#1d4ed8;">${formatRM(pStats.Lelaki.total)}</div>
        </button>

        <button class="seg-btn seg-bersama ${activePihakFilter === 'Kongsi' ? 'active' : ''}" onclick="window.dashboardApp.setPartyFilter('Kongsi')">
          <div class="seg-btn-left">
            <span class="seg-icon">🤝</span>
            <span class="seg-name">Kos Bersama</span>
            <span class="seg-badge">${pStats.Kongsi.count}</span>
          </div>
          <div class="seg-amount" style="color:#7c3aed;">${formatRM(pStats.Kongsi.total)}</div>
        </button>
      </div>

      <!-- 2. Unified Search, Filter & Action Toolbar -->
      <div class="unified-action-bar">
        <div class="action-search-wrap">
          <span class="search-icon">🔍</span>
          <input type="text" class="unified-search-input" value="${escapeHtml(expenseFilters.search)}" placeholder="Cari sebarang barang, catatan, atau kategori..." oninput="window.dashboardApp.handleSearchChange(this.value)">
        </div>

        <div class="action-tools-wrap">
          <select class="unified-select-filter" onchange="window.dashboardApp.handleStatusFilterChange(this.value)">
            <option value="all" ${expenseFilters.status === 'all' ? 'selected' : ''}>Semua Status</option>
            <option value="Selesai" ${expenseFilters.status === 'Selesai' ? 'selected' : ''}>✅ Sudah Bayar</option>
            <option value="Deposit" ${expenseFilters.status === 'Deposit' ? 'selected' : ''}>⏳ Deposit</option>
            <option value="Belum" ${expenseFilters.status === 'Belum' ? 'selected' : ''}>❌ Belum Bayar</option>
          </select>

          <div class="view-mode-toggle">
            <button class="view-mode-btn ${viewMode === 'grouped' ? 'active' : ''}" onclick="window.dashboardApp.setViewMode('grouped')" title="Paparan Berkelompok">
              🗂️ Kumpulan
            </button>
            <button class="view-mode-btn ${viewMode === 'table' ? 'active' : ''}" onclick="window.dashboardApp.setViewMode('table')" title="Jadual Penuh">
              📋 Jadual
            </button>
          </div>

          <button class="btn btn-primary btn-sm" onclick="window.dashboardApp.openAddExpenseModal('${activePhaseId || 'tunang'}')">
            ➕ Tambah Belanja
          </button>
        </div>
      </div>

      <!-- 3. Lightweight Clean Category Ribbon -->
      <div class="category-ribbon">
        <div class="category-ribbon-pills">
          <span class="category-ribbon-label">Kategori:</span>
          <button class="ribbon-pill ${activeCategoryFilter === 'all' ? 'active' : ''}" onclick="window.dashboardApp.setCategoryFilter('all')">
            Semua <span class="ribbon-count">${availableGroups.reduce((s, g) => s + g.count, 0)}</span>
          </button>
          ${availableGroups.map(grp => `
            <button class="ribbon-pill ${activeCategoryFilter === grp.title ? 'active' : ''}" onclick="window.dashboardApp.setCategoryFilter('${escapeHtml(grp.title)}')">
              ${escapeHtml(grp.title)} <span class="ribbon-count">${grp.count}</span>
            </button>
          `).join('')}
        </div>
        <div class="category-ribbon-actions">
          <button class="ribbon-action-btn" onclick="window.dashboardApp.expandAllGroups(true)">📂 Buka Semua</button>
          <button class="ribbon-action-btn" onclick="window.dashboardApp.expandAllGroups(false)">📁 Tutup Semua</button>
        </div>
      </div>

      ${activeCategoryFilter !== 'all' ? `
        <div class="focused-category-banner">
          <div class="focused-category-info">
            <span>📌 Fokus Bahagian:</span>
            <strong class="focused-category-title">${escapeHtml(activeCategoryFilter)}</strong>
            <span style="font-size:0.75rem; color:var(--text-muted);">(${filteredItems.length} item)</span>
          </div>
          <button class="btn btn-outline btn-sm" style="padding:3px 10px; font-size:0.75rem;" onclick="window.dashboardApp.setCategoryFilter('all')">
            ✕ Tunjuk Semua
          </button>
        </div>
      ` : ''}

      <!-- Items Container (Targeted DOM for instant search response) -->
      <div class="expenses-items-wrapper" id="expenses-items-wrapper">
        ${renderItemsBlock(filteredItems, isAll)}
      </div>
    `;

    container.innerHTML = html;
  }

  function renderItemsBlock(filteredItems, isAll) {
    if (filteredItems.length === 0) {
      return `
        <div style="background:white; border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:50px 20px; text-align:center; color:var(--text-muted); margin-bottom:24px;">
          <div style="font-size:2.5rem; margin-bottom:10px;">🔍</div>
          <h3 style="color:var(--text-dark); margin-bottom:6px;">Tiada item dijumpai</h3>
          <p style="font-size:0.88rem;">Tiada perbelanjaan menepati carian atau tapisan ini. Cuba klik "Semua Bahagian" atau tambah item baru.</p>
        </div>
      `;
    }

    if (viewMode === 'grouped') {
      const groupsMap = new Map();
      filteredItems.forEach(item => {
        const groupTitle = item.groupTitle || '✨ Lain-lain Persiapan';
        if (!groupsMap.has(groupTitle)) {
          groupsMap.set(groupTitle, []);
        }
        groupsMap.get(groupTitle).push(item);
      });

      // Susun seksyen mengikut turutan perkahwinan yang tepat dan betul
      const currentPhaseContext = isAll ? 'all' : currentTab;
      const sortedGroupEntries = Array.from(groupsMap.entries()).sort((a, b) => {
        return getGroupOrderScore(a[0], currentPhaseContext) - getGroupOrderScore(b[0], currentPhaseContext);
      });

      let blockHtml = `<div class="groups-container">`;
      let gIndex = 0;

      sortedGroupEntries.forEach(([groupTitle, itemsInGroup]) => {
        const gBudget = itemsInGroup.reduce((acc, c) => acc + (Number(c.budget) || 0), 0);
        const gActual = itemsInGroup.reduce((acc, c) => acc + (Number(c.actual) || 0), 0);
        const gPaid = itemsInGroup.reduce((acc, c) => {
          if (c.status === 'Selesai') return acc + (Number(c.actual) || Number(c.budget) || 0);
          return acc;
        }, 0);

        const groupKey = itemsInGroup[0].groupKey || getStandardGroupKey(groupTitle, itemsInGroup[0]);
        const cardId = 'card-' + escapeHtml(groupKey);

        // Jika ada kad yang sedang dibuka, pastikan ia kekal dibuka (tidak tertutup sendiri)
        let isCollapsed;
        if (activeCategoryFilter !== 'all') {
          isCollapsed = false;
        } else if (expandedGroupCardIds.size > 0) {
          isCollapsed = !expandedGroupCardIds.has(cardId);
        } else {
          isCollapsed = lastActiveGroupKey ? (groupKey !== lastActiveGroupKey) : (gIndex > 0);
        }
        gIndex++;

        blockHtml += `
          <div class="group-card ${isCollapsed ? 'collapsed' : ''}" id="${cardId}">
            <div class="group-card-header" onclick="window.dashboardApp.toggleGroupCard(this)">
              <div class="group-header-left">
                <span class="group-header-title">${escapeHtml(groupTitle)}</span>
                <span class="group-item-count">${itemsInGroup.length} item</span>
              </div>
              <div class="group-header-right">
                <div class="group-subtotal-chip">
                  <span>Anggaran: <strong>${formatRM(gBudget)}</strong></span>
                  <span style="color:var(--border-color);">|</span>
                  <span>Sebenar: <strong style="color:var(--primary);">${formatRM(gActual)}</strong></span>
                  <span style="color:var(--border-color);">|</span>
                  <span style="color:var(--emerald-dark);">Sudah Bayar: <strong>${formatRM(gPaid)}</strong></span>
                </div>
                <button type="button" class="btn-group-add-item" onclick="event.stopPropagation(); window.dashboardApp.openAddExpenseModalWithGroup('${escapeHtml(groupTitle).replace(/'/g, "\\'")}', '${escapeHtml(itemsInGroup[0]?.phase || currentTab)}', '${escapeHtml(itemsInGroup[0]?.pihak || 'Kongsi')}')" title="Tambah item dalam ${escapeHtml(groupTitle)}">
                  <span>➕</span> Tambah
                </button>
                <span class="group-collapse-icon">${isCollapsed ? '▶' : '▼'}</span>
              </div>
            </div>

            <div class="group-card-body">
              <div class="table-responsive">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th style="width: 28px; text-align:center;" title="Tarik untuk susun semula turutan">↕</th>
                      <th style="width: 50px; text-align:center;">Selesai</th>
                      <th style="width: 35px;">Bil</th>
                      <th>Perkara & Catatan</th>
                      ${isAll ? '<th>Fasa Majlis</th>' : ''}
                      <th>Pihak Penanggung</th>
                      <th>Anggaran (RM)</th>
                      <th>Sebenar (RM)</th>
                      <th>Status Bayaran</th>
                      <th style="text-align:center;">Resit / Dokumen</th>
                      <th style="text-align:center; width: 110px;">Tindakan</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${renderRowsHTML(itemsInGroup, isAll, false)}
                  </tbody>
                </table>
              </div>

              <div class="group-card-footer">
                <button type="button" class="group-footer-add-btn" onclick="window.dashboardApp.openAddExpenseModalWithGroup('${escapeHtml(groupTitle).replace(/'/g, "\\'")}', '${escapeHtml(itemsInGroup[0]?.phase || currentTab)}', '${escapeHtml(itemsInGroup[0]?.pihak || 'Kongsi')}')">
                  <span>➕</span> Tambah Item Baharu ke dalam <strong>${escapeHtml(groupTitle)}</strong>
                </button>
              </div>
            </div>
          </div>
        `;
      });

      blockHtml += `</div>`;
      return blockHtml;
    } else {
      return `
        <div class="table-container">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 28px; text-align:center;" title="Tarik untuk susun semula turutan">↕</th>
                  <th style="width: 50px; text-align:center;">Selesai</th>
                  <th style="width: 35px;">Bil</th>
                  <th>Perkara & Catatan</th>
                  <th>Bahagian / Kategori</th>
                  ${isAll ? '<th>Fasa Majlis</th>' : ''}
                  <th>Pihak</th>
                  <th>Anggaran (RM)</th>
                  <th>Sebenar (RM)</th>
                  <th>Status Bayaran</th>
                  <th style="text-align:center;">Resit / Dokumen</th>
                  <th style="text-align:center; width: 110px;">Tindakan</th>
                </tr>
              </thead>
              <tbody>
                ${renderRowsHTML(filteredItems, isAll, true)}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }
  }

  function renderRowsHTML(items, isAll, showGroupInRow = false) {
    return items.map((item, idx) => {
      const budget = Number(item.budget) || 0;
      const actual = Number(item.actual) || 0;
      const isPaid = item.status === 'Selesai';
      const isDeposit = item.status === 'Deposit';

      let statusBadge = '';
      if (isPaid) {
        statusBadge = `<span class="badge badge-completed" title="Klik untuk tukar status">✅ Selesai</span>`;
      } else if (isDeposit) {
        statusBadge = `<span class="badge badge-deposit" title="Klik untuk tukar status">⏳ Deposit</span>`;
      } else {
        statusBadge = `<span class="badge badge-pending" title="Klik untuk tukar status">❌ Belum Bayar</span>`;
      }

      let pihakBadge = '';
      let rowClass = 'row-party-kongsi';
      if (item.pihak === 'Lelaki') {
        pihakBadge = `<span class="badge badge-pihak-lelaki">🤵 Pihak Lelaki</span>`;
        rowClass = 'row-party-lelaki';
      } else if (item.pihak === 'Perempuan') {
        pihakBadge = `<span class="badge badge-pihak-perempuan">👰 Pihak Perempuan</span>`;
        rowClass = 'row-party-perempuan';
      } else {
        pihakBadge = `<span class="badge badge-pihak-kongsi">🤝 Kos Bersama</span>`;
      }

      return `
        <tr class="${rowClass} draggable-row" 
            data-id="${item.id}"
            data-phase="${escapeHtml(item.phase || '')}"
            data-grouptitle="${escapeHtml(item.groupTitle || '')}"
            draggable="true"
            ondragstart="window.dashboardApp.handleRowDragStart(event)"
            ondragover="window.dashboardApp.handleRowDragOver(event)"
            ondragleave="window.dashboardApp.handleRowDragLeave(event)"
            ondrop="window.dashboardApp.handleRowDrop(event)"
            ondragend="window.dashboardApp.handleRowDragEnd(event)">
          <td class="drag-handle-cell" title="Tarik untuk susun semula turutan">
            <span class="drag-handle">⠿</span>
          </td>
          <td style="text-align:center;">
            <button class="tick-btn ${isPaid ? 'ticked' : ''}" 
                    title="${isPaid ? 'Tandakan belum bayar' : 'Tandakan selesai bayar'}" 
                    onclick="event.stopPropagation(); window.dashboardApp.quickToggleStatus('${item.id}')">
              ✓
            </button>
          </td>
          <td style="color:var(--text-muted); font-size:0.8rem; font-weight:600;">${idx + 1}</td>
          <td>
            <div class="item-desc">${escapeHtml(item.description)}</div>
            ${item.notes ? `<div class="item-subdesc">📝 ${escapeHtml(item.notes)}</div>` : ''}
          </td>
          ${showGroupInRow ? `<td><span class="tag-pill" style="font-size:0.75rem;">${escapeHtml(item.groupTitle || item.category)}</span></td>` : ''}
          ${isAll ? `<td><span class="tag-pill" style="font-size:0.75rem;">${escapeHtml(item.phaseTitle || item.phase)}</span></td>` : ''}
          <td>${pihakBadge}</td>
          <td style="font-weight:600; color:var(--text-dark);">${budget > 0 ? formatRM(budget) : '-'}</td>
          <td style="font-weight:700; color:${actual > budget && budget > 0 ? 'var(--primary)' : 'var(--emerald-dark)'};">
            ${actual > 0 ? formatRM(actual) : '-'}
          </td>
          <td>
            <div style="cursor:pointer;" onclick="window.dashboardApp.quickToggleStatus('${item.id}')">
              ${statusBadge}
            </div>
          </td>
          <td style="text-align:center;">
            <button class="receipt-badge-btn ${item.hasReceipt ? 'has-receipt' : ''}" 
                    title="${item.hasReceipt ? 'Lihat Resit' : 'Muat Naik Resit'}" 
                    onclick="event.stopPropagation(); window.dashboardApp.handleReceiptAction('${item.id}')">
              ${item.hasReceipt ? '🧾 Resit Ada' : '📎 + Resit'}
            </button>
          </td>
          <td>
            <div class="action-btns">
              <button class="icon-btn icon-move" title="Alih ke Atas" onclick="event.stopPropagation(); window.dashboardApp.moveExpenseItem('${item.id}', 'up')">▲</button>
              <button class="icon-btn icon-move" title="Alih ke Bawah" onclick="event.stopPropagation(); window.dashboardApp.moveExpenseItem('${item.id}', 'down')">▼</button>
              <button class="icon-btn icon-edit" title="Kemaskini Item" onclick="window.dashboardApp.openEditExpenseModal('${item.id}')">
                ✏️
              </button>
              <button class="icon-btn icon-delete" title="Padam Item" onclick="window.dashboardApp.deleteExpense('${item.id}')">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // --- Sub-Filter Handlers ---
  function setPartyFilter(party) {
    activePihakFilter = party;
    activeCategoryFilter = 'all';
    renderExpensesView();
  }

  function setCategoryFilter(cat) {
    activeCategoryFilter = cat;
    renderExpensesView();
  }

  function expandAllGroups(expand) {
    const cards = document.querySelectorAll('.group-card');
    cards.forEach(card => {
      if (expand) {
        card.classList.remove('collapsed');
        if (card.id) expandedGroupCardIds.add(card.id);
        const icon = card.querySelector('.group-collapse-icon');
        if (icon) icon.textContent = '▼';
      } else {
        card.classList.add('collapsed');
        const icon = card.querySelector('.group-collapse-icon');
        if (icon) icon.textContent = '▶';
      }
    });
    if (!expand) {
      expandedGroupCardIds.clear();
      lastActiveGroupKey = null;
    }
  }

  function toggleGroupCard(headerEl) {
    const card = headerEl.closest('.group-card');
    if (!card) return;
    const isCollapsed = card.classList.contains('collapsed');
    if (isCollapsed) {
      card.classList.remove('collapsed');
      if (card.id) expandedGroupCardIds.add(card.id);
      const icon = card.querySelector('.group-collapse-icon');
      if (icon) icon.textContent = '▼';
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      card.classList.add('collapsed');
      if (card.id) expandedGroupCardIds.delete(card.id);
      const icon = card.querySelector('.group-collapse-icon');
      if (icon) icon.textContent = '▶';
    }
  }

  function setViewMode(mode) {
    viewMode = mode;
    renderExpensesView();
  }

  function filterExpenseItems(phaseItems) {
    return phaseItems.filter(item => {
      if (activeCategoryFilter !== 'all' && (item.groupTitle || '✨ Lain-lain Persiapan') !== activeCategoryFilter) {
        return false;
      }
      if (activePihakFilter !== 'all' && item.pihak !== activePihakFilter) {
        return false;
      }
      if (expenseFilters.search) {
        const q = expenseFilters.search.toLowerCase();
        const matchDesc = (item.description || '').toLowerCase().includes(q);
        const matchNotes = (item.notes || '').toLowerCase().includes(q);
        const matchCat = (item.category || '').toLowerCase().includes(q);
        const matchGrp = (item.groupTitle || '').toLowerCase().includes(q);
        if (!matchDesc && !matchNotes && !matchCat && !matchGrp) return false;
      }
      if (expenseFilters.status !== 'all') {
        if (expenseFilters.status === 'Selesai' && item.status !== 'Selesai') return false;
        if (expenseFilters.status === 'Belum' && item.status !== 'Belum') return false;
        if (expenseFilters.status === 'Deposit' && item.status !== 'Deposit') return false;
      }
      return true;
    });
  }

  function handleSearchChange(val) {
    expenseFilters.search = (val || '').trim();
    const itemsWrap = document.getElementById('expenses-items-wrapper');
    if (itemsWrap) {
      const isAll = currentTab === 'all';
      const activePhaseId = isAll ? null : currentTab;
      const phaseItems = isAll ? appData.expenses : appData.expenses.filter(e => e.phase === activePhaseId);
      const filtered = filterExpenseItems(phaseItems);
      itemsWrap.innerHTML = renderItemsBlock(filtered, isAll);
    } else {
      renderExpensesView();
    }
  }

  function handleStatusFilterChange(val) {
    expenseFilters.status = val;
    renderExpensesView();
  }

  // --- Quick Status Toggles ---
  function quickToggleStatus(expenseId) {
    const item = appData.expenses.find(e => e.id === expenseId);
    if (!item) return;

    pushHistoryState(item.status === 'Selesai' ? `Tukar status '${item.description}' ke Belum` : `Tanda selesai '${item.description}'`);

    const groupKey = item.groupKey || getStandardGroupKey(item.groupTitle || '', item);
    lastActiveGroupKey = groupKey;
    expandedGroupCardIds.add('card-' + groupKey);

    const scrollY = window.scrollY;

    if (item.status === 'Selesai') {
      item.status = 'Belum';
      showToast(`'${item.description}' ditukar ke Belum Bayar.`, 'info', true);
    } else {
      item.status = 'Selesai';
      if ((!item.actual || item.actual === 0) && item.budget > 0) {
        item.actual = item.budget;
      }
      showToast(`'${item.description}' ditandakan Selesai Bayar! ✅`, 'success', true);
    }

    saveData();
    renderExpensesView();
    window.scrollTo({ top: scrollY, behavior: 'instant' });
  }

  // --- Drag and Drop Row Reordering ---
  function handleRowDragStart(e) {
    if (e.target.closest('button, input, select, a, .badge, .tick-btn, .action-btns')) {
      e.preventDefault();
      return;
    }
    const tr = e.target.closest('tr');
    if (!tr) return;
    draggedItemId = tr.dataset.id;
    draggedGroupTitle = tr.dataset.grouptitle || '';
    tr.classList.add('is-dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedItemId);
    }
  }

  function handleRowDragOver(e) {
    e.preventDefault();
    const tr = e.target.closest('tr');
    if (!tr || !draggedItemId || tr.dataset.id === draggedItemId) return;
    if ((tr.dataset.grouptitle || '') !== draggedGroupTitle) return;

    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }

    const rect = tr.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      tr.classList.remove('drop-below');
      tr.classList.add('drop-above');
    } else {
      tr.classList.remove('drop-above');
      tr.classList.add('drop-below');
    }
  }

  function handleRowDragLeave(e) {
    const tr = e.target.closest('tr');
    if (tr) {
      tr.classList.remove('drop-above', 'drop-below');
    }
  }

  function handleRowDrop(e) {
    e.preventDefault();
    const targetTr = e.target.closest('tr');
    if (!targetTr || !draggedItemId || targetTr.dataset.id === draggedItemId) return;
    if ((targetTr.dataset.grouptitle || '') !== draggedGroupTitle) return;

    const isBefore = targetTr.classList.contains('drop-above');
    targetTr.classList.remove('drop-above', 'drop-below');

    const sourceId = draggedItemId;
    const targetId = targetTr.dataset.id;

    const sourceIdx = appData.expenses.findIndex(e => e.id === sourceId);
    if (sourceIdx === -1) return;
    const [movedItem] = appData.expenses.splice(sourceIdx, 1);

    const newTargetIdx = appData.expenses.findIndex(e => e.id === targetId);
    if (newTargetIdx === -1) return;

    pushHistoryState(`Susun turutan '${movedItem.description}'`);

    const insertIdx = isBefore ? newTargetIdx : newTargetIdx + 1;
    appData.expenses.splice(insertIdx, 0, movedItem);

    const groupKey = movedItem.groupKey || getStandardGroupKey(movedItem.groupTitle || '', movedItem);
    lastActiveGroupKey = groupKey;
    expandedGroupCardIds.add('card-' + groupKey);

    saveData();
    const scrollY = window.scrollY;
    renderExpensesView();
    window.scrollTo({ top: scrollY, behavior: 'instant' });

    showToast(`✅ Susunan '${movedItem.description}' berjaya dikemaskini!`, 'success', true);
  }

  function handleRowDragEnd(e) {
    document.querySelectorAll('.draggable-row').forEach(row => {
      row.classList.remove('is-dragging', 'drop-above', 'drop-below');
    });
    draggedItemId = null;
    draggedGroupTitle = null;
  }

  function moveExpenseItem(expenseId, direction) {
    const item = appData.expenses.find(e => e.id === expenseId);
    if (!item) return;

    const groupTitle = item.groupTitle || '✨ Lain-lain Persiapan';
    const phase = item.phase;
    
    const groupItems = appData.expenses.filter(e => (e.groupTitle || '✨ Lain-lain Persiapan') === groupTitle && e.phase === phase);
    const currIdxInGroup = groupItems.findIndex(e => e.id === expenseId);
    if (currIdxInGroup === -1) return;

    pushHistoryState(`Alih '${item.description}' ${direction === 'up' ? 'ke atas' : 'ke bawah'}`);

    if (direction === 'up' && currIdxInGroup > 0) {
      const neighbor = groupItems[currIdxInGroup - 1];
      swapExpenseItems(item.id, neighbor.id);
    } else if (direction === 'down' && currIdxInGroup < groupItems.length - 1) {
      const neighbor = groupItems[currIdxInGroup + 1];
      swapExpenseItems(item.id, neighbor.id);
    } else {
      return;
    }

    const groupKey = item.groupKey || getStandardGroupKey(item.groupTitle || '', item);
    lastActiveGroupKey = groupKey;
    expandedGroupCardIds.add('card-' + groupKey);

    saveData();
    const scrollY = window.scrollY;
    renderExpensesView();
    window.scrollTo({ top: scrollY, behavior: 'instant' });
    showToast(`Turutan '${item.description}' dialih.`, 'info', true);
  }

  function swapExpenseItems(idA, idB) {
    const idxA = appData.expenses.findIndex(e => e.id === idA);
    const idxB = appData.expenses.findIndex(e => e.id === idB);
    if (idxA !== -1 && idxB !== -1) {
      const temp = appData.expenses[idxA];
      appData.expenses[idxA] = appData.expenses[idxB];
      appData.expenses[idxB] = temp;
    }
  }

  // --- Receipt Storage & Modal Handling ---
  async function handleReceiptAction(expenseId) {
    const item = appData.expenses.find(e => e.id === expenseId);
    if (!item) return;

    if (item.hasReceipt) {
      openReceiptModal(expenseId);
    } else {
      triggerUploadReceipt(expenseId);
    }
  }

  function triggerUploadReceipt(expenseId) {
    pendingReceiptExpenseId = expenseId;
    const fileInput = document.getElementById('receipt-upload-input');
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  }

  async function openReceiptModal(expenseIdOrReceiptId) {
    let receipt = await dbGetReceipt(expenseIdOrReceiptId);
    let item = appData.expenses.find(e => e.id === expenseIdOrReceiptId);

    if (!receipt && item) {
      showToast('Tiada fail resit dijumpai untuk item ini.', 'info');
      return;
    }

    if (!receipt) {
      showToast('Resit tidak dijumpai.', 'error');
      return;
    }

    activeViewingReceiptId = receipt.id;

    const titleEl = document.getElementById('receipt-modal-title');
    const imgWrap = document.getElementById('receipt-modal-img-wrap');
    const metaEl = document.getElementById('receipt-modal-meta');
    const downloadBtn = document.getElementById('btn-download-receipt');
    const deleteBtn = document.getElementById('btn-delete-receipt');

    const desc = receipt.expenseDesc || (item ? item.description : 'Resit Bayaran');
    if (titleEl) titleEl.textContent = `Pratonton Resit: ${desc}`;

    // Render Preview
    if (imgWrap) {
      const isPdf = (receipt.fileType && receipt.fileType.includes('pdf')) || (receipt.fileName && receipt.fileName.toLowerCase().endsWith('.pdf'));
      if (isPdf) {
        imgWrap.innerHTML = `
          <div style="padding:40px; text-align:center;">
            <div style="font-size:3.5rem; margin-bottom:8px;">📄</div>
            <p style="font-weight:700; color:var(--text-dark);">${escapeHtml(receipt.fileName)}</p>
            <p style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">Dokumen PDF (${formatFileSize(receipt.fileSize)})</p>
          </div>
        `;
      } else {
        imgWrap.innerHTML = `
          <img src="${receipt.fileData}" alt="${escapeHtml(desc)}" style="max-width:100%; max-height:460px; object-fit:contain; border-radius:6px; box-shadow:0 4px 14px rgba(0,0,0,0.08);">
        `;
      }
    }

    // Render Metadata
    if (metaEl) {
      const phaseStr = receipt.phase || (item ? item.phaseTitle : 'Umum');
      const amtStr = receipt.amount ? formatRM(receipt.amount) : (item ? formatRM(item.actual || item.budget) : '-');
      metaEl.innerHTML = `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:8px;">
          <div><strong>📌 Perkara:</strong> ${escapeHtml(desc)}</div>
          <div><strong>💰 Jumlah Bayaran:</strong> ${amtStr}</div>
          <div><strong>🗓️ Fasa Majlis:</strong> ${escapeHtml(phaseStr)}</div>
          <div><strong>📁 Nama Fail:</strong> ${escapeHtml(receipt.fileName || 'resit.jpg')} (${formatFileSize(receipt.fileSize)})</div>
          <div><strong>⏰ Dimuat Naik:</strong> ${receipt.uploadDate || '-'}</div>
          ${receipt.notes ? `<div style="grid-column: 1 / -1;"><strong>📝 Catatan:</strong> ${escapeHtml(receipt.notes)}</div>` : ''}
        </div>
      `;
    }

    // Configure Download
    if (downloadBtn) {
      downloadBtn.href = receipt.fileData;
      downloadBtn.download = receipt.fileName || 'resit_kahwin.jpg';
    }

    // Configure Delete
    if (deleteBtn) {
      deleteBtn.onclick = () => deleteReceiptForExpense(receipt.id);
    }

    openModal('receipt-modal');
  }

  async function deleteReceiptForExpense(receiptId) {
    if (!confirm('Adakah anda pasti ingin memadam resit ini?')) return;

    await dbDeleteReceipt(receiptId);
    
    // Unmark expense if associated
    const item = appData.expenses.find(e => e.id === receiptId);
    if (item) {
      item.hasReceipt = false;
      saveData();
    }

    await syncReceiptFlags();
    closeModal('receipt-modal');
    showToast('Resit telah dipadam.', 'info');

    if (currentTab === 'receipts') {
      renderReceiptsGallery();
    } else {
      renderExpensesView();
    }
  }

  // --- Peti Resit & Dokumen Tab ---
  async function renderReceiptsGallery() {
    const container = document.getElementById('receipts-gallery-container');
    if (!container) return;

    const receipts = await dbGetAllReceipts();
    const badge = document.getElementById('tab-receipts-badge');
    if (badge) badge.textContent = receipts.length;

    if (receipts.length === 0) {
      container.innerHTML = `
        <div style="background:white; border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:60px 20px; text-align:center; color:var(--text-muted); margin-bottom:24px;">
          <div style="font-size:3.5rem; margin-bottom:12px;">📁</div>
          <h3 style="color:var(--text-dark); margin-bottom:6px; font-family:var(--font-serif); font-size:1.3rem;">Peti Resit & Dokumen Masih Kosong</h3>
          <p style="font-size:0.9rem; max-width:520px; margin:0 auto 20px; line-height:1.5;">
            Simpan semua bukti bayaran deposit katering, tempahan dewan, busana pengantin, dan dokumen akad nikah di sini untuk memudahkan rujukan bila-bila masa.
          </p>
          <button class="btn btn-primary" onclick="window.dashboardApp.promptUploadGeneralReceipt()">
            📷 Muat Naik Resit Pertama
          </button>
        </div>
      `;
      return;
    }

    let galleryHtml = `<div class="receipts-gallery-grid">`;

    receipts.forEach(r => {
      const isPdf = (r.fileType && r.fileType.includes('pdf')) || (r.fileName && r.fileName.toLowerCase().endsWith('.pdf'));
      const desc = r.expenseDesc || 'Dokumen / Resit';
      const phaseTitle = r.phase || 'Umum';

      galleryHtml += `
        <div class="receipt-card">
          <div class="receipt-thumb-wrap" onclick="window.dashboardApp.openReceiptModal('${r.id}')">
            ${isPdf 
              ? `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%;"><span style="font-size:3rem;">📄</span><span style="font-size:0.75rem; font-weight:700; color:var(--primary); margin-top:4px;">DOKUMEN PDF</span></div>` 
              : `<img src="${r.fileData}" alt="${escapeHtml(desc)}" class="receipt-thumb-img">`
            }
          </div>
          <div class="receipt-card-body">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span class="tag-pill" style="font-size:0.72rem;">${escapeHtml(phaseTitle)}</span>
              <span style="font-size:0.72rem; color:var(--text-muted);">${r.uploadDate ? r.uploadDate.split(',')[0] : ''}</span>
            </div>
            <h4 style="font-size:0.92rem; font-weight:700; color:var(--text-dark); margin-bottom:4px; line-height:1.3;">
              ${escapeHtml(desc)}
            </h4>
            <div style="font-size:0.85rem; font-weight:700; color:var(--emerald-dark); margin-bottom:8px;">
              ${r.amount ? formatRM(r.amount) : '-'}
            </div>
            <div style="font-size:0.74rem; color:var(--text-muted); margin-bottom:12px;">
              📎 ${escapeHtml(r.fileName || 'fail')} • ${formatFileSize(r.fileSize)}
            </div>
            <div style="display:flex; gap:6px; margin-top:auto;">
              <button class="btn btn-outline btn-sm" style="flex:1;" onclick="window.dashboardApp.openReceiptModal('${r.id}')">
                👁️ Lihat
              </button>
              <a href="${r.fileData}" download="${r.fileName || 'resit.jpg'}" class="btn btn-outline btn-sm" style="padding:4px 10px;" title="Muat Turun">
                ⬇️
              </a>
              <button class="btn btn-outline btn-sm" style="color:#ef4444; padding:4px 10px;" onclick="window.dashboardApp.deleteReceiptForExpense('${r.id}')" title="Padam">
                🗑️
              </button>
            </div>
          </div>
        </div>
      `;
    });

    galleryHtml += `</div>`;
    container.innerHTML = galleryHtml;
  }

  function promptUploadGeneralReceipt() {
    const select = document.getElementById('receipt-target-select');
    if (select) {
      select.innerHTML = '<option value="__general__">📄 Dokumen Umum / Surat / Borang Nikah</option>';
      appData.expenses.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = `[${e.phaseTitle || e.phase}] ${e.description} (${formatRM(e.actual || e.budget)})`;
        select.appendChild(opt);
      });
    }

    const form = document.getElementById('upload-receipt-form');
    if (form) form.reset();

    const amtInput = document.getElementById('receipt-amount-input');
    if (select && amtInput) {
      select.onchange = () => {
        const item = appData.expenses.find(e => e.id === select.value);
        if (item) {
          amtInput.value = item.actual || item.budget || '';
        } else {
          amtInput.value = '';
        }
      };
    }

    openModal('upload-receipt-modal');
  }

  async function handleUploadReceiptFormSubmit(e) {
    e.preventDefault();

    const select = document.getElementById('receipt-target-select');
    const fileInput = document.getElementById('upload-receipt-file-input');
    const amtInput = document.getElementById('receipt-amount-input');
    const notesInput = document.getElementById('receipt-notes-input');

    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      alert('Sila pilih fail resit atau dokumen terlebih dahulu.');
      return;
    }

    const file = fileInput.files[0];
    const targetId = select.value;
    const isGeneral = targetId === '__general__';
    const item = !isGeneral ? appData.expenses.find(exp => exp.id === targetId) : null;

    const reader = new FileReader();
    reader.onload = async function(evt) {
      const dataUrl = evt.target.result;
      const receiptId = isGeneral ? 'doc_' + Date.now() : targetId;

      const receiptRecord = {
        id: receiptId,
        expenseId: isGeneral ? null : targetId,
        expenseDesc: item ? item.description : (notesInput.value.trim() || file.name),
        phase: item ? (item.phaseTitle || item.phase) : 'Dokumen Umum',
        amount: parseFloat(amtInput.value) || (item ? (item.actual || item.budget) : 0),
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        fileData: dataUrl,
        notes: notesInput.value.trim(),
        uploadDate: new Date().toLocaleString('ms-MY')
      };

      await dbSaveReceipt(receiptRecord);

      if (item) {
        item.hasReceipt = true;
        saveData();
      }

      await syncReceiptFlags();
      closeModal('upload-receipt-modal');
      showToast('Resit / Dokumen berjaya dimuat naik & disimpan! 📁', 'success');

      if (currentTab === 'receipts') {
        renderReceiptsGallery();
      } else {
        renderExpensesView();
      }
    };
    reader.readAsDataURL(file);
  }

  // --- Quick Kad & RSVP Toggles for Guests ---
  function quickToggleKad(guestId) {
    const g = appData.guests.find(item => item.id === guestId);
    if (!g) return;

    pushHistoryState(`Tukar status kad '${g.nama}'`);

    if (g.kad && g.kad.toLowerCase().includes('sudah')) {
      g.kad = 'Belum Hantar';
      showToast(`Kad untuk ${g.nama} ditukar ke Belum Hantar.`, 'info', true);
    } else {
      g.kad = 'Sudah Hantar';
      showToast(`Kad untuk ${g.nama} ditukar ke Sudah Hantar! ✉️`, 'success', true);
    }

    saveData();
    renderGuestTable();
  }

  function updateGuestAttendance(guestId, newStatus) {
    const g = appData.guests.find(item => item.id === guestId);
    if (!g) return;

    pushHistoryState(`Tukar kehadiran '${g.nama}' ke ${newStatus}`);

    g.attendance = newStatus;
    saveData();
    renderGuestTable();
    showToast(`Status kehadiran ${g.nama} dikemaskini: ${newStatus}`, 'success', true);
  }

  // --- Guests Table Rendering ---
  function renderGuestTable() {
    const stats = calculateMasterStats();

    const elGstTotal = document.getElementById('gst-kpi-total');
    const elGstPax = document.getElementById('gst-kpi-pax');
    const elGstConfirmed = document.getElementById('gst-kpi-confirmed');
    const elGstDeclined = document.getElementById('gst-kpi-declined');
    const elGstPending = document.getElementById('gst-kpi-pending');

    if (elGstTotal) elGstTotal.textContent = stats.totalGuests;
    if (elGstPax) elGstPax.textContent = `${stats.totalPax} Pax`;
    if (elGstConfirmed) elGstConfirmed.textContent = `${stats.confirmedPax} Pax`;
    if (elGstDeclined) elGstDeclined.textContent = `${stats.declinedPax} Pax`;
    if (elGstPending) elGstPending.textContent = `${stats.pendingPax} Pax`;

    // Filter guests
    let filtered = appData.guests.filter(g => {
      if (guestFilters.side !== 'all' && g.side !== guestFilters.side) {
        return false;
      }

      if (guestFilters.kad !== 'all') {
        if (guestFilters.kad === 'Sudah Hantar' && !g.kad.includes('Sudah')) return false;
        if (guestFilters.kad === 'Belum Hantar' && !g.kad.includes('Belum')) return false;
      }

      if (guestFilters.attendance !== 'all' && g.attendance !== guestFilters.attendance) {
        return false;
      }

      if (guestFilters.search) {
        const q = guestFilters.search.toLowerCase();
        const matchName = (g.nama || '').toLowerCase().includes(q);
        const matchGroup = (g.group || '').toLowerCase().includes(q);
        const matchNotes = (g.notes || '').toLowerCase().includes(q);
        if (!matchName && !matchGroup && !matchNotes) return false;
      }

      return true;
    });

    const tbody = document.getElementById('guests-tbody');
    if (!tbody) return;

    const guestCountEl = document.getElementById('guest-filtered-count');
    if (guestCountEl) guestCountEl.textContent = `Menunjukkan ${filtered.length} daripada ${appData.guests.length} jemputan`;

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center; padding: 40px; color:var(--text-muted);">
            <div style="font-size: 2rem; margin-bottom: 8px;">👥</div>
            <p style="font-weight:600;">Tiada rekod jemputan tetamu dijumpai.</p>
            <p style="font-size:0.8rem; margin-top:4px;">Gunakan butang "+ Tambah Tetamu" untuk memasukkan senarai baru.</p>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map((g, idx) => {
      const isLelaki = g.side === 'Lelaki';
      const sideBadge = isLelaki 
        ? `<span class="badge badge-pihak-lelaki">Majlis Lelaki</span>` 
        : `<span class="badge badge-pihak-perempuan">Majlis Perempuan</span>`;

      const kadSent = g.kad && g.kad.toLowerCase().includes('sudah');
      const kadBadge = kadSent
        ? `<span class="badge badge-completed" style="cursor:pointer;" onclick="window.dashboardApp.quickToggleKad('${g.id}')">✉️ Sudah Hantar</span>`
        : `<span class="badge badge-pending" style="cursor:pointer;" onclick="window.dashboardApp.quickToggleKad('${g.id}')">⏳ Belum Hantar</span>`;

      let attClass = 'rsvp-pasti';
      if (g.attendance === 'Akan Hadir' || g.attendance === 'Hadir') attClass = 'rsvp-hadir';
      if (g.attendance === 'Tidak Hadir') attClass = 'rsvp-tidak';

      return `
        <tr data-id="${g.id}">
          <td style="color:var(--text-muted); font-size:0.8rem; font-weight:600;">${idx + 1}</td>
          <td>
            <div style="font-weight:700; color:var(--text-dark);">${escapeHtml(g.nama)}</div>
            ${g.notes ? `<div style="font-size:0.75rem; color:var(--text-muted);">📝 ${escapeHtml(g.notes)}</div>` : ''}
          </td>
          <td>
            <span style="display:inline-flex; align-items:center; gap:6px; font-weight:700; font-size:0.95rem; color:var(--primary); background:var(--primary-light); padding:2px 10px; border-radius:var(--radius-full);">
              👤 ${g.pax} Pax
            </span>
          </td>
          <td>${sideBadge}</td>
          <td>
            <span class="tag-pill" style="font-size:0.75rem;">${escapeHtml(g.group || 'Keluarga / Sahabat')}</span>
          </td>
          <td>${kadBadge}</td>
          <td>
            <select class="rsvp-select ${attClass}" onchange="window.dashboardApp.updateGuestAttendance('${g.id}', this.value)">
              <option value="Belum Pasti" ${g.attendance === 'Belum Pasti' ? 'selected' : ''}>❓ Belum Pasti</option>
              <option value="Akan Hadir" ${g.attendance === 'Akan Hadir' ? 'selected' : ''}>✅ Sah Hadir</option>
              <option value="Tidak Hadir" ${g.attendance === 'Tidak Hadir' ? 'selected' : ''}>❌ Tidak Hadir</option>
              <option value="Hadir" ${g.attendance === 'Hadir' ? 'selected' : ''}>🎉 Hadir Hari Majlis</option>
            </select>
          </td>
          <td>
            <div class="action-btns">
              <button class="icon-btn icon-edit" title="Kemaskini Tetamu" onclick="window.dashboardApp.openEditGuestModal('${g.id}')">
                ✏️
              </button>
              <button class="icon-btn icon-delete" title="Padam Tetamu" onclick="window.dashboardApp.deleteGuest('${g.id}')">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // --- Helper to populate groupTitle select options based on phase ---
  function populateGroupTitleOptions(selectedTitle = '', phase = null) {
    const select = document.getElementById('modal-exp-grouptitle');
    if (!select) return;

    const currentPhase = phase || document.getElementById('modal-exp-phase')?.value || 'tunang';
    const baseList = PHASE_DEFAULT_GROUPS[currentPhase] || PHASE_DEFAULT_GROUPS.tunang;

    const allGroups = new Set(baseList);

    // Also collect any existing groupTitles in appData.expenses for that phase
    appData.expenses.forEach(e => {
      if (e.phase === currentPhase && e.groupTitle) {
        allGroups.add(e.groupTitle);
      }
    });

    if (selectedTitle) allGroups.add(selectedTitle);

    const groupArr = Array.from(allGroups);
    select.innerHTML = groupArr.map(g => `
      <option value="${escapeHtml(g)}" ${g === selectedTitle ? 'selected' : ''}>${escapeHtml(g)}</option>
    `).join('');

    if (selectedTitle && groupArr.includes(selectedTitle)) {
      select.value = selectedTitle;
    } else if (groupArr.length > 0) {
      select.value = groupArr[0];
    }
  }

  function handleModalPhaseChange(newPhase) {
    const currentGroup = document.getElementById('modal-exp-grouptitle')?.value || '';
    populateGroupTitleOptions(currentGroup, newPhase);
    handleModalGroupChange(document.getElementById('modal-exp-grouptitle')?.value);
  }

  function handleModalGroupChange(groupTitle) {
    const pihakSelect = document.getElementById('modal-exp-pihak');
    if (!pihakSelect || !groupTitle) return;

    if (groupTitle.includes('Perempuan')) {
      pihakSelect.value = 'Perempuan';
    } else if (groupTitle.includes('Lelaki')) {
      pihakSelect.value = 'Lelaki';
    } else {
      pihakSelect.value = 'Kongsi';
    }
  }

  // --- CRUD Modals for Expenses ---
  function openAddExpenseModal(presetPhase = null) {
    editingExpenseId = null;
    document.getElementById('expense-modal-title').textContent = 'Tambah Perbelanjaan Baharu';
    const submitBtn = document.querySelector('#expense-form button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Simpan Perbelanjaan';

    const banner = document.getElementById('modal-group-preset-banner');
    if (banner) banner.style.display = 'none';

    const phaseSelect = document.getElementById('modal-exp-phase');
    let targetPhase = 'tunang';
    if (presetPhase && presetPhase !== 'all') {
      targetPhase = (presetPhase === 'sanding') ? 'nikah' : presetPhase;
    } else if (currentTab !== 'all' && currentTab !== 'guests' && currentTab !== 'receipts' && currentTab !== 'charts') {
      targetPhase = (currentTab === 'sanding') ? 'nikah' : currentTab;
    }
    phaseSelect.value = targetPhase;

    populateGroupTitleOptions('', targetPhase);

    document.getElementById('modal-exp-desc').value = '';
    document.getElementById('modal-exp-category').value = '';
    document.getElementById('modal-exp-budget').value = '';
    document.getElementById('modal-exp-actual').value = '';

    // Auto-set pihak based on initial selected group
    handleModalGroupChange(document.getElementById('modal-exp-grouptitle')?.value);

    document.getElementById('modal-exp-status').value = 'Belum';
    document.getElementById('modal-exp-notes').value = '';

    const fileInput = document.getElementById('modal-exp-file');
    if (fileInput) fileInput.value = '';
    const statusWrap = document.getElementById('modal-exp-receipt-status');
    if (statusWrap) statusWrap.style.display = 'none';

    openModal('expense-modal');
  }

  function openAddExpenseModalWithGroup(presetGroupTitle, presetPhase = null, presetPihak = null) {
    const targetPhase = presetPhase && presetPhase !== 'all' ? presetPhase : (currentTab !== 'all' ? currentTab : 'tunang');
    openAddExpenseModal(targetPhase);

    if (presetGroupTitle) {
      document.getElementById('expense-modal-title').textContent = `Tambah Item: ${presetGroupTitle}`;
      const submitBtn = document.querySelector('#expense-form button[type="submit"]');
      if (submitBtn) submitBtn.textContent = 'Simpan Item';
      populateGroupTitleOptions(presetGroupTitle, targetPhase);
      const groupSelect = document.getElementById('modal-exp-grouptitle');
      if (groupSelect) groupSelect.value = presetGroupTitle;

      const banner = document.getElementById('modal-group-preset-banner');
      if (banner) {
        banner.style.display = 'flex';
        document.getElementById('modal-group-preset-name').textContent = presetGroupTitle;
      }
    }

    const pihakSelect = document.getElementById('modal-exp-pihak');
    if (presetPihak && presetPihak !== 'all') {
      pihakSelect.value = presetPihak;
    } else if (presetGroupTitle) {
      if (presetGroupTitle.includes('Perempuan')) pihakSelect.value = 'Perempuan';
      else if (presetGroupTitle.includes('Lelaki')) pihakSelect.value = 'Lelaki';
      else pihakSelect.value = 'Kongsi';
    }
  }

  function openEditExpenseModal(expenseId) {
    const item = appData.expenses.find(e => e.id === expenseId);
    if (!item) return;

    editingExpenseId = expenseId;
    document.getElementById('expense-modal-title').textContent = 'Kemaskini Perbelanjaan';
    const submitBtn = document.querySelector('#expense-form button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Kemaskini Perbelanjaan';

    const banner = document.getElementById('modal-group-preset-banner');
    if (banner) banner.style.display = 'none';

    document.getElementById('modal-exp-phase').value = item.phase || 'tunang';
    populateGroupTitleOptions(item.groupTitle || '', item.phase || 'tunang');
    if (document.getElementById('modal-exp-grouptitle')) {
      document.getElementById('modal-exp-grouptitle').value = item.groupTitle || '✨ Lain-lain Persiapan';
    }

    document.getElementById('modal-exp-desc').value = item.description || '';
    document.getElementById('modal-exp-category').value = item.category || '';
    document.getElementById('modal-exp-budget').value = item.budget || '';
    document.getElementById('modal-exp-actual').value = item.actual || '';
    document.getElementById('modal-exp-pihak').value = item.pihak || 'Kongsi';
    document.getElementById('modal-exp-status').value = item.status || 'Belum';
    document.getElementById('modal-exp-notes').value = item.notes || '';

    const fileInput = document.getElementById('modal-exp-file');
    if (fileInput) fileInput.value = '';

    const statusWrap = document.getElementById('modal-exp-receipt-status');
    if (statusWrap) {
      if (item.hasReceipt) {
        statusWrap.style.display = 'block';
        statusWrap.innerHTML = `✅ Sudah ada resit tersimpan. <a href="#" style="color:#1d4ed8; text-decoration:underline; font-weight:700;" onclick="event.preventDefault(); window.dashboardApp.openReceiptModal('${item.id}')">Lihat Resit</a>`;
      } else {
        statusWrap.style.display = 'none';
      }
    }

    openModal('expense-modal');
  }

  let isSavingExpense = false;

  async function handleSaveExpense(e) {
    if (e) e.preventDefault();
    if (isSavingExpense) return;
    isSavingExpense = true;

    try {
      const desc = document.getElementById('modal-exp-desc').value.trim();
      if (!desc) {
        alert('Sila masukkan perkara/penerangan perbelanjaan.');
        return;
      }

      const phase = document.getElementById('modal-exp-phase').value;
      const category = document.getElementById('modal-exp-category').value.trim() || 'Persiapan';
      const budget = parseFloat(document.getElementById('modal-exp-budget').value) || 0;
      const actual = parseFloat(document.getElementById('modal-exp-actual').value) || 0;
      const pihak = document.getElementById('modal-exp-pihak').value;
      const status = document.getElementById('modal-exp-status').value;
      const notes = document.getElementById('modal-exp-notes').value.trim();

      const phaseObj = appData.phases.find(p => p.id === phase);
      const phaseTitle = phaseObj ? phaseObj.title : phase;

      // Determine group title from form selection or fallback
      const modalGroup = document.getElementById('modal-exp-grouptitle')?.value.trim();
      let groupTitle = modalGroup || '✨ Lain-lain Persiapan';

      if (!modalGroup) {
        if (pihak === 'Lelaki') {
          groupTitle = desc.toLowerCase().includes('hantaran') ? '🎁 Barang Hantaran (Lelaki Sediakan)' : '🤵 Part Pengantin Lelaki';
        } else if (pihak === 'Perempuan') {
          groupTitle = desc.toLowerCase().includes('hantaran') ? '🎁 Barang Hantaran (Perempuan Sediakan)' : '👰 Part Pengantin Perempuan';
        } else {
          if (category.toLowerCase().includes('katering') || desc.toLowerCase().includes('makan')) groupTitle = '🍽️ Jamuan & Katering';
          else if (category.toLowerCase().includes('lokasi') || desc.toLowerCase().includes('dewan') || desc.toLowerCase().includes('kemah')) groupTitle = '🏰 Lokasi, Dewan & Khemah';
          else if (category.toLowerCase().includes('foto') || desc.toLowerCase().includes('photo')) groupTitle = '📸 Fotografi & Media';
          else if (category.toLowerCase().includes('kad') || desc.toLowerCase().includes('jemputan')) groupTitle = '💌 Jemputan & Doorgift';
          else groupTitle = '🤝 Kos Bersama & Majlis';
        }
      }

      const existingItem = editingExpenseId ? appData.expenses.find(e => e.id === editingExpenseId) : null;
      const groupKey = getStandardGroupKey(groupTitle, existingItem);

      let targetExpenseId = editingExpenseId;

      if (editingExpenseId) {
        pushHistoryState(`Kemaskini '${desc}'`);
        const idx = appData.expenses.findIndex(e => e.id === editingExpenseId);
        if (idx !== -1) {
          appData.expenses[idx] = {
            ...appData.expenses[idx],
            phase,
            phaseTitle,
            category,
            groupTitle,
            groupKey,
            description: desc,
            budget,
            actual,
            pihak,
            status,
            notes
          };
          showToast(`Item '${desc}' berjaya dikemaskini! ✅`, 'success', true);
        }
      } else {
        pushHistoryState(`Tambah '${desc}'`);
        targetExpenseId = 'exp_' + Date.now();
        const newExpenseItem = {
          id: targetExpenseId,
          phase,
          phaseTitle,
          category,
          groupTitle,
          groupKey,
          description: desc,
          budget,
          actual,
          pihak,
          status,
          notes,
          hasReceipt: false
        };

        // Cari item terakhir dalam kumpulan & fasa yang sama supaya item baharu berada di list bawah (bukan di atas)
        let lastIndexInGroup = -1;
        for (let i = appData.expenses.length - 1; i >= 0; i--) {
          const item = appData.expenses[i];
          if (item.phase === phase && (item.groupTitle === groupTitle || item.groupKey === groupKey)) {
            lastIndexInGroup = i;
            break;
          }
        }

        if (lastIndexInGroup !== -1) {
          // Masukkan item baru tepat di bawah item terakhir kumpulan tersebut
          appData.expenses.splice(lastIndexInGroup + 1, 0, newExpenseItem);
        } else {
          // Jika kumpulan belum ada dalam fasa ini, masukkan di bahagian bawah senarai fasa atau di hujung array
          let lastIndexInPhase = -1;
          for (let i = appData.expenses.length - 1; i >= 0; i--) {
            if (appData.expenses[i].phase === phase) {
              lastIndexInPhase = i;
              break;
            }
          }
          if (lastIndexInPhase !== -1) {
            appData.expenses.splice(lastIndexInPhase + 1, 0, newExpenseItem);
          } else {
            appData.expenses.push(newExpenseItem);
          }
        }

        showToast(`✅ Berjaya Disimpan! Item "${desc}" telah ditambah ke bahagian bawah "${groupTitle}".`, 'success', true);
      }

      // Check if a receipt file was uploaded in modal
      const fileInput = document.getElementById('modal-exp-file');
      if (fileInput && fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = async function(evt) {
          const receiptRecord = {
            id: targetExpenseId,
            expenseId: targetExpenseId,
            expenseDesc: desc,
            phase: phaseTitle,
            amount: actual > 0 ? actual : budget,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            fileData: evt.target.result,
            notes: notes,
            uploadDate: new Date().toLocaleString('ms-MY')
          };
          await dbSaveReceipt(receiptRecord);
          const expItem = appData.expenses.find(e => e.id === targetExpenseId);
          if (expItem) expItem.hasReceipt = true;
          saveData();
          await syncReceiptFlags();
          renderExpensesView();
        };
        reader.readAsDataURL(file);
      }

      lastActiveGroupKey = groupKey;
      expandedGroupCardIds.add('card-' + groupKey);

      saveData();
      closeModal('expense-modal');

      // KEKAL BERADA DI HALAMAN / TAB SEMASA: Jangan sekali-kali lompat ke pages/tab lain
      renderExpensesView();
      renderPhaseBanners();
      updateHeaderSummary();
      renderMilestones();

      // Pastikan kad seksyen tersebut kekal terbuka dan skrin fokus tepat ke item berkenaan
      setTimeout(() => {
        const cardEl = document.getElementById(`card-${groupKey}`);
        if (cardEl) {
          if (cardEl.classList.contains('collapsed')) {
            cardEl.classList.remove('collapsed');
            const icon = cardEl.querySelector('.group-collapse-icon');
            if (icon) icon.textContent = '▼';
          }
        }

        let rowEl = document.querySelector(`tr[data-id="${targetExpenseId}"]`);
        
        // Jika item tidak dijumpai akibat penapis pihak/status yang aktif, laras semula penapis supaya item muncul
        if (!rowEl && (activePihakFilter !== 'all' || activeCategoryFilter !== 'all' || expenseFilters.status !== 'all')) {
          activePihakFilter = 'all';
          activeCategoryFilter = 'all';
          expenseFilters.status = 'all';
          renderExpensesView();
          rowEl = document.querySelector(`tr[data-id="${targetExpenseId}"]`);
        }

        if (rowEl) {
          const rect = rowEl.getBoundingClientRect();
          const absoluteTop = window.scrollY + rect.top;
          const targetTop = Math.max(0, absoluteTop - (window.innerHeight / 2) + (rect.height / 2));
          window.scrollTo({ top: targetTop, behavior: 'smooth' });

          rowEl.style.transition = 'background-color 0.4s ease, box-shadow 0.4s ease';
          rowEl.style.backgroundColor = 'rgba(217, 119, 6, 0.22)';
          rowEl.style.outline = '2px solid rgba(217, 119, 6, 0.55)';
          setTimeout(() => {
            rowEl.style.backgroundColor = '';
            rowEl.style.outline = '';
          }, 2500);
        } else if (cardEl) {
          const cRect = cardEl.getBoundingClientRect();
          const cTop = window.scrollY + cRect.top - 80;
          window.scrollTo({ top: Math.max(0, cTop), behavior: 'smooth' });
        }
      }, 70);
    } finally {
      editingExpenseId = null;
      isSavingExpense = false;
    }
  }

  async function deleteExpense(expenseId) {
    const item = appData.expenses.find(e => e.id === expenseId);
    if (!item) return;

    if (confirm(`Adakah anda pasti ingin memadam rekod "${item.description}"?`)) {
      pushHistoryState(`Padam '${item.description}'`);
      const groupKey = item.groupKey || getStandardGroupKey(item.groupTitle || '', item);
      lastActiveGroupKey = groupKey;
      expandedGroupCardIds.add('card-' + groupKey);

      appData.expenses = appData.expenses.filter(e => e.id !== expenseId);
      if (item.hasReceipt) {
        await dbDeleteReceipt(expenseId);
      }
      const currentScrollY = window.scrollY;
      saveData();
      await syncReceiptFlags();
      renderExpensesView();
      renderPhaseBanners();
      updateHeaderSummary();
      renderMilestones();
      window.scrollTo({ top: currentScrollY, behavior: 'instant' });
      showToast(`Item "${item.description}" telah dipadam.`, 'info', true);
    }
  }

  // --- CRUD Modals for Guests ---
  function openAddGuestModal() {
    editingGuestId = null;
    document.getElementById('guest-modal-title').textContent = 'Tambah Jemputan Tetamu Baharu';

    document.getElementById('modal-gst-nama').value = '';
    document.getElementById('modal-gst-pax').value = '1';
    document.getElementById('modal-gst-side').value = 'Lelaki';
    document.getElementById('modal-gst-group').value = 'Keluarga / Sahabat';
    document.getElementById('modal-gst-kad').value = 'Belum Hantar';
    document.getElementById('modal-gst-attendance').value = 'Belum Pasti';
    document.getElementById('modal-gst-notes').value = '';

    openModal('guest-modal');
  }

  function openEditGuestModal(guestId) {
    const g = appData.guests.find(item => item.id === guestId);
    if (!g) return;

    editingGuestId = guestId;
    document.getElementById('guest-modal-title').textContent = 'Kemaskini Maklumat Tetamu';

    document.getElementById('modal-gst-nama').value = g.nama || '';
    document.getElementById('modal-gst-pax').value = g.pax || 1;
    document.getElementById('modal-gst-side').value = g.side || 'Lelaki';
    document.getElementById('modal-gst-group').value = g.group || '';
    document.getElementById('modal-gst-kad').value = g.kad && g.kad.includes('Sudah') ? 'Sudah Hantar' : 'Belum Hantar';
    document.getElementById('modal-gst-attendance').value = g.attendance || 'Belum Pasti';
    document.getElementById('modal-gst-notes').value = g.notes || '';

    openModal('guest-modal');
  }

  let isSavingGuest = false;

  function handleSaveGuest(e) {
    if (e) e.preventDefault();
    if (isSavingGuest) return;
    isSavingGuest = true;

    try {
      const nama = document.getElementById('modal-gst-nama').value.trim();
      if (!nama) {
        alert('Sila masukkan nama tetamu / keluarga.');
        return;
      }

      const pax = parseInt(document.getElementById('modal-gst-pax').value) || 1;
      const side = document.getElementById('modal-gst-side').value;
      const group = document.getElementById('modal-gst-group').value.trim() || 'Keluarga / Sahabat';
      const kad = document.getElementById('modal-gst-kad').value;
      const attendance = document.getElementById('modal-gst-attendance').value;
      const notes = document.getElementById('modal-gst-notes').value.trim();

      if (editingGuestId) {
        pushHistoryState(`Kemaskini maklumat tetamu '${nama}'`);
        const idx = appData.guests.findIndex(g => g.id === editingGuestId);
        if (idx !== -1) {
          appData.guests[idx] = {
            ...appData.guests[idx],
            nama,
            pax,
            side,
            group,
            kad,
            attendance,
            notes
          };
          showToast(`Maklumat ${nama} berjaya dikemaskini!`, 'success', true);
        }
      } else {
        pushHistoryState(`Tambah tetamu '${nama}'`);
        const newId = 'gst_' + Date.now();
        appData.guests.push({
          id: newId,
          nama,
          pax,
          paxRaw: String(pax),
          side,
          group,
          kad,
          attendance,
          notes
        });
        showToast(`Tetamu baharu '${nama}' berjaya ditambah! 💌`, 'success', true);
      }

      const targetGuestId = editingGuestId || ('gst_' + Date.now());
      saveData();
      closeModal('guest-modal');
      renderGuestTable();

      setTimeout(() => {
        const row = document.querySelector(`tr[data-guest-id="${targetGuestId}"]`);
        if (row) {
          const rect = row.getBoundingClientRect();
          const absoluteTop = window.scrollY + rect.top;
          window.scrollTo({ top: Math.max(0, absoluteTop - (window.innerHeight / 2) + (rect.height / 2)), behavior: 'smooth' });
          row.style.transition = 'background-color 0.4s ease';
          row.style.backgroundColor = 'rgba(217, 119, 6, 0.22)';
          setTimeout(() => { row.style.backgroundColor = ''; }, 2000);
        }
      }, 70);
    } finally {
      editingGuestId = null;
      isSavingGuest = false;
    }
  }

  function deleteGuest(guestId) {
    const g = appData.guests.find(item => item.id === guestId);
    if (!g) return;

    if (confirm(`Adakah anda pasti ingin memadam tetamu "${g.nama}"?`)) {
      pushHistoryState(`Padam tetamu '${g.nama}'`);
      appData.guests = appData.guests.filter(item => item.id !== guestId);
      saveData();
      renderGuestTable();
      showToast(`Tetamu "${g.nama}" telah dipadam.`, 'info', true);
    }
  }

  // --- Modal Helpers ---
  function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
  }

  // --- Charts Rendering (Chart.js) ---
  function renderCharts() {
    if (typeof Chart === 'undefined') return;

    const phaseLabels = appData.phases.map(p => p.title);
    const phaseBudget = appData.phases.map(p => {
      return appData.expenses
        .filter(e => e.phase === p.id)
        .reduce((sum, e) => sum + (Number(e.budget) || 0), 0);
    });
    const phaseActual = appData.phases.map(p => {
      return appData.expenses
        .filter(e => e.phase === p.id)
        .reduce((sum, e) => sum + (Number(e.actual) || 0), 0);
    });

    const ctx1 = document.getElementById('chart-phase-expenses');
    if (ctx1) {
      if (charts.phaseExp) charts.phaseExp.destroy();
      charts.phaseExp = new Chart(ctx1, {
        type: 'bar',
        data: {
          labels: phaseLabels,
          datasets: [
            {
              label: 'Anggaran Bajet (RM)',
              data: phaseBudget,
              backgroundColor: 'rgba(198, 147, 75, 0.65)',
              borderColor: '#c6934b',
              borderWidth: 1.5,
              borderRadius: 6
            },
            {
              label: 'Sebenar / Dibelanjakan (RM)',
              data: phaseActual,
              backgroundColor: 'rgba(158, 42, 75, 0.75)',
              borderColor: '#9e2a4b',
              borderWidth: 1.5,
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top' },
            tooltip: {
              callbacks: {
                label: (ctx) => ` ${ctx.dataset.label}: ${formatRM(ctx.raw)}`
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                callback: (val) => 'RM ' + (val >= 1000 ? (val / 1000) + 'k' : val)
              }
            }
          }
        }
      });
    }

    const pihakSums = { Lelaki: 0, Perempuan: 0, Kongsi: 0 };
    appData.expenses.forEach(e => {
      const val = Number(e.actual) || Number(e.budget) || 0;
      if (e.pihak === 'Lelaki') pihakSums.Lelaki += val;
      else if (e.pihak === 'Perempuan') pihakSums.Perempuan += val;
      else pihakSums.Kongsi += val;
    });

    const ctx2 = document.getElementById('chart-pihak-expenses');
    if (ctx2) {
      if (charts.pihakExp) charts.pihakExp.destroy();
      charts.pihakExp = new Chart(ctx2, {
        type: 'doughnut',
        data: {
          labels: ['Pihak Lelaki', 'Pihak Perempuan', 'Kongsi Bersama'],
          datasets: [{
            data: [pihakSums.Lelaki, pihakSums.Perempuan, pihakSums.Kongsi],
            backgroundColor: ['#3b82f6', '#ec4899', '#8b5cf6'],
            borderWidth: 2,
            borderColor: '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom' },
            tooltip: {
              callbacks: {
                label: (ctx) => ` ${ctx.label}: ${formatRM(ctx.raw)}`
              }
            }
          }
        }
      });
    }

    const stats = calculateMasterStats();
    const ctx3 = document.getElementById('chart-guest-rsvp');
    if (ctx3) {
      if (charts.guestRsvp) charts.guestRsvp.destroy();
      charts.guestRsvp = new Chart(ctx3, {
        type: 'doughnut',
        data: {
          labels: ['Sah Hadir', 'Tidak Hadir', 'Belum Pasti'],
          datasets: [{
            data: [stats.confirmedPax, stats.declinedPax, stats.pendingPax],
            backgroundColor: ['#10b981', '#f43f5e', '#f59e0b'],
            borderWidth: 2,
            borderColor: '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom' },
            tooltip: {
              callbacks: {
                label: (ctx) => ` ${ctx.label}: ${ctx.raw} Pax`
              }
            }
          }
        }
      });
    }

    const ctx4 = document.getElementById('chart-payment-status');
    if (ctx4) {
      if (charts.paymentStatus) charts.paymentStatus.destroy();
      charts.paymentStatus = new Chart(ctx4, {
        type: 'pie',
        data: {
          labels: ['Sudah Bayar', 'Baki Belum Bayar'],
          datasets: [{
            data: [stats.totalPaid, stats.balanceToPay],
            backgroundColor: ['#10b981', '#f43f5e'],
            borderWidth: 2,
            borderColor: '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom' },
            tooltip: {
              callbacks: {
                label: (ctx) => ` ${ctx.label}: ${formatRM(ctx.raw)}`
              }
            }
          }
        }
      });
    }
  }

  // --- Export & Import & Backup ---
  function exportDataJSON() {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(appData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `Wedding_Dashboard_Aisyah_Zuhair_Backup_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('Fail sandaran JSON berjaya dimuat turun! 💾', 'success');
  }

  function exportDataCSV() {
    let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
    csvContent += 'FASA,BAHAGIAN,PERKARA,PIHAK,ANGGARAN_RM,SEBENAR_RM,STATUS,CATATAN\n';

    appData.expenses.forEach(item => {
      const row = [
        `"${(item.phaseTitle || item.phase).replace(/"/g, '""')}"`,
        `"${(item.groupTitle || item.category || '').replace(/"/g, '""')}"`,
        `"${(item.description || '').replace(/"/g, '""')}"`,
        `"${(item.pihak || '').replace(/"/g, '""')}"`,
        item.budget || 0,
        item.actual || 0,
        `"${(item.status || '').replace(/"/g, '""')}"`,
        `"${(item.notes || '').replace(/"/g, '""')}"`
      ];
      csvContent += row.join(',') + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Perbelanjaan_Kahwin_Aisyah_Zuhair_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast('Fail CSV Perbelanjaan berjaya dimuat turun! 📊', 'success');
  }

  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
      try {
        const imported = JSON.parse(event.target.result);
        if (imported.expenses && imported.guests) {
          pushHistoryState('Import data sandaran');
          appData = imported;
          saveData();
          syncReceiptFlags();
          showToast('Data sandaran berjaya dimuat naik & dipulihkan! ✨', 'success', true);
        } else {
          alert('Format fail JSON tidak sah. Sila pastikan fail mengandungi data perbelanjaan dan tetamu.');
        }
      } catch (err) {
        alert('Ralat membaca fail: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function resetToDefault() {
    if (confirm('Adakah anda pasti ingin memulihkan semua data kembali ke data asal daripada fail Excel? Sebarang pertambahan data baru yang belum dibackup akan dipadam.')) {
      pushHistoryState('Pulihkan ke data asal');
      appData = JSON.parse(JSON.stringify(INITIAL_WEDDING_DATA));
      saveData();
      syncReceiptFlags();
      showToast('Data telah berjaya dipulihkan kepada data asal Excel! 🔄', 'success', true);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Attach Event Listeners ---
  function initEvents() {
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal) modal.classList.remove('active');
      });
    });

    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
      });
    });

    const expForm = document.getElementById('expense-form');
    if (expForm) expForm.addEventListener('submit', handleSaveExpense);

    const gstForm = document.getElementById('guest-form');
    if (gstForm) gstForm.addEventListener('submit', handleSaveGuest);

    const uploadReceiptForm = document.getElementById('upload-receipt-form');
    if (uploadReceiptForm) uploadReceiptForm.addEventListener('submit', handleUploadReceiptFormSubmit);

    // Direct Receipt Upload File Input (triggered from table row '+ Resit' button)
    const directReceiptInput = document.getElementById('receipt-upload-input');
    if (directReceiptInput) {
      directReceiptInput.addEventListener('change', async (e) => {
        if (!e.target.files || !e.target.files[0] || !pendingReceiptExpenseId) return;

        const file = e.target.files[0];
        const targetExp = appData.expenses.find(item => item.id === pendingReceiptExpenseId);
        if (!targetExp) return;

        const reader = new FileReader();
        reader.onload = async function(evt) {
          const receiptRecord = {
            id: targetExp.id,
            expenseId: targetExp.id,
            expenseDesc: targetExp.description,
            phase: targetExp.phaseTitle || targetExp.phase,
            amount: targetExp.actual > 0 ? targetExp.actual : targetExp.budget,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            fileData: evt.target.result,
            notes: targetExp.notes || '',
            uploadDate: new Date().toLocaleString('ms-MY')
          };

          await dbSaveReceipt(receiptRecord);
          targetExp.hasReceipt = true;
          saveData();
          await syncReceiptFlags();
          renderExpensesView();
          showToast(`Resit untuk "${targetExp.description}" berjaya disimpan! 🧾`, 'success');
          pendingReceiptExpenseId = null;
        };
        reader.readAsDataURL(file);
      });
    }

    const gstSearch = document.getElementById('guest-search-input');
    if (gstSearch) {
      gstSearch.addEventListener('input', (e) => {
        guestFilters.search = e.target.value.trim();
        renderGuestTable();
      });
    }

    const gstSide = document.getElementById('guest-side-filter');
    if (gstSide) {
      gstSide.addEventListener('change', (e) => {
        guestFilters.side = e.target.value;
        renderGuestTable();
      });
    }

    const gstKad = document.getElementById('guest-kad-filter');
    if (gstKad) {
      gstKad.addEventListener('change', (e) => {
        guestFilters.kad = e.target.value;
        renderGuestTable();
      });
    }

    const gstAtt = document.getElementById('guest-att-filter');
    if (gstAtt) {
      gstAtt.addEventListener('change', (e) => {
        guestFilters.attendance = e.target.value;
        renderGuestTable();
      });
    }

    const importInput = document.getElementById('import-file-input');
    if (importInput) {
      importInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          handleImportFile(e.target.files[0]);
          e.target.value = '';
        }
      });
    }

    // Undo / Redo Header Buttons
    const btnUndo = document.getElementById('btn-undo-header');
    if (btnUndo) {
      btnUndo.addEventListener('click', () => {
        undoLastAction();
      });
    }

    const btnRedo = document.getElementById('btn-redo-header');
    if (btnRedo) {
      btnRedo.addEventListener('click', () => {
        redoLastAction();
      });
    }

    // Keyboard Shortcuts: Cmd+Z / Ctrl+Z (Undo) and Cmd+Shift+Z / Ctrl+Y (Redo)
    window.addEventListener('keydown', (e) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
      if (!isInput && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          redoLastAction();
        } else {
          e.preventDefault();
          undoLastAction();
        }
      } else if (!isInput && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoLastAction();
      }
    });
  }

  async function init() {
    renderMasterKPI();
    renderMilestoneTracker();
    renderPhaseBanners();
    renderExpensesView();
    renderGuestTable();
    initEvents();
    updateUndoButtonState();
    await syncReceiptFlags();

    switchTab('all');
  }

  window.dashboardApp = {
    switchTab,
    setPartyFilter,
    setCategoryFilter,
    expandAllGroups,
    toggleGroupCard,
    setViewMode,
    handleSearchChange,
    handleStatusFilterChange,
    quickToggleStatus,
    quickToggleKad,
    updateGuestAttendance,
    openAddExpenseModal,
    openAddExpenseModalWithGroup,
    openEditExpenseModal,
    handleSaveExpense,
    handleModalPhaseChange,
    handleModalGroupChange,
    deleteExpense,
    openAddGuestModal,
    openEditGuestModal,
    deleteGuest,
    exportDataJSON,
    exportDataCSV,
    resetToDefault,
    handleReceiptAction,
    triggerUploadReceipt,
    openReceiptModal,
    deleteReceiptForExpense,
    promptUploadGeneralReceipt,
    handleRowDragStart,
    handleRowDragOver,
    handleRowDragLeave,
    handleRowDrop,
    handleRowDragEnd,
    moveExpenseItem,
    undoLastAction,
    redoLastAction
  };

  document.addEventListener('DOMContentLoaded', init);
})();
