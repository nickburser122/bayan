# Bayan

A local, in-browser analyser for health-insurance pharmacy cost reports (Arabic, RTL). Excel files are read in the browser and never uploaded.

## Entry
- `index.html` is the app.
- `favicon.svg` is the icon and brand mark (abstract capsule mark). `favicon.ico` and `apple-touch-icon.png` are the fallbacks.
- `css/app.css` holds the UI and the print report styles.
- `js/parse.js` is the sheet and paste parser (header detection with synonyms, merged cells, paired count/cost cells, metadata, and the name and region candidates found in each file; it also accepts a manual header row and column roles).
- `js/app.js` holds state, rendering, group-by, staging, copy and export.
- `js/vendor/xlsx.bundle.js` is xlsx-js-style 1.2.0 (SheetJS with cell styles), used to read and write files.

## Features
- **Upload or paste** one or many xlsx/xls/xlsm files, with drag and drop.
- **Smart source detection**: every sheet of every file is scanned for the report table (header words such as التخصص / القسم, الطبيب / الدكتور, نوع التذكرة / الفئة, العدد, التكلفة / القيمة, or a single count-and-cost cell). Sheets that don't match are still listed. "Edit source" opens a preview of the sheet where you can switch sheet, click the header row, and set the role of each column (specialty, doctor, ticket type, count, cost, or count + cost in one cell). Works for files, pasted data and already loaded pharmacies.
- **Review before loading**: pick or type the pharmacy name for each sheet from the detected values (labelled cells, header text, file name, sheet name) and the region. الموازنة is a text tag per pharmacy (for example طلاب or مواليد) that you type or pick; it is not read from the file and not a number. Apply a region or a tag to all selected rows, include or skip sheets, and choose replace or append.
- **After loading**: edit the name, region and الموازنة in the table or in the "Edit data" dialog. The original values are kept and can be restored per row or for all pharmacies. Edits commit on Enter or blur, Escape cancels, and Tab moves between cells.
- **Full data table**: every row of every loaded pharmacy is shown without grouping, with sortable columns, totals and copy.
- **Filters**: search text, cost range, ticket range, period, and multi-select by specialty, doctor, ticket type, pharmacy, region or الموازنة. Filters apply to the data table, the grouping and the exports; KPIs and findings always cover all included pharmacies.
- **Advanced group-by**, similar to Power Query: group by any ordered set of columns (specialty, doctor, ticket type, pharmacy, region, الموازنة). Each calculation has its own column name, operation and field. Operations: sum, average, median, min, max, standard deviation, share of total, weighted cost per ticket, row count, distinct count, list of values. Also included: optional subtotals, click-to-sort headers, presets, named saved views (kept in localStorage), and settings saved in localStorage.
- **Concise report**: KPI cards and a short list of findings (top line item, specialty, type, cost per ticket, concentration, pharmacy, region, الموازنة).
- **One-click copy**: click any KPI, finding line or number to copy it. Tables copy as TSV (and also as HTML for Word and email). "Copy report" copies the whole report.
- **Export**: print/PDF (A4 report), Excel (one styled sheet per section, RTL), formatted copy, or an HTML file. You choose the sections and the title. The choices are remembered.

## Storage
No backend. Group-by and export preferences, saved views and the list of الموازنة tags are kept in localStorage.

## Next steps
- Remember a source mapping per file layout so repeated files are read the same way without manual edits
- Filters inside saved views
