import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Upload, Trash2, Save, X, Loader2, AlertCircle, CheckCircle2, ChevronDown, Anchor, RefreshCw } from "lucide-react";
import { loadAllData, saveBatchesToSupabase, deleteUploadFromSupabase } from "./api/freightData.js";
import { isSupabaseConfigured } from "./supabaseClient.js";

/* ---------------------------------------------------------------------- */
/* Constants                                                               */
/* ---------------------------------------------------------------------- */

const MONTHS_DE = ["januar","februar","märz","april","mai","juni","juli","august","september","oktober","november","dezember"];
const MONTH_LABELS = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
const MONTH_RE = /(januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)\.?\s*(\d{2,4})?/i;

// Wählbare Jahre im Dashboard. "DEFAULT_YEAR" greift nur, solange noch keine
// Daten geladen sind — danach wird automatisch das neueste vorhandene Jahr gewählt.
const YEAR_OPTIONS = ["2023", "2024", "2025", "2026"];
const DEFAULT_YEAR = "2026";

const SIZE_LABELS = { "20": "20'", "40": "40'", "40HC": "40' HC" };
const SIZE_ORDER = ["20", "40", "40HC"];
const DEFAULT_SIZE = "40";

const SPEDITEUR_COLORS = {
  "Dörrenhaus": "#6FA8DC",
  "DSV": "#E8804C",
  "DSV-Premium": "#B0B0B0",
  "NTG": "#F2C230",
  "Logwin": "#4FC7E0",
};
const FALLBACK_COLORS = ["#8E7CC3", "#93C47D", "#E06666", "#76A5AF", "#C27BA0"];

/* ---------------------------------------------------------------------- */
/* Parsing helpers                                                        */
/* ---------------------------------------------------------------------- */

function normalizeSpediteur(raw) {
  const s = (raw || "").toLowerCase();
  if (s.includes("dörrenhaus") || s.includes("doerrenhaus")) return "Dörrenhaus";
  if (s.includes("dsv") && s.includes("premium")) return "DSV-Premium";
  if (s.includes("dsv")) return "DSV";
  if (s.includes("logwin")) return "Logwin";
  if (s.includes("ntg")) return "NTG";
  const trimmed = (raw || "").trim();
  return trimmed || "Unbekannt";
}

// Erkennt, ob eine Zelle eine Containergrößen-Spaltenüberschrift ist, z.B.
// "20' Container", "40' Container", "40' HC Container", "40'HC-Container" ...
function detectSizeKey(cell) {
  const s = (cell ?? "").toString().trim().toLowerCase();
  if (!s || !s.includes("container")) return null;
  if (s.includes("40") && s.includes("hc")) return "40HC";
  if (s.includes("20")) return "20";
  if (s.includes("40")) return "40";
  return null;
}

function extractRouteRaw(sheetName) {
  let route = sheetName;
  for (const m of MONTHS_DE) {
    route = route.replace(new RegExp(m, "i"), "");
  }
  route = route.replace(/\b\d{2,4}\b/g, "");
  route = route.replace(/\s+/g, " ").trim();
  return route || sheetName.trim();
}

