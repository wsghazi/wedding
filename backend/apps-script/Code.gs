/**
 * Registry claims backend on a Google Sheet.
 * Paste this into Extensions > Apps Script of a new Google Sheet, then
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 * Columns: key | itemId | name | at
 */
const SHEET_NAME = 'claims';

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['key', 'itemId', 'name', 'at']);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function listClaims_() {
  const rows = sheet_().getDataRange().getValues().slice(1);
  const out = {};
  rows.forEach(function (r) {
    if (!r[0] || !r[1]) return;
    (out[r[1]] = out[r[1]] || []).push({ key: String(r[0]), name: String(r[2] || ''), at: Number(r[3]) || 0 });
  });
  return out;
}

function doGet() {
  return json_({ ok: true, claims: listClaims_() });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const id = String(body.id || '').slice(0, 120);
    if (!id) return json_({ ok: false, error: 'missing id' });
    const sh = sheet_();

    if (body.action === 'claim') {
      const key = Utilities.getUuid();
      sh.appendRow([key, id, String(body.name || '').slice(0, 80), Date.now()]);
      return json_({ ok: true, key: key });
    }

    if (body.action === 'unclaim') {
      const values = sh.getDataRange().getValues();
      for (let i = values.length - 1; i >= 1; i--) {
        if (String(values[i][0]) === String(body.key) && String(values[i][1]) === id) {
          sh.deleteRow(i + 1);
          return json_({ ok: true });
        }
      }
      return json_({ ok: false, error: 'not found' });
    }

    return json_({ ok: false, error: 'unknown action' });
  } finally {
    lock.releaseLock();
  }
}
