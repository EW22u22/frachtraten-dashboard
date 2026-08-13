// Konfiguration für die SCFI-Referenzlinie im Diagramm.
// Die eigentlichen SCFI-Monatswerte werden NICHT mehr statisch hier gepflegt,
// sondern zentral in Supabase gespeichert (Tabelle "scfi_rates") und im
// Dashboard über den Bereich "SCFI-Referenzwerte" aktuell gehalten
// (siehe src/api/scfiData.js und src/lib/parseScfiFile.js).

// SCFI-Linie soll ausschließlich für diesen Standort erscheinen.
export const SCFI_ROUTE_NAME = "China";

// SCFI-Basiswert gilt für 20'. 40' und 40' HC werden verdoppelt.
export const SCFI_SIZE_FACTOR = {
  "20": 1,
  "40": 2,
  "40HC": 2,
};

// Eigene Linienfarbe/-art für SCFI, damit sie sich klar von den
// Spediteur-Farben abhebt.
export const SCFI_LINE_COLOR = "#F5F5F5";
