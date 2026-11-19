"use strict";

/* =====================================================================
   app.js — mesin dashboard yang dipakai oleh DUA halaman

     index.html    <body data-page="gangguan">  ->  sheet DATA_GANGGUAN
     kinerja.html  <body data-page="kinerja">   ->  sheet DATA_KINERJA

   Urutan isi file (ikuti nomor BAGIAN):
     1. Pengaturan umum
     2. Fungsi bantu (teks, tanggal, urut, hitung)
     3. Mengambil data dari backend /api/data
     4. Grafik (Chart.js)
     5. Konfigurasi tiap halaman     <-- bagian yang paling sering Anda ubah
     6. Mesin halaman: validasi kolom, filter, tabel, refresh
     7. Menjalankan halaman yang sesuai
   ===================================================================== */


/* =====================================================================
   BAGIAN 1 — Pengaturan umum
   ===================================================================== */
const API_BASE = "/api/data?sheet=";
const REFRESH_INTERVAL = 15 * 60 * 1000;   // 15 menit (dalam milidetik). Ubah di sini.
const PAGE_SIZE = 25;                      // jumlah baris per halaman tabel


/* =====================================================================
   BAGIAN 2 — Fungsi bantu
   ===================================================================== */
const $ = id => document.getElementById(id);

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

const formatNumber = value => Number(value).toLocaleString("id-ID");

// Teks apa pun -> teks bersih tanpa spasi di ujung
function normalize(value) {
  return String(value ?? "").trim();
}

