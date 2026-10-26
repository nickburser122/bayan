# Bayan

A local, in-browser analyser for health-insurance pharmacy cost reports (Arabic, RTL). Excel files are read in the browser and never uploaded.

## Entry
- `index.html` is the app.
- `favicon.svg` is the icon and brand mark (abstract capsule mark). `favicon.ico` and `apple-touch-icon.png` are the fallbacks.
- `css/app.css` holds the UI and the print report styles.
- `js/parse.js` is the sheet and paste parser (headers, merged cells, paired count/cost cells, metadata, and the name, region and budget candidates found in each file).
- `js/app.js` holds state, rendering, group-by, staging, copy and export.
- `js/vendor/xlsx.bundle.js` is xlsx-js-style 1.2.0 (SheetJS with cell styles), used to read and write files.

## Features
- **Upload or paste** one or many xlsx/xls/xlsm files, with drag and drop.
- **Review before loading**: each sheet shows its source file and sheet. For every sheet you can pick or type the pharmacy name (صيدلية) and the budget (موازنة) from the values detected in the file, including labelled cells, other sheets such as a budget sheet, the file name and the sheet name. You can also change the region per row, apply one region to every selected row, take names from the detected value, the file name or the sheet name, clear budgets, include or skip sheets, and choose replace or append.
- **After loading**: edit names, regions and budgets in the table or in the "Edit data" dialog. The original name, region and budget are always kept, and you can restore them per row or for all pharmacies. Edits commit on Enter or blur, Escape cancels, and Tab moves between cells.
- **Advanced group-by**, similar to Power Query: group by any ordered set of columns (specialty, doctor, ticket type, pharmacy, region). Each calculation has its own column name, operation and field. Operations: sum, average, median, min, max, standard deviation, share of total, weighted cost per ticket, row count, distinct count, list of values. Also included: optional subtotals, click-to-sort headers, presets, and settings saved in localStorage.
- **Concise report**: KPI cards and a short list of findings (top line item, specialty, type, cost per ticket, concentration, pharmacy, region, budget).
- **One-click copy**: click any KPI, finding line or number to copy it. Tables copy as TSV (and also as HTML for Word and email). "Copy report" copies the whole report.
- **Export**: print/PDF (A4 report), Excel (one styled sheet per section, RTL), formatted copy, or an HTML file. You choose the sections and the title. The choices are remembered.

## Storage
No backend. Only group-by and export preferences are kept, in localStorage.

## Next steps
- Saved named group-by views
- Filters, such as date or value thresholds, before grouping
