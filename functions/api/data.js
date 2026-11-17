
/**
 * =========================================================
 * DASHBOARD JARKONS
 * Backend Google Sheets API
 * Cloudflare Pages Functions
 * =========================================================
 *
 * Endpoint:
 * /api/data
 *
 * Endpoint dengan nama sheet:
 * /api/data?sheet=DATA_GANGGUAN
 *
 * Database:
 * Google Sheets
 *
 * Access:
 * Google Service Account (Read Only)
 */

// =========================================================
// 1. KONFIGURASI SHEET
// =========================================================

const SHEET_CONFIG = {
  DATA_GANGGUAN: {
    range: "'DATA_GANGGUAN'!A1:O",

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
      "Indikasi", 
      "Penyebab",
      "RCT",
      "Detail Penyebab"
    ]
  }
};

const GOOGLE_TOKEN_URL =
  "https://oauth2.googleapis.com/token";

const GOOGLE_SHEETS_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly";

// =========================================================
// 2. CACHE ACCESS TOKEN
// =========================================================

let tokenCache = {
  accessToken: null,
  expiresAt: 0,
  email: null
};

// =========================================================
// 3. FUNGSI BASE64 URL
// =========================================================

function base64UrlEncodeBytes(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlEncodeObject(object) {
  const bytes = new TextEncoder().encode(
    JSON.stringify(object)
  );

  return base64UrlEncodeBytes(bytes);
}

// =========================================================
// 4. MEMBACA PRIVATE KEY
// =========================================================

function convertPrivateKey(pem) {
  const cleanPem = String(pem)
    .replace(/\\n/g, "\n")
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  if (!cleanPem) {
    throw new Error("Private key tidak ditemukan");
  }

  const binary = atob(cleanPem);

  const bytes = Uint8Array.from(
    binary,
    character => character.charCodeAt(0)
  );

  return bytes.buffer;
}

// =========================================================
// 5. GOOGLE SERVICE ACCOUNT AUTHENTICATION
// =========================================================

async function getGoogleAccessToken(serviceAccount) {

  const now = Math.floor(Date.now() / 1000);

  // Gunakan token sebelumnya jika masih berlaku
  if (
    tokenCache.accessToken &&
    tokenCache.expiresAt > now + 60 &&
    tokenCache.email === serviceAccount.client_email
  ) {
    return tokenCache.accessToken;
  }

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const claim = {
    iss: serviceAccount.client_email,

    scope: GOOGLE_SHEETS_SCOPE,

    aud: GOOGLE_TOKEN_URL,

    iat: now,

    exp: now + 3600
  };

  const encodedHeader =
    base64UrlEncodeObject(header);

  const encodedClaim =
    base64UrlEncodeObject(claim);

  const unsignedToken =
    encodedHeader + "." + encodedClaim;

  // Import private key
  const privateKeyData = convertPrivateKey(
    serviceAccount.private_key
  );

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyData,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  // Sign JWT
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signedToken =
    unsignedToken + "." +
    base64UrlEncodeBytes(new Uint8Array(signature));

  // Request Google OAuth token
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",

    headers: {
      "Content-Type":
        "application/x-www-form-urlencoded"
    },

    body: new URLSearchParams({
      grant_type:
        "urn:ietf:params:oauth:grant-type:jwt-bearer",

      assertion: signedToken
    })
  });

  if (!response.ok) {
    console.error(
      "Google OAuth error:",
      response.status,
      (await response.text()).slice(0, 500)
    );

    throw new Error("Google authentication failed");
  }

  const result = await response.json();

  tokenCache = {
    accessToken: result.access_token,

    expiresAt:
      now + Number(result.expires_in || 3600),

    email: serviceAccount.client_email
  };

  return tokenCache.accessToken;
}

// =========================================================
// 6. STANDARD JSON RESPONSE
// =========================================================