// Samakan penulisan nama kolom: abaikan spasi ganda/di ujung (termasuk spasi
// non-breaking) dan huruf besar-kecil. "detail  penyebab " = "Detail Penyebab".
function canonical(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/* ---- Tanggal ----------------------------------------------------------
   Google Sheets mengirim tanggal sebagai NOMOR SERI (jumlah hari sejak
   30 Desember 1899), misalnya 45666 = 09/01/2025. Fungsi di bawah
   mengubahnya menjadi teks tanggal dd/mm/yyyy.                             */
const isPlausibleSerial = value =>
  typeof value === "number" && Number.isFinite(value) && value >= 10000 && value <= 80000;

// 45666 -> "09/01/2025";  45666.5 -> "09/01/2025 12:00"
// Memakai UTC agar tanggal tidak bergeser oleh zona waktu browser.
function serialToDateText(serial) {
  const pad = n => String(n).padStart(2, "0");
  const totalMinutes = Math.round(serial * 1440);
  const days = Math.floor(totalMinutes / 1440);
  const minuteOfDay = totalMinutes - days * 1440;
  const date = new Date(Date.UTC(1899, 11, 30) + days * 86400000);

  let text = `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
  if (minuteOfDay > 0) text += ` ${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
  return text;
}

// Ubah angka pada kolom-kolom tanggal menjadi teks tanggal (nilai non-angka dibiarkan).
function convertDateColumns(rows, columns) {
  if (columns.length === 0) return;
  rows.forEach(row => {
    columns.forEach(column => {
      if (isPlausibleSerial(row[column])) row[column] = serialToDateText(row[column]);
    });
  });
}

// "09/01/2025" -> "2025-01-09" agar urutan di filter kronologis (bukan hari dulu).
const dateSortKey = text => text.slice(0, 10).split("/").reverse().join("-") + text.slice(10);

// Dipakai pada halaman Kinerja: kolom mana yang kemungkinan berisi tanggal (dilihat dari namanya).
const looksLikeDateColumn = name => /(^|[^a-z])(blth|tanggal|tgl|date)([^a-z]|$)/i.test(name);

/* ---- Urut dan hitung -------------------------------------------------- */
function sortValues(values, isDate) {
  if (isDate) return values.sort((a, b) => dateSortKey(a).localeCompare(dateSortKey(b)));
  return values.sort((a, b) => a.localeCompare(b, "id", { numeric: true, sensitivity: "base" }));
}

// Nilai berbeda pada satu kolom, sudah terurut
function uniqueValues(rows, column, isDate = false) {
  const values = [...new Set(rows.map(row => normalize(row[column])).filter(Boolean))];
  return sortValues(values, isDate);
}

// [["SENTANI", 12], ["JAYAPURA", 9], ...] terbanyak dulu
function countBy(rows, column) {
  const counts = new Map();
  rows.forEach(row => {
    const label = normalize(row[column]) || "Tidak diisi";
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// Jumlah nilai berbeda; jika kolom utama kosong, pakai kolom cadangan
function countUnique(rows, column, fallbackColumn) {
  const values = rows.map(row => {
    const value = normalize(row[column]);
    return value || (fallbackColumn ? normalize(row[fallbackColumn]) : "");
  }).filter(Boolean);
  return new Set(values).size;
}


/* =====================================================================
   BAGIAN 3 — Mengambil data dari backend
   Backend (functions/api/data.js) mengirim:
     columns : ["BLTH", "Tahun", ...]
     records : [{ "BLTH": 45666, "Tahun": 2024, ... }, ...]   <- dipakai di sini
     rows    : [[45666, 2024, ...], ...]                      <- array nilai, tanpa nama kolom
   ===================================================================== */
function toRecords(result) {
  if (Array.isArray(result.records)) return result.records;

  // Cadangan: jika hanya rows yang ada, ubah menjadi objek memakai urutan kolom.
  const columns = Array.isArray(result.columns) ? result.columns : [];
  return result.rows.map(row => Array.isArray(row)
    ? Object.fromEntries(columns.map((name, index) => [name, row[index] ?? ""]))
    : row);
}

async function fetchSheet(sheet) {
  const response = await fetch(API_BASE + encodeURIComponent(sheet), {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Accept": "application/json" }
  });

  if (!response.ok) {
    // Backend menulis alasan di field "error"; baca agar ikut tampil.
    let detail = "";
    try {
      const body = await response.json();
      detail = body.error || body.message || "";
    } catch (e) { /* respons bukan JSON */ }
    throw new Error(`API mengembalikan HTTP ${response.status}` + (detail ? ": " + detail : ""));
  }

  const result = await response.json();
  if (!result.success || !(Array.isArray(result.records) || Array.isArray(result.rows))) {
    throw new Error(result.error || result.message || "Respons API tidak sesuai format.");
  }

  const records = toRecords(result);
  const columns = Array.isArray(result.columns)
    ? result.columns.map(String)
    : (records[0] ? Object.keys(records[0]) : []);

  return { records, columns, fetchedAt: result.fetchedAt };
}


/* =====================================================================
   BAGIAN 4 — Grafik
   Satu fungsi untuk membuat grafik pertama kali, lalu hanya memperbarui
   data pada pemanggilan berikutnya (tanpa berkedip).
   ===================================================================== */
const charts = new Map();

function upsertChart(canvasId, labels, values, buildConfig) {
  const canvas = $(canvasId);
  if (!canvas || typeof Chart === "undefined") return;   // CDN gagal: tabel dan KPI tetap jalan

  const existing = charts.get(canvasId);
  if (existing) {
    existing.data.labels = labels;
    existing.data.datasets[0].data = values;
    existing.update();
    return;
  }
  charts.set(canvasId, new Chart(canvas, buildConfig(labels, values)));
}

const PALET = [
  "#2563eb", "#0f9f83", "#e6a23c", "#805ad5",
  "#dc5252", "#0e7490", "#64748b", "#84a83d"
];

// Batang horizontal (dipakai di dua halaman)
const barHorizontal = (label, color = "#2878d0") => (labels, values) => ({
  type: "bar",
  data: {
    labels,
    datasets: [{ label, data: values, backgroundColor: color, borderRadius: 5 }]
  },
  options: {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
  }
});


/* =====================================================================
   BAGIAN 5 — Konfigurasi tiap halaman
   Kunci di PAGES harus sama dengan data-page di <body> halaman HTML.

   Isi konfigurasi:
     sheet           nama sheet (harus ada di ALLOWED_SHEETS pada data.js)
     columns         daftar kolom yang ditampilkan di tabel, atau null = ikuti
                     kolom apa pun yang dikirim sheet
     requiredColumns kolom yang wajib ada (dipakai KPI/grafik/filter)
     dateColumns     kolom tanggal, atau "auto" = tebak dari nama kolom
     filters         filter tetap: { column, id } (id = id <select> di HTML)
     autoFilters     filter otomatis: { max, maxOptions } (isi <div id="filterGrid">)
     render(rows)    mengisi KPI dan grafik dari baris yang lolos filter
   ===================================================================== */
const PAGES = {

  /* ---------------------------- Halaman 1: Gangguan ---------------------------- */
  gangguan: {
    sheet: "DATA_GANGGUAN",

    columns: [
      "BLTH", "Tahun", "ULP", "Lokasi", "Penyulang", "ID Penyulang",
      "Nama Pemutus", "Jenis Keypoint", "Kontrol Open", "Lama Padam",
      "Konversi Waktu", "Indikasi", "Penyebab", "RCT", "Detail Penyebab"
    ],

    // Dipakai KPI, grafik, dan filter. Jika salah satunya hilang, dashboard dihentikan
    // dengan pesan jelas. Kolom lain yang hilang hanya tampil kosong + peringatan.
    requiredColumns: [
      "BLTH", "Tahun", "ULP", "Penyulang", "ID Penyulang",
      "Jenis Keypoint", "Indikasi", "Penyebab"
    ],

    dateColumns: ["BLTH"],

    // Setiap id harus punya <select id="..."> di index.html
    filters: [
      { column: "BLTH",           id: "filter-blth" },
      { column: "Tahun",          id: "filter-tahun" },
      { column: "ULP",            id: "filter-ulp" },
      { column: "Penyulang",      id: "filter-penyulang" },
      { column: "Jenis Keypoint", id: "filter-keypoint" },
      { column: "Indikasi",       id: "filter-indikasi" },
      { column: "Penyebab",       id: "filter-penyebab" }
    ],

    render(rows) {
      setText("totalRecords", formatNumber(rows.length));
      setText("totalULP", formatNumber(countUnique(rows, "ULP")));
      setText("totalPenyulang", formatNumber(countUnique(rows, "ID Penyulang", "Penyulang")));
      setText("totalKeypoint", formatNumber(countUnique(rows, "Jenis Keypoint")));

      const perUlp = countBy(rows, "ULP");
      upsertChart("ulpChart", perUlp.map(i => i[0]), perUlp.map(i => i[1]),
        barHorizontal("Jumlah catatan"));

      const perKeypoint = countBy(rows, "Jenis Keypoint");
      upsertChart("keypointChart", perKeypoint.map(i => i[0]), perKeypoint.map(i => i[1]),
        (labels, values) => ({
          type: "doughnut",
          data: {
            labels,
            datasets: [{ data: values, backgroundColor: PALET, borderWidth: 2, borderColor: "#ffffff" }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: "bottom" } }
          }
        }));
    }
  },

  /* ----------------------------- Halaman 2: Kinerja ---------------------------- */
  // Nama kolom sheet DATA_KINERJA belum dipetakan, jadi halaman ini mengikuti kolom
  // apa pun yang dikirim sheet. Setelah kolomnya pasti, isi `columns`, `filters`,
  // dan `render` di bawah dengan KPI/grafik yang Anda inginkan.
  kinerja: {
    sheet: "DATA_KINERJA",
    columns: null,
    requiredColumns: [],
    dateColumns: "auto",
    autoFilters: { max: 6, maxOptions: 40 },

    // Dipanggil sekali saat halaman dibuka
    init(page) {
      const select = $("chartColumn");
      if (select) select.addEventListener("change", page.renderAll);
    },

    // Dipanggil setiap data baru diterima: isi pilihan kolom untuk grafik
    onData(allRows, columns) {
      const select = $("chartColumn");
      if (!select) return;

      const previous = select.value;
      const candidates = columns.filter(column => {
        const total = uniqueValues(allRows, column).length;
        return total >= 2 && total <= 200;
      });

      select.replaceChildren(...candidates.map(column => new Option(column, column)));
      select.value = candidates.includes(previous) ? previous : (candidates[0] || "");
    },

    render(rows, page) {
      setText("totalData", formatNumber(rows.length));
      setText("totalAll", formatNumber(page.allRows.length));
      setText("totalColumns", formatNumber(page.columns.length));

      const column = $("chartColumn") ? $("chartColumn").value : "";
      if (!column) {
        setText("totalCategories", "0");
        return;
      }

      const counts = countBy(rows, column);
      setText("totalCategories", formatNumber(counts.length));

      const top = counts.slice(0, 15);
      upsertChart("kinerjaChart", top.map(i => i[0]), top.map(i => i[1]),
        barHorizontal("Jumlah data", "#0f9f83"));
    }
  }
};


/* =====================================================================
   BAGIAN 6 — Mesin halaman
   createPage(config) memasang semua perilaku untuk satu halaman.
   ===================================================================== */
function createPage(config) {
  let allRows = [];                                                   // semua baris dari sheet
  let tableColumns = config.columns ? [...config.columns] : [];       // kolom yang tampil di tabel
  let dateColumns = Array.isArray(config.dateColumns) ? [...config.dateColumns] : [];
  let filterDefs = config.filters ? [...config.filters] : [];         // [{ column, id }]
  let autoFiltersReady = false;
  let currentPage = 1;
  let isLoading = false;

  // Objek yang diberikan ke fungsi init/onData/render milik halaman
  const page = {
    renderAll,
    get allRows() { return allRows; },
    get columns() { return tableColumns; }
  };

  /* ---------- Status dan pesan ---------- */
  function setStatus(text, kind) {
    const status = $("connectionStatus");
    if (!status) return;
    status.textContent = text;
    status.className = "connection" + (kind ? " " + kind : "");
  }

  function showNotice(text) {
    const notice = $("errorMessage");
    if (!notice) return;
    notice.textContent = text;
    notice.classList.add("show");
  }

  function showTableMessage(text) {
    const body = $("dataBody");
    if (!body) return;
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = Math.max(1, tableColumns.length);
    td.className = "empty";
    td.textContent = text;
    tr.appendChild(td);
    body.replaceChildren(tr);
  }

  /* ---------- Validasi kolom dan penyamaan nama ---------- */
  function prepare(result) {
    const received = result.columns;

    // Mode kolom tetap: cocokkan nama dari API dengan nama di config (abaikan spasi/huruf).
    // Mode kolom otomatis: pakai nama apa adanya.
    const byCanonical = config.columns
      ? new Map(config.columns.map(column => [canonical(column), column]))
      : null;

    const keyMap = {};
    received.forEach(name => {
      keyMap[name] = (byCanonical && byCanonical.get(canonical(name))) || name;
    });
    const available = new Set(Object.values(keyMap));

    // Kolom wajib hilang -> hentikan, tampilkan kolom apa saja yang diterima
    const missingRequired = (config.requiredColumns || []).filter(column => !available.has(column));
    if (missingRequired.length > 0) {
      throw new Error(
        "Kolom wajib belum ada di API: " + missingRequired.join(", ") +
        ". Kolom yang diterima (" + received.length + "): " + received.join(", ")
      );
    }

    // Kolom lain hilang -> hanya peringatan; sel tampil kosong
    const missingOptional = config.columns
      ? config.columns.filter(column => !available.has(column))
      : [];

    // Samakan nama kunci tiap baris jika ada kolom yang penulisannya berbeda
    const needsRename = received.some(name => keyMap[name] !== name);
    const rows = needsRename
      ? result.records.map(record => {
          const fixed = {};
          Object.keys(record).forEach(key => { fixed[keyMap[key] ?? key] = record[key]; });
          return fixed;
        })
      : result.records;

    return { rows, missingOptional };
  }

  /* ---------- Filter ---------- */
  // Mengisi pilihan setiap <select> dari data; pilihan yang sedang aktif dipertahankan.
  function populateFilters() {
    filterDefs.forEach(({ column, id }) => {
      const select = $(id);
      if (!select) return;

      const previous = select.value;
      const values = uniqueValues(allRows, column, dateColumns.includes(column));
      select.replaceChildren(new Option("Semua", ""), ...values.map(value => new Option(value, value)));
      select.value = values.includes(previous) ? previous : "";
    });
  }

  // Halaman Kinerja: pilih kolom yang cocok dijadikan filter (nilai berbeda 2..maxOptions),
  // lalu buat <select>-nya. Dilakukan sekali, saat data pertama kali diterima.
  function buildAutoFilters() {
    const grid = $("filterGrid");
    if (!grid || !config.autoFilters || allRows.length === 0) return;

    const { max = 6, maxOptions = 40 } = config.autoFilters;
    grid.replaceChildren();
    filterDefs = [];

    tableColumns.forEach(column => {
      if (filterDefs.length >= max) return;
      const total = uniqueValues(allRows, column, dateColumns.includes(column)).length;
      if (total < 2 || total > maxOptions) return;

      const id = "filter-auto-" + filterDefs.length;
      filterDefs.push({ column, id });

      const field = document.createElement("div");
      field.className = "field";
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = column;
      const select = document.createElement("select");
      select.id = id;
      select.addEventListener("change", () => { currentPage = 1; renderAll(); });

      field.append(label, select);
      grid.appendChild(field);
    });

    if (filterDefs.length === 0) {
      const note = document.createElement("p");
      note.className = "filter-empty";
      note.textContent = "Tidak ada kolom yang cocok dijadikan filter otomatis.";
      grid.appendChild(note);
    }
    autoFiltersReady = true;
  }

  // Baris yang lolos pencarian dan semua filter yang dipilih
  function getFilteredRows() {
    const keyword = normalize($("search") ? $("search").value : "").toLocaleLowerCase("id-ID");
    const selected = filterDefs
      .map(({ column, id }) => [column, $(id) ? $(id).value : ""])
      .filter(([, value]) => value);

    return allRows.filter(row => {
      const matchesSearch = !keyword || tableColumns.some(column =>
        normalize(row[column]).toLocaleLowerCase("id-ID").includes(keyword)
      );
      const matchesFilters = selected.every(([column, value]) => normalize(row[column]) === value);
      return matchesSearch && matchesFilters;
    });
  }

  /* ---------- Tabel berhalaman ---------- */
  function renderTable(rows) {
    const header = $("tableHeader");
    const body = $("dataBody");
    if (!header || !body) return;

    header.replaceChildren();
    body.replaceChildren();

    tableColumns.forEach(column => {
      const th = document.createElement("th");
      th.textContent = column;
      header.appendChild(th);
    });

    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    if (pageRows.length === 0) {
      showTableMessage(allRows.length === 0
        ? "Belum ada data di sheet."
        : "Tidak ada data yang sesuai dengan filter.");
    } else {
      const fragment = document.createDocumentFragment();
      pageRows.forEach(row => {
        const tr = document.createElement("tr");
        tableColumns.forEach(column => {
          const td = document.createElement("td");
          // textContent mencegah isi spreadsheet ditafsirkan sebagai HTML.
          td.textContent = row[column] ?? "";
          tr.appendChild(td);
        });
        fragment.appendChild(tr);
      });
      body.appendChild(fragment);
    }

    setText("rowCount", `${formatNumber(rows.length)} data ditampilkan`);
    setText("pageInfo", `Halaman ${currentPage} dari ${totalPages}`);
    if ($("previousPage")) $("previousPage").disabled = currentPage <= 1;
    if ($("nextPage")) $("nextPage").disabled = currentPage >= totalPages;
  }

  // Menggambar ulang tabel + KPI + grafik dengan filter yang aktif
  function renderAll() {
    const rows = getFilteredRows();
    renderTable(rows);                       // tabel dulu, agar tidak ikut terblokir error grafik
    try {
      config.render(rows, page);
    } catch (error) {
      console.error("KPI/grafik gagal diperbarui:", error);
    }
  }

  /* ---------- Memuat data ---------- */
  async function loadData() {
    if (isLoading) return;
    isLoading = true;

    if ($("refreshButton")) $("refreshButton").disabled = true;
    setStatus("Memperbarui data...", "");
    if ($("errorMessage")) $("errorMessage").classList.remove("show");

    try {
      const result = await fetchSheet(config.sheet);
      const prepared = prepare(result);

      allRows = prepared.rows;
      if (!config.columns) tableColumns = result.columns.filter(Boolean);
      if (config.dateColumns === "auto") dateColumns = tableColumns.filter(looksLikeDateColumn);
      convertDateColumns(allRows, dateColumns);          // nomor seri -> dd/mm/yyyy

      if (config.autoFilters && !autoFiltersReady) buildAutoFilters();
      if (config.onData) config.onData(allRows, tableColumns, page);
      populateFilters();
      renderAll();

      setStatus("Terhubung · " + config.sheet, "online");
      setText("updatedAt", new Date(result.fetchedAt || Date.now()).toLocaleString("id-ID"));
      setText("tableNote", `Menampilkan seluruh ${tableColumns.length} kolom dari sheet ${config.sheet}.`);

      if (prepared.missingOptional.length > 0) {
        showNotice(
          "Peringatan: kolom berikut belum ada di API dan ditampilkan kosong: " +
          prepared.missingOptional.join(", ") +
          ". Periksa judul kolom di sheet atau rentang yang dibaca backend."
        );
      }
    } catch (error) {
      console.error("Dashboard refresh error:", error);
      setStatus("Koneksi bermasalah", "offline");
      showNotice(error.message);
      // Jika sudah ada data dari pemuatan sebelumnya, data itu tetap ditampilkan.
      if (allRows.length === 0) showTableMessage("Data belum dapat dimuat: " + error.message);
    } finally {
      isLoading = false;
      if ($("refreshButton")) $("refreshButton").disabled = false;
    }
  }

  /* ---------- Memasang event ---------- */
  function bindEvents() {
    const search = $("search");
    if (search) search.addEventListener("input", () => { currentPage = 1; renderAll(); });

    // Filter tetap (halaman Gangguan). Filter otomatis memasang event-nya sendiri.
    filterDefs.forEach(({ id }) => {
      const select = $(id);
      if (select) select.addEventListener("change", () => { currentPage = 1; renderAll(); });
    });

    const reset = $("resetFilters");
    if (reset) reset.addEventListener("click", () => {
      filterDefs.forEach(({ id }) => { if ($(id)) $(id).value = ""; });
      if ($("search")) $("search").value = "";
      currentPage = 1;
      renderAll();
    });

    const refresh = $("refreshButton");
    if (refresh) refresh.addEventListener("click", loadData);

    const previous = $("previousPage");
    if (previous) previous.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage--;
        renderTable(getFilteredRows());
      }
    });

    const next = $("nextPage");
    if (next) next.addEventListener("click", () => {
      const rows = getFilteredRows();
      const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      if (currentPage < totalPages) {
        currentPage++;
        renderTable(rows);
      }
    });
  }

  /* ---------- Mulai ---------- */
  bindEvents();
  setText("refreshNote", `Pembaruan otomatis setiap ${Math.round(REFRESH_INTERVAL / 60000)} menit selama halaman terbuka.`);
  if (config.init) config.init(page);
  loadData();                                         // ambil data saat halaman dibuka
  setInterval(loadData, REFRESH_INTERVAL);            // lalu otomatis tiap REFRESH_INTERVAL
}


/* =====================================================================
   BAGIAN 7 — Menjalankan halaman yang sesuai
   ===================================================================== */
const pageName = document.body.dataset.page;

if (PAGES[pageName]) {
  createPage(PAGES[pageName]);
} else {
  console.error(
    `Halaman "${pageName}" tidak dikenal. Isi data-page di <body> dengan salah satu: ` +
    Object.keys(PAGES).join(", ")
  );
}
