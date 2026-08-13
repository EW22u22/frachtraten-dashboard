import { supabase } from "../supabaseClient.js";

const SCFI_TABLE = "scfi_rates";

function assertClient() {
  if (!supabase) {
    throw new Error(
      "Supabase ist nicht konfiguriert. Bitte VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY in der .env-Datei setzen (siehe .env.example)."
    );
  }
}

/**
 * Lädt alle gespeicherten SCFI-Werte aus Supabase und liefert sie als
 * Jahr -> 12 Monatswerte (Index 0 = Januar). Monate ohne Wert bleiben null.
 */
export async function loadScfiRates() {
  assertClient();
  const { data, error } = await supabase.from(SCFI_TABLE).select("*").order("month", { ascending: true });
  if (error) throw error;

  const byYear = {};
  let lastUpdatedAt = null;
  (data || []).forEach((row) => {
    const year = row.month.slice(0, 4);
    const monthIdx = parseInt(row.month.slice(5, 7), 10) - 1;
    if (!byYear[year]) byYear[year] = Array(12).fill(null);
    if (monthIdx >= 0 && monthIdx < 12) byYear[year][monthIdx] = Number(row.value);
    if (row.updated_at && (!lastUpdatedAt || row.updated_at > lastUpdatedAt)) {
      lastUpdatedAt = row.updated_at;
    }
  });

  return { byYear, lastUpdatedAt, rowCount: (data || []).length };
}

/**
 * Speichert eine Liste von { month: "YYYY-MM", value: number } zentral in
 * Supabase: vorhandene Monate werden aktualisiert, neue Monate automatisch
 * ergänzt (Upsert über die eindeutige "month"-Spalte, kein Duplizieren).
 */
export async function upsertScfiRates(rows) {
  assertClient();
  if (!rows || rows.length === 0) return { upserted: 0 };

  const nowIso = new Date().toISOString();
  const payload = rows.map((r) => ({ month: r.month, value: r.value, updated_at: nowIso }));

  const { error } = await supabase.from(SCFI_TABLE).upsert(payload, { onConflict: "month" });
  if (error) throw error;
  return { upserted: payload.length };
}
