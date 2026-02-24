import { useEffect, useMemo, useRef, useState } from 'react';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
import { filesApi } from '../../app/api/filesApi';

type ParsedExcel = {
  sheetName: string;
  jsonData: unknown[][];
};

type UploadRecord = {
  id: string;
  backendFileId?: string;
  fileName: string;
  uploadedAt: string;
  status: 'active' | 'deleted';
};

const STORAGE_KEY = 'mrp:material_master:uploads:v1';
const LAST_PARSED_KEY = 'mrp:material_master:lastParsed:v1';

function formatDateTime(value: string) {
  const d = new Date(value);
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function validateExcelFile(file: File) {
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    return { isValid: false, error: 'File size exceeds 10MB limit' } as const;
  }

  const fileName = file.name.toLowerCase();
  const allowedExtensions = ['.xlsx', '.xls', '.xlsm'];
  const hasValidExtension = allowedExtensions.some((ext) => fileName.endsWith(ext));
  if (!hasValidExtension) {
    return { isValid: false, error: 'Please select a valid Excel file (.xlsx, .xls, or .xlsm)' } as const;
  }

  return { isValid: true } as const;
}

function normalizeHeaderValue(v: unknown) {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, ' ')
    .replaceAll('_', ' ');
}

function scoreMaterialMasterSheet(sheetName: string, aoa: unknown[][]) {
  const sn = normalizeHeaderValue(sheetName);
  const rows = aoa.slice(0, 15);
  const has = (q: string) => rows.some((r) => r.some((c) => normalizeHeaderValue(c).includes(q)));

  let s = 0;
  if (sn.includes('material')) s += 3;
  if (sn.includes('master')) s += 2;
  if (has('child part') || has('childpart')) s += 4;
  if (has('mpq')) s += 2;
  if (has('moq')) s += 2;
  if (has('reorder')) s += 2;
  if (has('instock') || has('in stock')) s += 1;
  if (has('pending po')) s += 1;
  return s;
}

async function parseExcel(file: File): Promise<ParsedExcel> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  let bestSheetName = workbook.SheetNames[0] ?? 'Sheet1';
  let bestScore = -1;
  let bestJsonData: unknown[][] | null = null;

  workbook.SheetNames.forEach((sn) => {
    const ws = workbook.Sheets[sn];
    if (!ws) return;
    const aoa =
      (XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: '',
        blankrows: false,
      }) as unknown[][]) ?? [];

    const score = scoreMaterialMasterSheet(sn, aoa);
    if (score > bestScore) {
      bestScore = score;
      bestSheetName = sn;
      bestJsonData = aoa;
    }
  });

  return { sheetName: bestSheetName, jsonData: bestJsonData ?? ([] as unknown[][]) };
}

