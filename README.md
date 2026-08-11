# Frachtraten Dashboard

Eigenständiges React/Vite-Projekt mit **gemeinsamer Datenbank (Supabase)**.
Alle Kolleg:innen, die diese Website öffnen, sehen denselben, zentral
gespeicherten Datenstand. Design, Diagramm, Excel-Upload, Routen und
Containergrößen-Auswahl sind unverändert.

Diese Anleitung ist bewusst für Nicht-Entwickler geschrieben — einfach von
oben nach unten durchgehen.

---

## 1. Kostenloses Supabase-Projekt erstellen

1. Gehe auf **https://supabase.com** und klicke oben rechts auf **"Start your project"**.
2. Melde dich an (z. B. mit GitHub- oder Google-Konto — kostenlos).
3. Klicke auf **"New project"**.
4. Vergib einen Projektnamen (z. B. `frachtraten-dashboard`), ein Datenbank-Passwort
   (merken/notieren, wird aber für dieses Projekt nicht weiter gebraucht) und wähle
   eine Region in deiner Nähe (z. B. Frankfurt/EU).
5. Klicke auf **"Create new project"** und warte ca. 1–2 Minuten, bis es fertig eingerichtet ist.

## 2. Das SQL einfügen (Tabellen anlegen)

1. Öffne im Supabase-Projekt links im Menü den Punkt **"SQL Editor"**.
2. Klicke auf **"New query"**.
3. Öffne bei dir die Datei **`supabase/schema.sql`** aus diesem Projektordner,
   kopiere den kompletten Inhalt und füge ihn in das Eingabefeld im SQL Editor ein.
4. Klicke auf **"Run"** (bzw. den ▶-Button).
5. Es sollte "Success. No rows returned" erscheinen. Damit sind die drei Tabellen
   (`freight_uploads`, `freight_entries`, `freight_route_mapping`) inklusive der
   Sicherheitsregeln angelegt.

Was das SQL genau macht — inklusive Erklärung der Sicherheitsregeln (Row Level
Security) — steht unten im Abschnitt "Sicherheit / Row Level Security erklärt".

## 3. Project URL und Anon/Public Key finden

1. Klicke im Supabase-Projekt links im Menü auf das **Zahnrad-Symbol ("Project Settings")**.
2. Dort auf **"API"** klicken (bei neueren Supabase-Versionen: "API Keys" bzw. "Data API").
3. Dort findest du:
   - **Project URL** — sieht aus wie `https://abcdefghijk.supabase.co`
   - **anon / public key** — ein langer Text, der mit `eyJ...` beginnt

Beide Werte brauchst du im nächsten Schritt. Der `anon`-Key ist bewusst dafür
gedacht, öffentlich in einer Website verwendet zu werden (er ist kein
Geheimnis wie ein Passwort) — die eigentliche Absicherung passiert über die
Row-Level-Security-Regeln in der Datenbank.

## 4. Environment Variables eintragen

1. Kopiere im Projektordner die Datei **`.env.example`** und benenne die Kopie in **`.env`** um
   (im gleichen Ordner, auf gleicher Ebene wie `package.json`).
2. Öffne die neue `.env`-Datei in einem Texteditor und trage deine Werte ein:

   ```
   VITE_SUPABASE_URL=https://abcdefghijk.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...dein-key...
   ```

3. Datei speichern. **Diese `.env`-Datei niemals öffentlich teilen oder in ein
   öffentliches Git-Repository hochladen** (sie ist bereits in `.gitignore`
   eingetragen, wird also von Git automatisch ignoriert).

## 5. Sicherheit / Row Level Security erklärt

Row Level Security (RLS) ist die eingebaute Zugriffskontrolle von Supabase auf
Datenbank-Ebene. Kurz erklärt:

- **RLS aktiviert + keine Policy vorhanden** = die Tabelle ist für alle komplett
  gesperrt (weder lesen noch schreiben möglich). Das ist der sichere
  Ausgangszustand.
