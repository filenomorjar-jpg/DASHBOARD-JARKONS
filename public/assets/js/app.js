
const API_URL = "/api/data?sheet=DATA_GANGGUAN";
const REFRESH_INTERVAL = 60 * 1000;

const COLUMNS = [
  "BLTH",
  "Tahun",
  "ULP",
  "Lokasi",
  "Penyulang",
  "ID Penyulang",
  "Nama Pemutus",
  "Jenis Keypoint",
  "Kontrol Open",
  "Lama Padam",
  "Konversi Waktu",
  "Indikasi:,
  "Penyebab",
  "RCT",
  "Detail Penyebab"
];

let allRows = [];
let ulpChart = null;
let keypointChart = null;
let isLoading = false;

const FILTERS = [
  "BLTH",
  "Tahun",
  "ULP",
  "Penyulang",
  "Jenis Keypoint",
  "Indikasi Penyebab"
];

function uniqueValues(rows, column) {
  return [...new Set(
    rows.map(row => String(row[column] ?? "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "id"));
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function createOptions(select, values) {
  const previous = select.value;
  select.replaceChildren();

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Semua";
  select.appendChild(defaultOption);

  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });

  if (values.includes(previous)) {
    select.value = previous;
  }
}

function setupFilters() {
  FILTERS.forEach(column => {
    const select = document.getElementById(
      "filter-" + column
    );

    if (select) {
      createOptions(select, uniqueValues(allRows, column));

      select.onchange = renderDashboard;
    }
  });
}

function getFilteredRows() {
  const keyword =
    document.getElementById("search")?.value
      .trim().toLowerCase() || "";

  return allRows.filter(row => {
    const matchesSearch = COLUMNS.some(column =>
      String(row[column] ?? "")
        .toLowerCase().includes(keyword)
    );

    const matchesFilters = FILTERS.every(column => {
      const selected = document.getElementById(
        "filter-" + column
      )?.value || "";

      return !selected ||
        String(row[column] ?? "").trim() === selected;
    });

    return matchesSearch && matchesFilters;
  });
}

function updateKPI(rows) {
  const totalULP = new Set(
    rows.map(row => row.ULP).filter(Boolean)
  ).size;

  const totalPenyulang = new Set(
    rows.map(row => row["ID Penyulang"])
      .filter(Boolean)
  ).size;

  const totalKeypoint = new Set(
    rows.map(row => row["Jenis Keypoint"])
      .filter(Boolean)
  ).size;

  setText("totalGangguan", rows.length);
  setText("totalULP", totalULP);
  setText("totalPenyulang", totalPenyulang);
  setText("totalKeypoint", totalKeypoint);
}

function countBy(rows, column) {
  const result = {};

  rows.forEach(row => {
    const key = String(row[column] || "Tidak diketahui");
    result[key] = (result[key] || 0) + 1;
  });

  return result;
}

function updateChart(oldChart, canvasId, data, title) {
  const canvas = document.getElementById(canvasId);

  if (!canvas || typeof Chart === "undefined") return oldChart;

  const labels = Object.keys(data);
  const values = Object.values(data);

  if (oldChart) {
    oldChart.data.labels = labels;
    oldChart.data.datasets[0].data = values;
    oldChart.update();
    return oldChart;
  }

  return new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: title,
        data: values,
        backgroundColor: "#2878D0",
        borderRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 }
        }
      }
    }
  });
}

function updateCharts(rows) {
  ulpChart = updateChart(
    ulpChart,
    "ulpChart",
    countBy(rows, "ULP"),
    "Jumlah Gangguan"
  );

  keypointChart = updateChart(
    keypointChart,
    "keypointChart",
    countBy(rows, "Jenis Keypoint"),
    "Jumlah Keypoint"
  );
}

function renderTable(rows) {
  const body = document.getElementById("dataBody");
  if (!body) return;

  body.replaceChildren();

  rows.forEach(row => {
    const tr = document.createElement("tr");

    COLUMNS.forEach(column => {
      const td = document.createElement("td");
      td.textContent = row[column] ?? "";
      tr.appendChild(td);
    });

    body.appendChild(tr);
  });

  setText("rowCount", rows.length + " data ditampilkan");
}

function renderDashboard() {
  const rows = getFilteredRows();

  updateKPI(rows);
  updateCharts(rows);
  renderTable(rows);
}

async function loadDashboard() {
  if (isLoading) return;
  isLoading = true;

  setText("connectionStatus", "Memperbarui...");

  try {
    const response = await fetch(API_URL, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    const result = await response.json();

    if (!result.success || !Array.isArray(result.rows)) {
      throw new Error(result.message || "Format data tidak valid");
    }

    allRows = result.rows;

    setupFilters();
    renderDashboard();

    setText("connectionStatus", "Terhubung");
    setText(
      "updatedAt",
      new Date().toLocaleString("id-ID")
    );

  } catch (error) {
    console.error(error);

    setText("connectionStatus", "Koneksi bermasalah");
    setText("errorMessage", error.message);

  } finally {
    isLoading = false;
  }
}

// Pencarian
document.getElementById("search")
  ?.addEventListener("input", renderDashboard);

// Reset filter
document.getElementById("resetFilters")
  ?.addEventListener("click", () => {
    FILTERS.forEach(column => {
      const select = document.getElementById(
        "filter-" + column
      );
      if (select) select.value = "";
    });

    const search = document.getElementById("search");
    if (search) search.value = "";

    renderDashboard();
  });

// Ambil data pertama kali
loadDashboard();

// Refresh otomatis setiap 1 menit
setInterval(loadDashboard, REFRESH_INTERVAL);