async function parseExcelArrayBuffer(buffer: ArrayBuffer): Promise<ParsedExcel> {
  const workbook = XLSX.read(buffer, { type: 'array' });

  let bestSheetName = workbook.SheetNames[0] ?? 'Sheet1';
  let bestScore = -1;
  let bestJsonData: unknown[][] | null = null;

  workbook.SheetNames.forEach((sn) => {
    const ws = workbook.Sheets[sn];
    if (!ws) return;
    const aoa =
      (XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: '',
        blankrows: false,
      }) as unknown[][]) ?? [];

    const score = scoreMaterialMasterSheet(sn, aoa);
    if (score > bestScore) {
      bestScore = score;
      bestSheetName = sn;
      bestJsonData = aoa;
    }
  });

  return { sheetName: bestSheetName, jsonData: bestJsonData ?? ([] as unknown[][]) };
}

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeLoadUploads(): UploadRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UploadRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeSaveUploads(records: UploadRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function safeLoadLastParsed(): ParsedExcel | null {
  try {
    const raw = localStorage.getItem(LAST_PARSED_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ParsedExcel;
  } catch {
    return null;
  }
}

function safeSaveLastParsed(parsed: ParsedExcel) {
  localStorage.setItem(LAST_PARSED_KEY, JSON.stringify(parsed));
}

export default function UploadMaterialMasterPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedExcel | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [uploads, setUploads] = useState<UploadRecord[]>(() => safeLoadUploads());

  useEffect(() => {
    document.title = 'MRP - Upload Material Master';
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const files = await filesApi.list({ type: 'material_master', limit: 25, offset: 0 });
        if (cancelled) return;

        if (files.length > 0) {
          const mapped: UploadRecord[] = files.map((f) => ({
            id: f.id,
            backendFileId: f.id,
            fileName: f.original_name,
            uploadedAt: f.created_at,
            status: 'active',
          }));
          setUploads(mapped);
          safeSaveUploads(mapped);
        }
      } catch {
        if (cancelled) return;
        setUploads(safeLoadUploads());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const parsedSummary = useMemo(() => {
    if (!parsed) return null;
    const header = parsed.jsonData[0] ?? [];
    const rows = Math.max(0, parsed.jsonData.length - 1);
    const cols = Array.isArray(header) ? header.length : 0;
    return { rows, cols, sheetName: parsed.sheetName };
  }, [parsed]);

  const handleFileSelect: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const v = validateExcelFile(file);
    if (!v.isValid) {
      await Swal.fire({ icon: 'error', title: 'Invalid File', text: v.error });
      e.target.value = '';
      return;
    }

    setIsLoading(true);
    try {
      const parsedExcel = await parseExcel(file);
      setSelectedFile(file);
      setParsed(parsedExcel);
    } catch {
      await Swal.fire({ icon: 'error', title: 'Parse Error', text: 'Failed to parse the selected file' });
      e.target.value = '';
    } finally {
      setIsLoading(false);
    }
  };

  const resetSelection = () => {
    setSelectedFile(null);
    setParsed(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (!selectedFile || !parsed) {
      await Swal.fire({ icon: 'warning', title: 'No File Selected', text: 'Please select an Excel file to upload' });
      return;
    }

    setIsLoading(true);
    try {
      let backendFileId: string | undefined;
      try {
        const uploaded = await filesApi.upload(selectedFile, 'material_master');
        backendFileId = uploaded.id;
      } catch {
        await Swal.fire({
          icon: 'warning',
          title: 'Upload Warning',
          text: 'Upload saved, but could not sync to server',
        });
      }

      const now = new Date().toISOString();
      const record: UploadRecord = {
        id: createId(),
        backendFileId,
        fileName: selectedFile.name,
        uploadedAt: now,
        status: 'active',
      };

      const next = [record, ...uploads];
      setUploads(next);
      safeSaveUploads(next);
      safeSaveLastParsed(parsed);

      await Swal.fire({
        icon: 'success',
        title: 'Upload Successful',
        text: backendFileId
          ? 'Material Master file uploaded successfully'
          : 'Material Master file saved',
      });

      resetSelection();
    } finally {
      setIsLoading(false);
    }
  };

  const showPreview = async () => {
    if (!parsed) {
      await Swal.fire({ icon: 'warning', title: 'No File Selected', text: 'Please select a file first' });
      return;
    }

    const jsonData = parsed.jsonData;
    const headers = (jsonData[0] ?? []) as unknown[];
    const rows = jsonData.slice(1);
    const limited = rows.slice(0, 30);

    const escape = (v: unknown) =>
      String(v ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');

    const tableHtml = `
      <div style="text-align:left">
        <div style="margin-bottom:8px">
          <div><strong>Sheet:</strong> ${escape(parsed.sheetName)}</div>
          <div><strong>Total Rows:</strong> ${rows.length}</div>
          <div><strong>Columns:</strong> ${headers.length}</div>
        </div>
        <div style="overflow:auto; max-height:60vh; border:1px solid #e2e8f0; border-radius:10px">
          <table style="border-collapse:collapse; width:100%; font-size:12px">
            <thead>
              <tr>
                ${headers.map((h) => `<th style="position:sticky; top:0; background:#0f172a; color:#fff; padding:8px; border-bottom:1px solid #334155">${escape(h)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${limited
                .map(
                  (row) => `
                    <tr>
                      ${(row as unknown[])
                        .map((cell) => `<td style="padding:8px; border-bottom:1px solid #e2e8f0">${escape(cell)}</td>`)
                        .join('')}
                    </tr>
                  `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
        ${rows.length > limited.length ? `<div style="margin-top:8px; color:#64748b">Showing first ${limited.length} rows</div>` : ''}
      </div>
    `;

    await Swal.fire({
      title: 'Material Master Preview',
      html: tableHtml,
      width: '95%',
      confirmButtonText: 'Close',
    });
  };

  const handleCompareWithLast = async () => {
    if (!parsed) {
      await Swal.fire({ icon: 'warning', title: 'No File Selected', text: 'Please select a file first' });
      return;
    }

    let last = safeLoadLastParsed() as (ParsedExcel & { record?: unknown }) | null;
    if (!last) {
      const latestBackend = uploads.find((u) => u.status === 'active' && !!u.backendFileId);
      if (latestBackend?.backendFileId) {
        try {
          const buf = await filesApi.downloadArrayBuffer(latestBackend.backendFileId, 'material_master');
          const parsedLast = await parseExcelArrayBuffer(buf);
          last = parsedLast as ParsedExcel & { record?: unknown };
          (last as any).record = {
            original_name: latestBackend.fileName,
            id: latestBackend.backendFileId,
          };
        } catch {
          await Swal.fire({
            icon: 'info',
            title: 'No Previous Upload',
            text: 'No previous Material Master upload found to compare',
          });
          return;
        }
      } else {
        await Swal.fire({
          icon: 'info',
          title: 'No Previous Upload',
          text: 'No previous Material Master upload found to compare',
        });
        return;
      }
    }

    const escape = (value: unknown) => {
      const str = value == null ? '' : String(value);
      return str
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    };

    const newHeaders = (parsed.jsonData[0] ?? []) as unknown[];
    const lastHeaders = (last.jsonData[0] ?? []) as unknown[];
    const newRows = parsed.jsonData.slice(1) as unknown[][];
    const lastRows = last.jsonData.slice(1) as unknown[][];

    const rowDiff = newRows.length - lastRows.length;
    const colDiff = newHeaders.length - lastHeaders.length;

    const keyIdx = 0;
    const keyColumnNames = ['Child Part'];
    const toKey = (r: unknown[]) => String(r[keyIdx] ?? '').trim();

    const normalizeHeader = (h: unknown) => normalizeHeaderValue(h);
    const ignoredHeaderNames = ['s.no', 's no', 's.no.', 'serial no', 'serialno', 'sr no', 'sr. no'];
    const ignoredColumnIndices = newHeaders
      .map((h, idx) => ({ h: normalizeHeader(h), idx }))
      .filter(({ h }) => ignoredHeaderNames.includes(h))
      .map(({ idx }) => idx);
    const ignoredSet = new Set<number>(ignoredColumnIndices);

    const normalizeCell = (v: unknown) => String(v ?? '').trim();
    const rowsAreDifferent = (a: unknown[], b: unknown[]) => {
      const len = Math.max(newHeaders.length, a.length, b.length);
      for (let i = 0; i < len; i += 1) {
        if (ignoredSet.has(i)) continue;
        if (normalizeCell(a[i]) !== normalizeCell(b[i])) return true;
      }
      return false;
    };

    const newRowsMap = new Map<string, unknown[]>();
    newRows.forEach((row) => {
      const k = toKey(row);
      if (!k) return;
      newRowsMap.set(k, row);
    });

    const lastRowsMap = new Map<string, unknown[]>();
    lastRows.forEach((row) => {
      const k = toKey(row);
      if (!k) return;
      lastRowsMap.set(k, row);
    });

    const addedRows = newRows.filter((row) => {
      const k = toKey(row);
      return k && !lastRowsMap.has(k);
    });

    const removedRows = lastRows.filter((row) => {
      const k = toKey(row);
      return k && !newRowsMap.has(k);
    });

    const modifiedRows: { key: string; old: unknown[]; new: unknown[] }[] = [];
    newRows.forEach((row) => {
      const k = toKey(row);
      if (!k) return;
      const oldRow = lastRowsMap.get(k);
      if (oldRow && rowsAreDifferent(row, oldRow)) {
        modifiedRows.push({ key: k, old: oldRow, new: row });
      }
    });

    const newFileName = (selectedFile?.name ?? '').trim();
    const oldFileName =
      String((last as any)?.record?.original_name ?? '') ||
      String((last as any)?.record?.s3_upload_path ?? '').split('/').pop();
    const headerCells = newHeaders
      .map(
        (h) =>
          `<th style="position:sticky; top:0; background:#0f172a; color:#fff; padding:8px; border-bottom:1px solid #334155">${escape(
            h,
          )}</th>`,
      )
      .join('');

    const renderRowCells = (row: unknown[], changed: Set<number> | null, mode: 'old' | 'new') =>
      newHeaders
        .map((_, idx) => {
          const isChanged = changed ? changed.has(idx) : false;
          const bg = !changed
            ? ''
            : !isChanged
              ? 'background:#ffffff;'
              : mode === 'old'
                ? 'background:#fee2e2;'
                : 'background:#dcfce7;';
          return `<td style="padding:8px; border-bottom:1px solid #e2e8f0; ${bg}">${escape(row[idx] ?? '')}</td>`;
        })
        .join('');

    const renderTable = (rows: unknown[][], rowClass: string) => {
      const body = rows
        .map(
          (row) => `
            <tr class="${rowClass}">${renderRowCells(row, null, 'new')}</tr>
          `,
        )
        .join('');
      return `
        <div style="overflow:auto; max-height:45vh; border:1px solid #e2e8f0; border-radius:10px">
          <table style="border-collapse:collapse; width:100%; font-size:12px">
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      `;
    };

    const modifiedHtml = modifiedRows
      .map((m, idx) => {
        const changed = new Set<number>();
        const maxLen = Math.max(m.old.length, m.new.length, newHeaders.length);
        for (let i = 0; i < maxLen; i += 1) {
          if (ignoredSet.has(i)) continue;
          if (normalizeCell(m.old[i]) !== normalizeCell(m.new[i])) changed.add(i);
        }

        const rowNum = String((m.old[0] ?? m.new[0] ?? idx + 1) as any);
        return `
          <div style="margin-top:12px">
            <div style="font-size:13px; font-weight:600; margin-bottom:6px">
              Row ${escape(rowNum)} - ${changed.size} column(s) changed
            </div>
            <div style="overflow:auto; border:1px solid #e2e8f0; border-radius:10px">
              <table style="border-collapse:collapse; width:100%; font-size:12px">
                <thead><tr>${headerCells}</tr></thead>
                <tbody>
                  <tr>${renderRowCells(m.old, changed, 'old')}</tr>
                  <tr>${renderRowCells(m.new, changed, 'new')}</tr>
                </tbody>
              </table>
            </div>
          </div>
        `;
      })
      .join('');

    const html = `
      <div style="text-align:left">
        <div style="font-size:14px; font-weight:700; margin-bottom:8px">Data Comparison</div>
        <div style="margin-bottom:10px; color:#0f172a; font-size:13px">
          Comparing: <strong>${escape(oldFileName || 'Previous')}</strong> → <strong>${escape(
            newFileName || parsed.sheetName || 'Selected',
          )}</strong>
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px">
          <div style="border:1px solid #e2e8f0; border-radius:10px; padding:10px; min-width:240px">
            <div style="color:#64748b; font-size:12px">Rows</div>
            <div style="font-size:13px"><strong>${lastRows.length}</strong> → <strong>${newRows.length}</strong> <span style="color:${rowDiff >= 0 ? '#16a34a' : '#dc2626'}">(${rowDiff >= 0 ? '+' : ''}${rowDiff})</span></div>
          </div>
          <div style="border:1px solid #e2e8f0; border-radius:10px; padding:10px; min-width:240px">
            <div style="color:#64748b; font-size:12px">Columns</div>
            <div style="font-size:13px"><strong>${lastHeaders.length}</strong> → <strong>${newHeaders.length}</strong> <span style="color:${colDiff >= 0 ? '#16a34a' : '#dc2626'}">(${colDiff >= 0 ? '+' : ''}${colDiff})</span></div>
          </div>
          <div style="border:1px solid #e2e8f0; border-radius:10px; padding:10px; min-width:240px">
            <div style="color:#64748b; font-size:12px">Changes</div>
            <div style="font-size:13px">
              <span style="color:#16a34a; font-weight:600">+${addedRows.length} added</span>
              <span style="margin-left:10px; color:#dc2626; font-weight:600">-${removedRows.length} removed</span>
              <span style="margin-left:10px; color:#7c3aed; font-weight:600">~${modifiedRows.length} modified</span>
            </div>
          </div>
        </div>

        ${addedRows.length === 0 && removedRows.length === 0 && modifiedRows.length === 0 ? `
          <div style="border:1px solid #e2e8f0; border-radius:12px; padding:14px; text-align:center; background:#f8fafc">
            <div style="font-size:14px; font-weight:700; color:#16a34a">No differences found</div>
            <div style="margin-top:6px; color:#64748b; font-size:12px">The files appear to be identical.</div>
          </div>
        ` : ''}

        ${removedRows.length > 0 ? `
          <div style="margin-top:12px">
            <div style="font-size:13px; font-weight:700; margin-bottom:6px; color:#dc2626">Removed Rows (${removedRows.length})</div>
            ${renderTable(removedRows, 'removed')}
          </div>
        ` : ''}

        ${addedRows.length > 0 ? `
          <div style="margin-top:12px">
            <div style="font-size:13px; font-weight:700; margin-bottom:6px; color:#16a34a">Added Rows (${addedRows.length})</div>
            ${renderTable(addedRows, 'added')}
          </div>
        ` : ''}

        ${modifiedRows.length > 0 ? `
          <div style="margin-top:12px">
            <div style="font-size:13px; font-weight:700; margin-bottom:6px; color:#7c3aed">Modified Rows (${modifiedRows.length})</div>
            <div style="margin-bottom:8px; color:#64748b; font-size:12px"><strong>Key Columns:</strong> ${escape(
              keyColumnNames.join(', '),
            )}</div>
            <div style="max-height:55vh; overflow:auto; padding-right:6px">${modifiedHtml}</div>
          </div>
        ` : ''}
      </div>
    `;

    await Swal.fire({
      title: 'Data Comparison',
      html,
      width: '95%',
      confirmButtonText: 'Close',
      showCancelButton: true,
      cancelButtonText: 'Proceed to Upload',
      customClass: { popup: 'swal-wide' },
    }).then((result) => {
      if (result.dismiss === Swal.DismissReason.cancel) {
        void handleUpload();
      }
    });
  };

  const handleDeleteRecord = async (id: string) => {
    const res = await Swal.fire({
      title: 'Are you sure?',
      text: "You won't be able to revert this!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#334155',
      confirmButtonText: 'Yes, delete it!',
    });

    if (!res.isConfirmed) return;

    const rec = uploads.find((u) => u.id === id);
    if (rec?.backendFileId) {
      try {
        await filesApi.remove(rec.backendFileId, 'material_master');
      } catch {
        await Swal.fire({
          icon: 'warning',
          title: 'Backend Delete Failed',
          text: 'Deleted, but failed to delete from backend API',
        });
      }
    }

    const next: UploadRecord[] = uploads.map((u) => (u.id === id ? { ...u, status: 'deleted' } : u));
    setUploads(next);
    safeSaveUploads(next);
    await Swal.fire({ icon: 'success', title: 'Deleted!', text: 'File has been deleted' });
  };

  const activeUploads = uploads.filter((u) => u.status === 'active');

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-700 p-6 text-white shadow-sm">
        <div className="text-2xl font-semibold">Upload Material Master</div>
        <div className="mt-1 text-sm text-white/80">Upload and manage Material Master excel files.</div>
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <label className="block text-sm font-medium text-slate-700">Select Excel File</label>
            <div className="mt-2 flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.xlsm"
                onChange={handleFileSelect}
                className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
              />
              <button
                type="button"
                onClick={resetSelection}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                disabled={isLoading}
              >
                Clear
              </button>
            </div>

            {selectedFile && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="text-sm font-medium text-slate-900">Selected file</div>
                <div className="mt-1 text-sm text-slate-700">{selectedFile.name}</div>
                {parsedSummary && (
                  <div className="mt-2 text-xs text-slate-600">
                    Sheet: <span className="font-medium text-slate-900">{parsedSummary.sheetName}</span> | Rows:{' '}
                    <span className="font-medium text-slate-900">{parsedSummary.rows}</span> | Columns:{' '}
                    <span className="font-medium text-slate-900">{parsedSummary.cols}</span>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={showPreview}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                    disabled={isLoading || !parsed}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={handleCompareWithLast}
                    className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-100"
                    disabled={isLoading || !parsed}
                  >
                    Compare with Last Upload
                  </button>
                  <button
                    type="button"
                    onClick={handleUpload}
                    className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isLoading || !selectedFile || !parsed}
                  >
                    {isLoading ? 'Processing...' : 'Upload'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="mt-6 rounded-xl border border-slate-200 bg-indigo-50/40 p-4 lg:mt-7">
              <div className="text-xs text-slate-500">Accepted: .xlsx, .xls, .xlsm | Max size: 10MB</div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <div>
          <div className="text-lg font-semibold">Uploaded Files</div>
          <div className="mt-1 text-sm text-slate-600">Recent uploads.</div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="border-b border-slate-200 px-3 py-2">#</th>
                <th className="border-b border-slate-200 px-3 py-2">ID</th>
                <th className="border-b border-slate-200 px-3 py-2">File</th>
                <th className="border-b border-slate-200 px-3 py-2">Uploaded At</th>
                <th className="border-b border-slate-200 px-3 py-2">Status</th>
                <th className="border-b border-slate-200 px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeUploads.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-sm text-slate-600" colSpan={6}>
                    No files uploaded yet
                  </td>
                </tr>
              ) : (
                activeUploads.map((u, idx) => (
                  <tr key={u.id} className="text-sm">
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-600">{idx + 1}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-mono text-xs text-slate-700">
                      {u.id}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-900">{u.fileName}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">{formatDateTime(u.uploadedAt)}</td>
                    <td className="border-b border-slate-100 px-3 py-2">
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                        {u.status}
                      </span>
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => handleDeleteRecord(u.id)}
                        className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