- **Eine Policy erlaubt gezielt** eine bestimmte Aktion (lesen/einfügen/
  ändern/löschen) für eine bestimmte Rolle (z. B. `anon` = "jede:r mit dem
  öffentlichen Anon-Key", später z. B. `authenticated` = "eingeloggte Person").

Das mitgelieferte SQL-Skript aktiviert RLS auf allen drei Tabellen und erlaubt
aktuell der Rolle `anon`:

| Tabelle                    | Lesen | Einfügen | Ändern | Löschen |
|-----------------------------|:---:|:---:|:---:|:---:|
| `freight_uploads`           | ✅  | ✅  | —   | ✅  |
| `freight_entries`           | ✅  | ✅  | —   | ✅  |
| `freight_route_mapping`     | ✅  | ✅  | ✅  | —   |

Das entspricht genau dem, was das Dashboard aktuell braucht — nicht mehr und
nicht weniger. Es gibt bewusst **keine** generelle "alles erlaubt"-Regel.

**Aktuell ist die Datenbank also für alle offen, die den Anon-Key kennen** (er
steht ja im Frontend-Code) — das ist so gewollt, solange es noch keinen
Login gibt. Sobald ihr später einen Login/Zugriffsschutz einbaut:

1. Öffnet erneut den SQL Editor in Supabase.
2. Löscht die bestehenden `..._anon`-Policies (z. B. mit
   `drop policy "freight_entries_insert_anon" on freight_entries;` für jede Policy)
   oder legt sie mit `to authenticated` statt `to anon` neu an.
3. Danach kann nur noch schreiben/löschen, wer eingeloggt ist — Lesen kann bei
   Bedarf weiterhin für alle offen bleiben, oder ebenfalls eingeschränkt werden.

Das Dashboard selbst enthält bewusst **keinen** Login — das wird, wie
besprochen, separat ergänzt.

## 6. Lokal testen

Voraussetzung: [Node.js](https://nodejs.org) (Version 18 oder neuer) ist installiert.

```bash
npm install
npm run dev
```

Danach im Browser die angezeigte Adresse öffnen (meist `http://localhost:5173`).

**So testest du, ob die gemeinsame Speicherung funktioniert:**

1. Öffne die Seite in einem normalen Browserfenster und lade eine Excel-Datei
   hoch, prüfe die Werte und klicke auf "Daten übernehmen".
2. Öffne dieselbe Adresse in einem **zweiten** Browser (oder einem
   Inkognito-/Privatfenster). Die eben gespeicherten Daten sollten dort
   ebenfalls direkt zu sehen sein, sobald die Seite geladen ist.
3. Lösche in einem der beiden Fenster einen Import über "Importierte Dateien
   verwalten" → Papierkorb-Symbol. Lade das andere Fenster neu (F5) — der
   Import sollte dort ebenfalls verschwunden sein.
4. Zur Kontrolle kannst du in Supabase links auf **"Table Editor"** klicken und
   dort die Tabellen `freight_uploads` und `freight_entries` direkt einsehen.

Falls beim Laden ein roter Fehlerhinweis erscheint: meistens fehlen die Werte
in der `.env`-Datei, oder das SQL wurde noch nicht ausgeführt — die
Fehlermeldung auf der Seite gibt dazu einen konkreten Hinweis.

## 7. Bei Vercel veröffentlichen

1. Gehe auf **https://vercel.com** und melde dich an (kostenlos, am einfachsten
   mit GitHub-Konto).
2. Falls das Projekt noch nicht auf GitHub liegt: Lade den Projektordner als
   neues Repository auf GitHub hoch (z. B. über GitHub Desktop, oder frag
   jemanden aus dem Team, der/die sich damit auskennt).
3. In Vercel: **"Add New..." → "Project"**, dann das GitHub-Repository
   auswählen und importieren.
4. Vercel erkennt automatisch, dass es sich um ein Vite-Projekt handelt
   (Build-Befehl `npm run build`, Ausgabeordner `dist` — das ist voreingestellt,
   in der Regel muss hier nichts geändert werden).
5. **Wichtig:** Vor dem Klick auf "Deploy" bei **"Environment Variables"**
   folgende zwei Einträge hinzufügen (Name + Wert jeweils genau wie in deiner
   `.env`-Datei):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Auf **"Deploy"** klicken und warten, bis der Build fertig ist.
7. Vercel zeigt danach eine fertige, öffentlich erreichbare Adresse
   (z. B. `https://frachtraten-dashboard.vercel.app`) — das ist die Live-Seite.

Falls sich später an den Supabase-Zugangsdaten etwas ändert: In Vercel unter
**Project → Settings → Environment Variables** anpassen und danach im Reiter
**"Deployments"** einen neuen Deploy anstoßen ("Redeploy").

## 8. Für andere Webhoster (statt Vercel) bauen

Falls du keinen Vercel nutzen möchtest, sondern klassisches Webhosting:

```bash
npm run build
```

Das erzeugt einen Ordner `dist/`. Dessen **Inhalt** (nicht den Ordner selbst)
lädst du per FTP/Dateimanager in das Wurzelverzeichnis deines Webspace hoch.
Die Umgebungsvariablen (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) müssen
dafür bereits **vor** dem `npm run build` in der `.env`-Datei stehen, da Vite
sie fest in die gebauten Dateien einbaut.

## Was ändert sich technisch für mehrere gleichzeitige Nutzer?

- Beim Öffnen der Seite werden die Daten immer frisch aus Supabase geladen —
  alle sehen also beim Öffnen denselben Stand.
- Speichert oder löscht jemand etwas, wird das sofort in der zentralen
  Datenbank aktualisiert.
- Wer die Seite bereits **geöffnet hat, während** eine andere Person etwas
  ändert, sieht die Änderung erst nach einem Neuladen der Seite (F5) — es gibt
  aktuell keine automatische Live-Aktualisierung im Hintergrund. Das lässt
  sich bei Bedarf später ergänzen (Supabase Realtime).

## Projektstruktur

```
frachtraten-dashboard/
├── index.html
├── package.json
├── vite.config.js
├── .env.example              # Vorlage für die eigenen Supabase-Zugangsdaten
├── supabase/
│   └── schema.sql            # SQL zum Anlegen der Tabellen + RLS-Policies
└── src/
    ├── main.jsx               # Einstiegspunkt
    ├── App.jsx                # Das komplette Dashboard (Design/Funktionen unverändert)
    ├── supabaseClient.js      # Supabase-Client, liest die Environment Variables
    ├── api/
    │   └── freightData.js     # Alle Lese-/Schreib-/Löschzugriffe auf Supabase
    └── index.css               # Minimales Basis-Styling
```
