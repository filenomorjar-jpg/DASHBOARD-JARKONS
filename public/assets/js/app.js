
const API_URL = "/api/data";
const UPDATE_INTERVAL = 60 * 1000;

async function loadDashboard() {
  const message = document.getElementById("message");

  try {
    message.textContent = "Memperbarui data...";

    const response = await fetch(API_URL, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Gagal mengambil data");
    }

    const result = await response.json();
    const rows = result.rows;

    // Hitung status
    const selesai = rows.filter(
      x => x.Status === "Selesai"
    ).length;

    const proses = rows.filter(
      x => x.Status === "Proses"
    ).length;

    const belum = rows.filter(
      x => x.Status === "Belum"
    ).length;

    // Tampilkan KPI
    document.getElementById("total").textContent =
      rows.length;

    document.getElementById("selesai").textContent =
      selesai;

    document.getElementById("proses").textContent =
      proses;

    document.getElementById("belum").textContent =
      belum;

    // Simpan waktu pembaruan
    document.getElementById("updated").textContent =
      "Update: " +
      new Date(result.updatedAt).toLocaleString("id-ID");

    // Tampilkan tabel
    const body = document.getElementById("dataBody");

    body.innerHTML = rows.map(row => `
      <tr>
        <td>${escapeHTML(row.Tanggal)}</td>
        <td>${escapeHTML(row.ULP)}</td>
        <td>${escapeHTML(row.Penyulang)}</td>
        <td>${escapeHTML(row.Status)}</td>
      </tr>
    `).join("");

    message.textContent = "Data berhasil diperbarui.";

  } catch (error) {
    message.textContent = "Gagal memperbarui: " + error.message;
  }
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

// Update pertama
loadDashboard();

// Update selanjutnya setiap 1 menit
setInterval(loadDashboard, UPDATE_INTERVAL);

