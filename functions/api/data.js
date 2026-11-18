
// =====================================================
// DASHBOARD JARKONS - GOOGLE SHEETS API
// Cloudflare Pages Functions
// =====================================================

// Daftar Sheet yang diizinkan beserta rentang datanya
const ALLOWED_SHEETS = {
  DATA_GANGGUAN: "'DATA_GANGGUAN'!A1:O",
  columns: [
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
      "Indikasi Penyebab",
      "RCT",
      "Detail Penyebab"
    ]
  DATA_KINERJA: "'DATA_KINERJA'!A1:H"
};

// -----------------------------------------------------
// RESPONSE JSON
// -----------------------------------------------------
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate"
    }
  });
}

// -----------------------------------------------------
// BASE64 URL ENCODING
// -----------------------------------------------------
function base64UrlEncode(input) {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input;

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// -----------------------------------------------------
// GOOGLE SERVICE ACCOUNT AUTHENTICATION
// -----------------------------------------------------
async function getGoogleAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };

  const unsignedToken =
    base64UrlEncode(JSON.stringify(header)) + "." +
    base64UrlEncode(JSON.stringify(payload));

  const privateKeyPem = serviceAccount.private_key
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const privateKeyBytes = Uint8Array.from(
    atob(privateKeyPem),
    c => c.charCodeAt(0)
  );

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  const jwt = unsignedToken + "." + base64UrlEncode(
    new Uint8Array(signature)
  );

  const tokenResponse = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type:
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt
      })
    }
  );

  if (!tokenResponse.ok) {
    throw new Error("Google authentication failed");
  }

  const tokenData = await tokenResponse.json();

  return tokenData.access_token;
}

// -----------------------------------------------------
// READ GOOGLE SHEETS
// -----------------------------------------------------
async function getSheetData(env, sheetName) {
  const serviceAccount = JSON.parse(
    env.GOOGLE_SERVICE_ACCOUNT_JSON
  );

  const accessToken = await getGoogleAccessToken(
    serviceAccount
  );

  const range = ALLOWED_SHEETS[sheetName];

  const url =
    "https://sheets.googleapis.com/v4/spreadsheets/" +
    encodeURIComponent(env.SPREADSHEET_ID) +
    "/values/" +
    encodeURIComponent(range) +
    "?valueRenderOption=UNFORMATTED_VALUE";

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Google Sheets API request failed");
  }

  const result = await response.json();
  const values = result.values || [];

  if (values.length === 0) {
    return {
      columns: [],
      rows: [],
      records: []
    };
  }

  const columns = values[0].map(
    header => String(header).trim()
  );

  const rows = values.slice(1).filter(row =>
    row.some(value => value !== "" && value !== null)
  );

  // Format objek agar mudah digunakan halaman baru
  const records = rows.map(row => {
    const record = {};

    columns.forEach((column, index) => {
      record[column] = row[index] ?? "";
    });

    return record;
  });

  return {
    columns,
    rows,
    records
  };
}

// -----------------------------------------------------
// MAIN API HANDLER
// URL: /api/data?sheet=DATA_GANGGUAN
// URL: /api/data?sheet=DATA_KINERJA
// -----------------------------------------------------
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);

    const sheetName = url.searchParams.get("sheet");

    // Validasi nama Sheet
    if (!sheetName || !ALLOWED_SHEETS[sheetName]) {
      return jsonResponse({
        success: false,
        error: "Nama Sheet tidak valid",
        allowedSheets: Object.keys(ALLOWED_SHEETS)
      }, 400);
    }

    // Validasi environment variables
    if (
      !env.SPREADSHEET_ID ||
      !env.GOOGLE_SERVICE_ACCOUNT_JSON
    ) {
      throw new Error("Cloudflare environment not configured");
    }

    const data = await getSheetData(env, sheetName);

    return jsonResponse({
      success: true,
      sheet: sheetName,
      totalData: data.rows.length,
      columns: data.columns,
      rows: data.rows,
      records: data.records,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error("Dashboard Jarkons API Error:", error);

    return jsonResponse({
      success: false,
      error: "Data tidak dapat diambil saat ini."
    }, 500);
  }
}