function jsonResponse(data, status = 200) {
  return Response.json(data, {
    status,

    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

// =========================================================
// 7. GOOGLE SHEETS DATA READER
// =========================================================

async function readGoogleSheet(
  spreadsheetId,
  range,
  accessToken
) {

  const endpoint =
    "https://sheets.googleapis.com/v4/spreadsheets/" +
    encodeURIComponent(spreadsheetId) +
    "/values/" +
    encodeURIComponent(range) +
    "?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE";

  const response = await fetch(endpoint, {
    method: "GET",

    headers: {
      Authorization: "Bearer " + accessToken
    }
  });

  if (!response.ok) {
    const errorDetails = await response.text();

    console.error(
      "Google Sheets API error:",
      response.status,
      errorDetails.slice(0, 500)
    );

    throw new Error(
      "Google Sheets request failed: HTTP " +
      response.status
    );
  }

  return await response.json();
}

// =========================================================
// 8. HEADER NORMALIZATION
// =========================================================

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase();
}

// =========================================================
// 9. MAIN API ENDPOINT
// =========================================================

export async function onRequestGet({ request, env }) {

  try {

    // -----------------------------------------------------
    // A. CEK KONFIGURASI CLOUDFLARE
    // -----------------------------------------------------

    const spreadsheetId = env.SPREADSHEET_ID;

    const serviceAccountJSON =
      env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (!spreadsheetId) {
      return jsonResponse({
        success: false,
        message: "SPREADSHEET_ID belum dikonfigurasi"
      }, 500);
    }

    if (!serviceAccountJSON) {
      return jsonResponse({
        success: false,
        message:
          "GOOGLE_SERVICE_ACCOUNT_JSON belum dikonfigurasi"
      }, 500);
    }

    // -----------------------------------------------------
    // B. PILIH SHEET
    // -----------------------------------------------------

    const requestURL = new URL(request.url);

    const sheetName = (
      requestURL.searchParams.get("sheet") ||
      "DATA_GANGGUAN"
    ).trim().toUpperCase();

    const configuration = SHEET_CONFIG[sheetName];

    if (!configuration) {
      return jsonResponse({
        success: false,
        message: "Sheet tidak terdaftar",
        allowedSheets: Object.keys(SHEET_CONFIG)
      }, 404);
    }

    // -----------------------------------------------------
    // C. PARSE SERVICE ACCOUNT
    // -----------------------------------------------------

    let serviceAccount;

    try {
      serviceAccount = JSON.parse(serviceAccountJSON);
    } catch {
      throw new Error(
        "Format GOOGLE_SERVICE_ACCOUNT_JSON tidak valid"
      );
    }

    if (
      !serviceAccount.client_email ||
      !serviceAccount.private_key
    ) {
      throw new Error(
        "Service account tidak memiliki client_email atau private_key"
      );
    }

    // -----------------------------------------------------
    // D. AUTENTIKASI GOOGLE
    // -----------------------------------------------------

    const accessToken =
      await getGoogleAccessToken(serviceAccount);

    // -----------------------------------------------------
    // E. AMBIL DATA SPREADSHEET
    // -----------------------------------------------------

    const sheetResult = await readGoogleSheet(
      spreadsheetId,
      configuration.range,
      accessToken
    );

    const values = sheetResult.values || [];

    // -----------------------------------------------------
    // F. CEK DATA KOSONG
    // -----------------------------------------------------

    if (values.length === 0) {
      return jsonResponse({
        success: true,
        sheet: sheetName,
        totalData: 0,
        columns: configuration.columns,
        rows: [],
        fetchedAt: new Date().toISOString()
      });
    }

    // -----------------------------------------------------
    // G. MEMBACA HEADER
    // -----------------------------------------------------

    const headers = values[0].map(value =>
      String(value ?? "").trim().replace(/^\uFEFF/, "")
    );

    const headerIndex = new Map();

    headers.forEach((header, index) => {
      headerIndex.set(normalizeHeader(header), index);
    });

    // Pastikan seluruh kolom tersedia
    const missingColumns = configuration.columns.filter(
      column => !headerIndex.has(normalizeHeader(column))
    );

    if (missingColumns.length > 0) {
      return jsonResponse({
        success: false,
        message: "Header spreadsheet tidak sesuai",
        missingColumns,
        expectedColumns: configuration.columns,
        actualColumns: headers
      }, 422);
    }

    // -----------------------------------------------------
    // H. KONVERSI BARIS MENJADI OBJECT JSON
    // -----------------------------------------------------

    const rows = values.slice(1).map(row => {

      const record = {};

      configuration.columns.forEach(column => {

        const index = headerIndex.get(
          normalizeHeader(column)
        );

        const value = row[index];

        record[column] =
          value === undefined || value === null
            ? ""
            : String(value).trim();

      });

      return record;

    }).filter(record =>
      configuration.columns.some(
        column => record[column] !== ""
      )
    );

    // -----------------------------------------------------
    // I. KIRIM DATA KE DASHBOARD
    // -----------------------------------------------------

    return jsonResponse({

      success: true,

      sheet: sheetName,

      totalData: rows.length,

      columns: configuration.columns,

      rows: rows,

      fetchedAt: new Date().toISOString()

    });

  } catch (error) {

    // -----------------------------------------------------
    // J. ERROR HANDLER
    // -----------------------------------------------------

    console.error(
      "DASHBOARD BACKEND ERROR:",
      error.message
    );

    return jsonResponse({

      success: false,

      message:
        "Gagal mengambil data dari Google Sheets.",

      errorCode: "GOOGLE_SHEETS_FETCH_ERROR"

    }, 500);

  }
}
