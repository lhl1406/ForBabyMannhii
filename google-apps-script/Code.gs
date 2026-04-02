/**
 * Phiếu bé ngoan → Google Sheet
 *
 * 1. Mở spreadsheet: https://docs.google.com/spreadsheets/d/1sOvBd6vZInom1XPNnQE6Howl0WBmoWUITdJHqp1lnAQ
 * 2. Extensions → Apps Script → dán toàn bộ file này
 * 3. Đổi SECRET thành chuỗi dài khó đoán (và gõ y hệt trong app)
 * 4. Deploy → New deployment → Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone (để trang web GitHub Pages gọi được)
 * 5. Copy URL Web App (dạng https://script.google.com/macros/s/.../exec) dán vào app
 *
 * Hàng 1 trên sheet: id | at_iso | note (script sẽ tạo nếu trống)
 */
var SHEET_ID = "1sOvBd6vZInom1XPNnQE6Howl0WBmoWUITdJHqp1lnAQ";
var SECRET = "doi-mat-khau-bi-mat-day-du-ky-tu";

function checkSecret_(s) {
  return s === SECRET;
}

function ensureHeader_(sh) {
  if (!sh.getRange("A1").getValue()) {
    sh.getRange("A1:C1").setValues([["id", "at_iso", "note"]]);
    sh.setFrozenRows(1);
  }
}

function doGet(e) {
  var p = e.parameter || {};
  if (!checkSecret_(p.secret || "")) {
    return jsonOut_({ ok: false, error: "auth" });
  }
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheets()[0];
    ensureHeader_(sh);
    var vals = sh.getDataRange().getValues();
    var out = [];
    for (var i = 1; i < vals.length; i++) {
      var row = vals[i];
      if (row[0]) {
        out.push({
          id: String(row[0]),
          at: String(row[1] || ""),
          note: String(row[2] || ""),
        });
      }
    }
    return jsonOut_({ ok: true, items: out });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse(e.postData.contents || "{}");
  } catch (x) {}
  if (!checkSecret_(body.secret || "")) {
    return jsonOut_({ ok: false, error: "auth" });
  }
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheets()[0];
    ensureHeader_(sh);

    if (body.action === "append" && body.entry) {
      var en = body.entry;
      sh.appendRow([en.id, en.at, en.note || ""]);
      return jsonOut_({ ok: true });
    }

    if (body.action === "replace" && body.items) {
      var lr = sh.getLastRow();
      if (lr > 1) {
        sh.deleteRows(2, lr - 1);
      }
      for (var j = 0; j < body.items.length; j++) {
        var it = body.items[j];
        sh.appendRow([it.id, it.at, it.note || ""]);
      }
      return jsonOut_({ ok: true });
    }

    return jsonOut_({ ok: false, error: "bad_action" });
  } catch (err2) {
    return jsonOut_({ ok: false, error: String(err2) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
