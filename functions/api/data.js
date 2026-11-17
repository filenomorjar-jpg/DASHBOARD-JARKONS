
function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function encodeText(value) {
  return base64url(new TextEncoder().encode(value));
}

async function getGoogleToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };

  const unsigned =
    encodeText(JSON.stringify(header)) + "." +
    encodeText(JSON.stringify(claim));

  const pem = serviceAccount.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const keyBytes = Uint8Array.from(
    atob(pem),
    c => c.charCodeAt(0)
  );

  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes.buffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );

  const assertion =
    unsigned + "." + base64url(new Uint8Array(signature));

  const response = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type:
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      })
    }
  );

  if (!response.ok) {
    throw new Error("Google authentication failed");
  }

  const tokenData = await response.json();
  return tokenData.access_token;
}

export async function onRequestGet({ env }) {
  try {
    const spreadsheetId = env.SPREADSHEET_ID;
    const range = env.SHEET_RANGE || "DATA_GANGGUAN!A1:F";

    if (!spreadsheetId || !env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      throw new Error("Server configuration is incomplete");
    }

    const serviceAccount = JSON.parse(
      env.GOOGLE_SERVICE_ACCOUNT_JSON
    );

    const token = await getGoogleToken(serviceAccount);

    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(spreadsheetId) +
      "/values/" +
      encodeURIComponent(range) +
      "?valueRenderOption=FORMATTED_VALUE";

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error("Unable to read spreadsheet");
    }

    const result = await response.json();
    const values = result.values || [];

    if (values.length === 0) {
      return Response.json({
        rows: [],
        updatedAt: new Date().toISOString()
      });
    }

    const headers = values[0].map(h => String(h).trim());

    const rows = values.slice(1).map(row => {
      const item = {};

      headers.forEach((header, index) => {
        item[header] = row[index] ?? "";
      });

      return item;
    });

    return Response.json(
      {
        rows,
        updatedAt: new Date().toISOString()
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff"
        }
      }
    );

  } catch (error) {
    console.error("Dashboard API error:", error);

    return Response.json(
      { error: "Data tidak dapat diambil saat ini." },
      { status: 500 }
    );
  }
}
