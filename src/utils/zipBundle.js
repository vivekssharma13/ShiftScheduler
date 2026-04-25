import JSZip from "jszip";

function monthKeyFromFileName(name) {
  const m = String(name).match(/(\d{4}-\d{2})/);
  return m ? m[1] : null;
}

export async function buildScheduleZip({ perMonthCsvs, rangeLabel }) {
  const zip = new JSZip();
  for (const { monthKey, csvText } of perMonthCsvs) {
    zip.file(`shift-schedule_${monthKey}.csv`, csvText);
  }
  if (rangeLabel) {
    zip.file(
      "README.txt",
      `Shift schedule bundle for ${rangeLabel}.\nEach CSV is one month. Upload this .zip on the Holidays page to use the whole bundle as history.`
    );
  }
  return zip.generateAsync({ type: "blob" });
}

export async function parseHistoryZip(file) {
  if (!file) return [];
  const zip = await JSZip.loadAsync(file);
  const results = [];
  const skipped = [];

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);

  for (const entry of entries) {
    const name = entry.name.split("/").pop() || entry.name;
    if (!/\.csv$/i.test(name)) continue;
    const monthKey = monthKeyFromFileName(name);
    if (!monthKey) {
      skipped.push(name);
      continue;
    }
    const csvText = await entry.async("string");
    results.push({ monthKey, csvText, fileName: name });
  }

  return { imported: results, skipped };
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