function guessMonthYear(sheetNames, fallbackYear) {
  const counts = {};
  sheetNames.forEach((name) => {
    const m = name.match(MONTH_RE);
    if (!m) return;
    const idx = MONTHS_DE.indexOf(m[1].toLowerCase());
    if (idx < 0) return;
    let year = m[2] ? parseInt(m[2], 10) : null;
    if (year === null) year = parseInt(fallbackYear, 10);
    if (year < 100) year += 2000;
    const key = `${year}-${String(idx + 1).padStart(2, "0")}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  let best = null, bestCount = 0;
  Object.entries(counts).forEach(([k, c]) => { if (c > bestCount) { best = k; bestCount = c; } });
  return best;
}

// Wandelt eine Zelle in eine Zahl um — akzeptiert echte Zahlen genauso wie
// Text-Zellen im Format "$4.147,00" oder "4.147,00 €".
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

function isBlankRow(row) {
  return row.every((c) => c === undefined || c === null || c.toString().trim() === "");
}

// Findet je Spediteur-Block alle vorhandenen Containergrößen-Spalten und mittelt
// die Preise je Größe über alle darunter gelisteten Reedereien.
function parseSheetBlocks(rows) {
  const blocks = [];
  let i = 0;
  const n = rows.length;
  while (i < n) {
    const row = rows[i] || [];
    const sizeCols = {}; // sizeKey -> columnIndex
    row.forEach((cell, idx) => {
      const key = detectSizeKey(cell);
      if (key && sizeCols[key] === undefined) sizeCols[key] = idx;
    });

    if (Object.keys(sizeCols).length > 0) {
      const spediteurRaw = (row[0] ?? "").toString().trim();
      const priceLists = {};
      Object.keys(sizeCols).forEach((k) => { priceLists[k] = []; });

      let j = i + 1;
      let advancedPastBlank = false;
      while (j < n) {
        const r = rows[j] || [];
        const isHeaderRow = r.some((cell) => detectSizeKey(cell));
        const a = (r[0] ?? "").toString().trim().toLowerCase();
        if (isHeaderRow) break;
        if (a.includes("zusatzkosten") || a.includes("extrakosten") || a === "total" || a.includes("tailwind") || a.includes("charges")) break;
        if (isBlankRow(r)) { j++; advancedPastBlank = true; break; }
        Object.entries(sizeCols).forEach(([k, colIdx]) => {
          const val = parseNumericCell(r[colIdx]);
          if (val !== null) priceLists[k].push(val);
        });
        j++;
      }

      const sizesAvg = {};
      Object.entries(priceLists).forEach(([k, prices]) => {
        if (prices.length > 0) {
          const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
          sizesAvg[k] = { avg: Math.round(avg * 100) / 100, count: prices.length };
        }
      });

      if (Object.keys(sizesAvg).length > 0) {
        blocks.push({ spediteurRaw, spediteur: normalizeSpediteur(spediteurRaw), sizes: sizesAvg });
      }
      i = advancedPastBlank ? j : j;
    } else {
      i++;
    }
  }
  return blocks;
}

function parseWorkbook(workbook, fallbackYear) {
  const sheetNames = workbook.SheetNames.filter((n) => !/lcl/i.test(n));
  const guessedMonth = guessMonthYear(sheetNames, fallbackYear);
  const routeCandidates = [];
  sheetNames.forEach((name) => {
    const ws = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const blocks = parseSheetBlocks(rows);
    const routeRaw = extractRouteRaw(name);
    blocks.forEach((b) => {
      Object.entries(b.sizes).forEach(([sizeKey, info]) => {
        routeCandidates.push({
          routeRaw,
          sheetName: name,
          spediteurRaw: b.spediteurRaw,
          spediteur: b.spediteur,
          size: sizeKey,
          price: info.avg,
          sourceCount: info.count,
        });
      });
    });
  });
  return { guessedMonth, routeCandidates };
}

/* ---------------------------------------------------------------------- */
/* Small UI atoms                                                         */
/* ---------------------------------------------------------------------- */

function Spinner({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9fb3c8" }}>
      <Loader2 size={16} className="spin" />
      <span style={{ fontSize: 13 }}>{label}</span>
    </div>
  );
}

function InfoHint({ children }) {
  return (
    <div style={styles.infoHint}>
      <span style={{ fontWeight: 700 }}>ⓘ</span>
      <span>{children}</span>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Main component                                                         */
/* ---------------------------------------------------------------------- */

export default function FrachtratenDashboard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dbError, setDbError] = useState(null); // Fehler beim initialen Laden aus Supabase
  const [toast, setToast] = useState(null);

  const [entries, setEntries] = useState([]); // {id, uploadId, route, spediteur, size, month, price}
  const [uploads, setUploads] = useState([]); // {id, filename, month, addedAt}
  const [routeMapping, setRouteMapping] = useState({}); // routeRaw -> display name

  const [pendingBatches, setPendingBatches] = useState([]); // review queue before saving
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [selectedYear, setSelectedYear] = useState(DEFAULT_YEAR);
  const [selectedSize, setSelectedSize] = useState(DEFAULT_SIZE);
  const [showManage, setShowManage] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const fileInputRef = useRef(null);

  /* ---- gemeinsamen Datenstand aus Supabase laden ---- */
  const loadFromSupabase = useCallback(async () => {
    setLoading(true);
    setDbError(null);
    try {
      const data = await loadAllData();
      setEntries(data.entries);
      setUploads(data.uploads);
      setRouteMapping(data.routeMapping);

      // Standardmäßig das neueste vorhandene Jahr auswählen (Fallback: DEFAULT_YEAR).
      const yearsPresent = Array.from(new Set(data.entries.map((e) => e.month.slice(0, 4))));
      const newestYear = yearsPresent.filter((y) => YEAR_OPTIONS.includes(y)).sort().slice(-1)[0];
      if (newestYear) setSelectedYear(newestYear);
    } catch (e) {
      setDbError(
        e?.message || "Die gemeinsamen Daten konnten nicht geladen werden. Bitte Internetverbindung prüfen und erneut versuchen."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFromSupabase();
  }, [loadFromSupabase]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3200);
      return () => clearTimeout(t);
    }
  }, [toast]);

  /* ---- derive routes available ---- */
  const routes = useMemo(() => {
    const set = new Set(entries.map((e) => e.route));
    return Array.from(set).sort();
  }, [entries]);

  useEffect(() => {
    if (!selectedRoute && routes.length > 0) setSelectedRoute(routes[0]);
    if (selectedRoute && !routes.includes(selectedRoute) && routes.length > 0) setSelectedRoute(routes[0]);
  }, [routes, selectedRoute]);

  /* ---- welche Containergrößen kommen für die gewählte Route + das gewählte Jahr vor? ---- */
  const sizesForRoute = useMemo(() => {
    const set = new Set(
      entries
        .filter((e) => e.route === selectedRoute && e.month.slice(0, 4) === selectedYear)
        .map((e) => e.size || DEFAULT_SIZE)
    );
    return SIZE_ORDER.filter((s) => set.has(s));
  }, [entries, selectedRoute, selectedYear]);

  useEffect(() => {
    if (sizesForRoute.length > 0 && !sizesForRoute.includes(selectedSize)) {
      setSelectedSize(sizesForRoute[0]);
    }
  }, [sizesForRoute, selectedSize]);

  /* ---- chart data: Werte je Route + Containergröße + Jahr, gruppiert nach
         Kalendermonat; Jahre werden NIE miteinander vermischt (Jan 2023 bleibt
         getrennt von Jan 2024). Linien überspringen Monate ohne Daten
         automatisch (connectNulls) ---- */
  const { chartData, spediteure } = useMemo(() => {
    if (!selectedRoute) return { chartData: [], spediteure: [] };
    const relevant = entries.filter(
      (e) =>
        e.route === selectedRoute &&
        (e.size || DEFAULT_SIZE) === selectedSize &&
        e.month.slice(0, 4) === selectedYear
    );
    const spedSet = Array.from(new Set(relevant.map((e) => e.spediteur)));
    const data = [];
    for (let m = 0; m < 12; m++) {
      const monthNum = String(m + 1).padStart(2, "0");
      const point = { month: MONTH_LABELS[m] };
      spedSet.forEach((sp) => {
        const vals = relevant
          .filter((e) => e.month && e.month.slice(5, 7) === monthNum && e.spediteur === sp)
          .map((e) => e.price);
        point[sp] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
      });
      data.push(point);
    }
    return { chartData: data, spediteure: spedSet };
  }, [entries, selectedRoute, selectedSize, selectedYear]);

  /* ---- file handling ---- */
  const handleFiles = async (fileList) => {
    setError(null);
    const files = Array.from(fileList).filter((f) => /\.(xlsx|xlsm)$/i.test(f.name));
    if (files.length === 0) {
      setError("Bitte eine Excel-Datei (.xlsx) auswählen.");
      return;
    }
    const newBatches = [];
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const { guessedMonth, routeCandidates } = parseWorkbook(wb, selectedYear);
        if (routeCandidates.length === 0) {
          setError(`In "${file.name}" konnten keine Container-Preise erkannt werden. Bitte Struktur prüfen.`);
          continue;
        }
        newBatches.push({
          batchId: crypto.randomUUID(),
          filename: file.name,
          month: guessedMonth || "",
          items: routeCandidates.map((c) => ({
            id: crypto.randomUUID(),
            routeRaw: c.routeRaw,
            route: routeMapping[c.routeRaw] || c.routeRaw,
            spediteur: c.spediteur,
            size: c.size,
            price: c.price,
            sourceCount: c.sourceCount,
            include: true,
          })),
        });
      } catch (e) {
        setError(`"${file.name}" konnte nicht gelesen werden. Ist es eine gültige Excel-Datei?`);
      }
    }
    setPendingBatches((prev) => [...prev, ...newBatches]);
  };

  const updateBatchMonth = (batchId, month) => {
    setPendingBatches((prev) => prev.map((b) => (b.batchId === batchId ? { ...b, month } : b)));
  };

  const updateItem = (batchId, itemId, patch) => {
    setPendingBatches((prev) =>
      prev.map((b) =>
        b.batchId !== batchId
          ? b
          : { ...b, items: b.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }
      )
    );
  };

  const removeBatch = (batchId) => {
    setPendingBatches((prev) => prev.filter((b) => b.batchId !== batchId));
  };

  const canSaveAll = pendingBatches.length > 0 && pendingBatches.every((b) => /^\d{4}-\d{2}$/.test(b.month));

  const saveAll = async () => {
    if (!canSaveAll) {
      setError("Bitte für jede Datei einen Monat angeben, bevor gespeichert wird.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { createdUploads, createdEntries, mappingUpdates } = await saveBatchesToSupabase(pendingBatches);
      setEntries((prev) => [...prev, ...createdEntries]);
      setUploads((prev) => [...prev, ...createdUploads]);
      setRouteMapping((prev) => ({ ...prev, ...mappingUpdates }));
      setPendingBatches([]);
      setToast(`${createdEntries.length} Werte aus ${createdUploads.length} Datei(en) gespeichert — für alle sichtbar.`);
    } catch (e) {
      setError(
        "Speichern in der gemeinsamen Datenbank ist fehlgeschlagen: " + (e?.message || "Unbekannter Fehler.")
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteUpload = async (uploadId) => {
    setSaving(true);
    setError(null);
    try {
      await deleteUploadFromSupabase(uploadId);
      setEntries((prev) => prev.filter((e) => e.uploadId !== uploadId));
      setUploads((prev) => prev.filter((u) => u.id !== uploadId));
      setToast("Datei-Import entfernt — für alle Benutzer gelöscht.");
    } catch (e) {
      setError("Löschen ist fehlgeschlagen: " + (e?.message || "Unbekannter Fehler."));
    } finally {
      setSaving(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  /* ---------------------------------------------------------------------- */

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={{ ...styles.card, display: "flex", justifyContent: "center", padding: 40 }}>
          <Spinner label="Lade gemeinsame Daten…" />
        </div>
        <style>{css}</style>
      </div>
    );
  }

  if (dbError) {
    return (
      <div style={styles.page}>
        <div style={{ ...styles.card, gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={styles.logoBadge}><Anchor size={18} color="#0c1b26" /></div>
            <div>
              <div style={styles.title}>Frachtraten Dashboard</div>
              <div style={styles.subtitle}>Container · Frachtraten je Route, Größe &amp; Spediteur</div>
            </div>
          </div>
          <div style={styles.errorBox}>
            <AlertCircle size={16} />
            <span style={{ flex: 1, fontSize: 13 }}>
              {isSupabaseConfigured
                ? "Die Verbindung zur gemeinsamen Datenbank ist fehlgeschlagen."
                : "Die gemeinsame Datenbank ist noch nicht eingerichtet."}
              {" "}{dbError}
            </span>
          </div>
          {!isSupabaseConfigured && (
            <div style={{ fontSize: 12.5, color: "#9fb3c8", lineHeight: 1.6 }}>
              Es fehlen die Supabase-Zugangsdaten. Bitte in der Datei <code>.env</code> die Werte
              <code> VITE_SUPABASE_URL</code> und <code>VITE_SUPABASE_ANON_KEY</code> eintragen
              (siehe <code>.env.example</code>) und die Seite danach neu bauen bzw. den Dev-Server neu starten.
            </div>
          )}
          <button onClick={loadFromSupabase} style={styles.primaryBtn}>
            <RefreshCw size={15} /> Erneut versuchen
          </button>
        </div>
        <style>{css}</style>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <style>{css}</style>

      <div style={styles.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={styles.logoBadge}><Anchor size={18} color="#0c1b26" /></div>
          <div>
            <div style={styles.title}>Frachtraten Dashboard</div>
            <div style={styles.subtitle}>Container · Frachtraten je Route, Größe &amp; Spediteur</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {saving && <Spinner label="Speichere…" />}
          <button onClick={() => setShowHelp((s) => !s)} style={styles.helpBtn}>
            {showHelp ? "Hilfe ausblenden" : "Wie funktioniert das?"}
          </button>
        </div>
      </div>

      {showHelp && (
        <div style={styles.helpCard}>
          <div style={styles.helpTitle}>So funktioniert das Dashboard</div>
          <ol style={styles.helpList}>
            <li>
              <b>Excel-Datei hochladen:</b> Ziehe deine monatliche Datei (1. oder 2. Monatshälfte)
              in das Feld unten oder klicke, um sie auszuwählen. Es können auch mehrere Dateien
              gleichzeitig hochgeladen werden.
            </li>
            <li>
              <b>Prüfen:</b> Das Tool erkennt automatisch Route, Spediteur, Containergröße (20',
              40', 40' HC), Monat und den durchschnittlichen Preis je Reederei. Vor dem Speichern
              kannst du alles in der Tabelle "Prüfen vor dem Speichern" korrigieren oder einzelne
              Zeilen ausschließen.
            </li>
            <li>
              <b>Übernehmen:</b> Mit "Daten übernehmen" werden die Werte dauerhaft gespeichert und
              erscheinen sofort im Diagramm.
            </li>
            <li>
              <b>Containergröße wählen:</b> Über die Schaltflächen "20' / 40' / 40' HC" oberhalb
              des Diagramms zwischen den Größen wechseln — die Preise unterscheiden sich je Größe.
            </li>
            <li>
              <b>Diagramm lesen:</b> Jede Linie ist ein Spediteur, jeder Punkt ein Monat des oben
              ausgewählten Jahres.
              Fehlt für einen Monat noch eine Datei, überspringt die Linie die Lücke und verbindet
              sich mit dem nächsten vorhandenen Monat — es entstehen also keine Brüche.
            </li>
            <li>
              <b>Route wechseln:</b> Über die Reiter oberhalb des Diagramms zwischen den Routen
              (z. B. CN-Mainports, Bangladesch) wechseln.
            </li>
            <li>
              <b>Importe verwalten:</b> Unten im Bereich "Importierte Dateien verwalten" siehst du,
              welche Datei welchen Monat geliefert hat, und kannst einen Import bei Bedarf wieder
              löschen.
            </li>
          </ol>
        </div>
      )}

      {error && (
        <div style={styles.errorBox}>
          <AlertCircle size={16} />
          <span style={{ flex: 1, fontSize: 13 }}>{error}</span>
          <button onClick={() => setError(null)} style={styles.iconBtn}><X size={14} /></button>
        </div>
      )}

      {/* Upload zone */}
      <div
        style={styles.dropzone}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload size={20} color="#6FA8DC" />
        <div style={{ fontSize: 13.5, color: "#cfe0ee" }}>
          Excel-Datei(en) hierher ziehen oder <span style={{ color: "#6FA8DC", textDecoration: "underline" }}>auswählen</span>
        </div>
        <div style={{ fontSize: 11.5, color: "#6c8299" }}>.xlsx · mehrere Dateien gleichzeitig möglich</div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xlsm"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {/* Review queue */}
      {pendingBatches.length > 0 && (
        <div style={styles.card}>
          <div style={styles.cardHeader}>Prüfen vor dem Speichern</div>
          {pendingBatches.map((b) => (
            <div key={b.batchId} style={styles.batchBlock}>
              <div style={styles.batchHeaderRow}>
                <div style={{ fontSize: 13.5, color: "#e7eef5", fontWeight: 600 }}>{b.filename}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ fontSize: 12, color: "#9fb3c8" }}>Monat:</label>
                  <input
                    type="month"
                    value={b.month}
                    onChange={(e) => updateBatchMonth(b.batchId, e.target.value)}
                    style={styles.monthInput}
                  />
                  <button onClick={() => removeBatch(b.batchId)} style={styles.iconBtn} title="Entfernen">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {!b.month && (
                <div style={{ fontSize: 11.5, color: "#e0a45c", marginBottom: 6 }}>
                  Monat konnte nicht automatisch erkannt werden — bitte manuell wählen.
                </div>
              )}
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Route</th>
                    <th style={styles.th}>Spediteur</th>
                    <th style={styles.th}>Größe</th>
                    <th style={styles.th}>Ø Preis (USD)</th>
                    <th style={styles.th}>Basis</th>
                    <th style={styles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {b.items.map((it) => (
                    <tr key={it.id} style={{ opacity: it.include ? 1 : 0.4 }}>
                      <td style={styles.td}>
                        <input
                          value={it.route}
                          onChange={(e) => updateItem(b.batchId, it.id, { route: e.target.value })}
                          style={styles.textInput}
                        />
                      </td>
                      <td style={styles.td}>
                        <span style={{ ...styles.tag, background: (SPEDITEUR_COLORS[it.spediteur] || "#888") + "33", color: SPEDITEUR_COLORS[it.spediteur] || "#ccc" }}>
                          {it.spediteur}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <span style={styles.sizeTag}>{SIZE_LABELS[it.size] || it.size}</span>
                      </td>
                      <td style={styles.td}>
                        <input
                          type="number"
                          value={it.price}
                          onChange={(e) => updateItem(b.batchId, it.id, { price: e.target.value })}
                          style={{ ...styles.textInput, width: 90, fontFamily: "monospace" }}
                        />
                      </td>
                      <td style={{ ...styles.td, fontSize: 11.5, color: "#7d92a6" }}>
                        {it.sourceCount} Reederei{it.sourceCount > 1 ? "en" : ""}
                      </td>
                      <td style={styles.td}>
                        <button
                          onClick={() => updateItem(b.batchId, it.id, { include: !it.include })}
                          style={styles.iconBtn}
                          title={it.include ? "Ausschließen" : "Einschließen"}
                        >
                          {it.include ? <X size={14} /> : <CheckCircle2 size={14} />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <button onClick={saveAll} disabled={!canSaveAll} style={{ ...styles.primaryBtn, opacity: canSaveAll ? 1 : 0.5 }}>
            <Save size={15} /> Daten übernehmen
          </button>
        </div>
      )}

      {/* Dashboard */}
      {routes.length === 0 ? (
        <div style={{ ...styles.card, textAlign: "center", padding: 40, color: "#7d92a6", fontSize: 13.5 }}>
          Noch keine Daten vorhanden. Lade oben deine erste Excel-Datei hoch.
        </div>
      ) : (
        <div style={styles.card}>
          <div style={styles.sizeRow}>
            <span style={styles.sizeRowLabel}>Jahr:</span>
            {YEAR_OPTIONS.map((y) => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                style={{ ...styles.sizePill, ...(y === selectedYear ? styles.sizePillActive : {}) }}
              >
                {y}
              </button>
            ))}
          </div>

          <div style={styles.tabRow}>
            {routes.map((r) => (
              <button
                key={r}
                onClick={() => setSelectedRoute(r)}
                style={{ ...styles.tab, ...(r === selectedRoute ? styles.tabActive : {}) }}
              >
                {r}
              </button>
            ))}
          </div>

          <div style={styles.sizeRow}>
            <span style={styles.sizeRowLabel}>Containergröße:</span>
            {SIZE_ORDER.map((s) => {
              const available = sizesForRoute.includes(s);
              return (
                <button
                  key={s}
                  onClick={() => available && setSelectedSize(s)}
                  disabled={!available}
                  title={available ? undefined : "Für diese Route/dieses Jahr keine Daten vorhanden"}
                  style={{
                    ...styles.sizePill,
                    ...(s === selectedSize ? styles.sizePillActive : {}),
                    ...(available ? {} : styles.sizePillDisabled),
                  }}
                >
                  {SIZE_LABELS[s]}
                </button>
              );
            })}
          </div>

          <div style={styles.chartTitleRow}>
            <div style={styles.chartTitle}>{selectedYear} · {SIZE_LABELS[selectedSize]} Container</div>
            <div style={styles.chartSubtitle}>{selectedRoute}</div>
          </div>

          <InfoHint>
            Fehlende Monate werden übersprungen — jede Linie verbindet sich automatisch mit dem
            nächsten Monat, für den bereits Daten vorliegen. Preise gelten je Containergröße.
          </InfoHint>

          <div style={{ width: "100%", height: 340 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#223244" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" stroke="#7d92a6" tick={{ fontSize: 12 }} axisLine={{ stroke: "#2b3d50" }} tickLine={false} />
                <YAxis
                  stroke="#7d92a6"
                  tick={{ fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v.toLocaleString("de-DE")} USD`}
                  width={90}
                />
                <Tooltip
                  contentStyle={{ background: "#122335", border: "1px solid #2b3d50", borderRadius: 8, fontSize: 12.5 }}
                  labelStyle={{ color: "#e7eef5" }}
                  formatter={(v) => (v == null ? "—" : `${v.toLocaleString("de-DE")} USD`)}
                />
                <Legend wrapperStyle={{ fontSize: 12.5, color: "#cfe0ee" }} />
                {spediteure.map((sp, idx) => (
                  <Line
                    key={sp}
                    type="monotone"
                    dataKey={sp}
                    stroke={SPEDITEUR_COLORS[sp] || FALLBACK_COLORS[idx % FALLBACK_COLORS.length]}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Manage imports */}
      {uploads.length > 0 && (
        <div style={styles.card}>
          <button onClick={() => setShowManage((s) => !s)} style={styles.manageToggle}>
            <span>Importierte Dateien verwalten ({uploads.length})</span>
            <ChevronDown size={16} style={{ transform: showManage ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
          </button>
          {showManage && (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Datei</th>
                  <th style={styles.th}>Monat</th>
                  <th style={styles.th}>Hinzugefügt</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {[...uploads].reverse().map((u) => (
                  <tr key={u.id}>
                    <td style={styles.td}>{u.filename}</td>
                    <td style={styles.td}>{u.month}</td>
                    <td style={{ ...styles.td, fontSize: 11.5, color: "#7d92a6" }}>
                      {new Date(u.addedAt).toLocaleDateString("de-DE")}
                    </td>
                    <td style={styles.td}>
                      <button onClick={() => deleteUpload(u.id)} style={styles.iconBtn} title="Import löschen">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {toast && (
        <div style={styles.toast}>
          <CheckCircle2 size={16} color="#7bd88f" />
          <span style={{ fontSize: 13 }}>{toast}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Styles                                                                  */
/* ---------------------------------------------------------------------- */

const styles = {
  page: {
    background: "#0b1622",
    minHeight: "100%",
    padding: 20,
    fontFamily: "'Inter', system-ui, sans-serif",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    color: "#e7eef5",
  },
  headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  logoBadge: {
    width: 32, height: 32, borderRadius: 8, background: "#6FA8DC",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 17, fontWeight: 700, letterSpacing: -0.2 },
  subtitle: { fontSize: 12, color: "#7d92a6", marginTop: 1 },
  helpBtn: {
    background: "#132840", border: "1px solid #2b4054", color: "#9fc4e8",
    borderRadius: 8, padding: "6px 12px", fontSize: 12.5, cursor: "pointer", fontWeight: 600,
  },
  helpCard: {
    background: "#0e1f30", border: "1px solid #244a68", borderRadius: 12, padding: "16px 18px",
  },
  helpTitle: { fontSize: 13.5, fontWeight: 700, color: "#cfe0ee", marginBottom: 8 },
  helpList: { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: 12.8, color: "#b9cadb", lineHeight: 1.5 },
  infoHint: {
    display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: "#7d92a6",
    background: "#0e1c2b", border: "1px solid #1f3244", borderRadius: 8, padding: "6px 10px",
  },
  card: {
    background: "#101f2f", border: "1px solid #1f3244", borderRadius: 12,
    padding: 18, display: "flex", flexDirection: "column", gap: 12,
  },
  cardHeader: { fontSize: 13.5, fontWeight: 600, color: "#cfe0ee" },
  dropzone: {
    border: "1.5px dashed #2b4054", borderRadius: 12, padding: "22px 16px",
    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
    cursor: "pointer", background: "#0e1c2b",
  },
  errorBox: {
    display: "flex", alignItems: "center", gap: 8, background: "#3a1f1f",
    border: "1px solid #5c2b2b", color: "#f3b3b3", borderRadius: 8, padding: "8px 12px",
  },
  batchBlock: { borderTop: "1px solid #1f3244", paddingTop: 12 },
  batchHeaderRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  monthInput: {
    background: "#0e1c2b", border: "1px solid #2b4054", color: "#e7eef5",
    borderRadius: 6, padding: "4px 8px", fontSize: 12.5,
  },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4,
    color: "#7d92a6", padding: "6px 8px", borderBottom: "1px solid #1f3244",
  },
  td: { padding: "6px 8px", borderBottom: "1px solid #17293b", fontSize: 13 },
  textInput: {
    background: "#0e1c2b", border: "1px solid #2b4054", color: "#e7eef5",
    borderRadius: 6, padding: "4px 8px", fontSize: 13, width: "100%",
  },
  tag: { padding: "2px 8px", borderRadius: 20, fontSize: 12, fontWeight: 600 },
  sizeTag: {
    padding: "2px 8px", borderRadius: 6, fontSize: 12, fontWeight: 600,
    background: "#1c3348", color: "#9fc4e8", border: "1px solid #2b4a64",
  },
  iconBtn: {
    background: "transparent", border: "none", color: "#7d92a6", cursor: "pointer",
    padding: 4, display: "inline-flex", alignItems: "center",
  },
  primaryBtn: {
    marginTop: 4, alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8,
    background: "#6FA8DC", color: "#0c1b26", border: "none", borderRadius: 8,
    padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer",
  },
  tabRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  tab: {
    background: "#0e1c2b", border: "1px solid #1f3244", color: "#9fb3c8",
    borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer",
  },
  tabActive: { background: "#1a3a52", color: "#e7eef5", borderColor: "#6FA8DC" },
  sizeRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  sizeRowLabel: { fontSize: 12, color: "#7d92a6" },
  sizePill: {
    background: "transparent", border: "1px solid #1f3244", color: "#9fb3c8",
    borderRadius: 20, padding: "4px 13px", fontSize: 12.5, cursor: "pointer", fontWeight: 600,
  },
  sizePillActive: { background: "#223244", color: "#e7eef5", borderColor: "#6FA8DC" },
  sizePillDisabled: { opacity: 0.35, cursor: "not-allowed" },
  chartTitleRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 4 },
  chartTitle: { fontSize: 14, fontWeight: 700, color: "#e7eef5" },
  chartSubtitle: { fontSize: 12.5, color: "#7d92a6" },
  manageToggle: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    background: "transparent", border: "none", color: "#cfe0ee", fontSize: 13.5,
    fontWeight: 600, cursor: "pointer", padding: 0,
  },
  toast: {
    position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
    background: "#12251c", border: "1px solid #2c5c3f", borderRadius: 8,
    padding: "10px 16px", display: "flex", alignItems: "center", gap: 8, boxShadow: "0 4px 20px rgba(0,0,0,.4)",
  },
};

const css = `
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  input[type="month"]::-webkit-calendar-picker-indicator { filter: invert(0.7); }
`;
