import * as XLSX from "xlsx";

const MONTHS_DE = [
  "januar", "februar", "märz", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "dezember",
];

// Wandelt eine Zelle in eine Zahl um — akzeptiert echte Zahlen genauso wie
// Text-Zellen im Format "1.234,56" oder "1234,56".
function parseNumericCell(val) {
  if (typeof val === "number" && !Number.isNaN(val)) return val;
  if (typeof val === "string") {
    let s = val.trim().replace(/[€$]/g, "").replace(/\s/g, "");
    if (!s) return null;
    if (s.includes(",") && s.includes(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (s.includes(",")) {
      s = s.replace(",", ".");
    }
    const num = parseFloat(s);
    return Number.isNaN(num) ? null : num;
  }
  return null;
}

function rowsFromCsvText(text) {
  const firstLine = text.split(/\r?\n/)[0] || "";
  // Deutsche CSV-Exporte nutzen meist Semikolon statt Komma als Trennzeichen.
  const delimiter = firstLine.includes(";") ? ";" : ",";
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(delimiter).map((cell) => cell.trim()));
}

async function readFileAsRows(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv")) {
    const buf = await file.arrayBuffer();
    // Deutsche Excel-CSV-Exporte sind wegen Umlauten oft Windows-1252 statt
    // UTF-8 kodiert — das berücksichtigen wir hier, statt blind UTF-8 anzunehmen.
    let text;
    try {
      text = new TextDecoder("windows-1252").decode(buf);
    } catch {
      text = new TextDecoder("utf-8").decode(buf);
    }
    return rowsFromCsvText(text);
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
}

/**
 * Liest eine SCFI-Datei (CSV oder Excel) im Format
 *   Monat;2023;2024;2025;2026
 *   Januar;1026;2912;2536;1694
 *   Februar;938;2678;1871;1422
 *   ...
 * und liefert eine flache Liste von { month: "YYYY-MM", value: number } für
 * alle tatsächlich befüllten Zellen. Leere Zellen werden übersprungen — es
 * wird nichts erfunden, interpoliert oder aus einem anderen Monat übernommen.
 */
export async function parseScfiFile(file) {
  const rows = await readFileAsRows(file);
  if (!rows || rows.length < 2) {
    throw new Error("Die Datei enthält keine erkennbaren Daten.");
  }

  const header = rows[0].map((c) => (c ?? "").toString().trim());
  const yearColumns = [];
  header.forEach((cell, colIdx) => {
    if (colIdx === 0) return;
    const m = cell.match(/^(20\d{2})$/);
    if (m) yearColumns.push({ colIdx, year: m[1] });
  });

  if (yearColumns.length === 0) {
    throw new Error(
      'In der ersten Zeile konnte keine Jahreszahl (z.B. 2023, 2024, ...) gefunden werden. Erwartetes Format: "Monat;2023;2024;2025;2026" in Zeile 1.'
    );
  }

  const results = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const monthLabel = (row[0] ?? "").toString().trim().toLowerCase();
    const monthIdx = MONTHS_DE.indexOf(monthLabel);
    if (monthIdx < 0) continue; // Zeile ohne erkennbaren deutschen Monatsnamen -> überspringen

    yearColumns.forEach(({ colIdx, year }) => {
      const value = parseNumericCell(row[colIdx]);
      if (value === null) return; // Zelle leer/nicht auswertbar -> bewusst kein Wert erzeugen
      results.push({ month: `${year}-${String(monthIdx + 1).padStart(2, "0")}`, value });
    });
  }

  if (results.length === 0) {
    throw new Error("Es konnten keine gültigen SCFI-Werte aus der Datei gelesen werden. Bitte Format prüfen.");
  }

  return results;
}
