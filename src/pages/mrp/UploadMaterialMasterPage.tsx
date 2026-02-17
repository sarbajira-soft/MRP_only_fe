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

    const last = safeLoadLastParsed();
    if (!last) {
      await Swal.fire({
        icon: 'info',
        title: 'No Previous Upload',
        text: 'No previous Material Master upload found to compare',
      });
      return;
    }

    const newHeaders = (parsed.jsonData[0] ?? []) as unknown[];
    const lastHeaders = (last.jsonData[0] ?? []) as unknown[];
    const newRows = parsed.jsonData.slice(1) as unknown[][];
    const lastRows = last.jsonData.slice(1) as unknown[][];

    const newCols = newHeaders.length;
    const lastCols = lastHeaders.length;

    const rowDiff = newRows.length - lastRows.length;
    const colDiff = newCols - lastCols;

    const keyIdx = 0;
    const toKey = (r: unknown[]) => String(r[keyIdx] ?? '').trim();
    const normalizeRow = (r: unknown[]) => r.map((c) => String(c ?? '').trim());

    const lastMap = new Map<string, string>();
    lastRows.forEach((r) => {
      const k = toKey(r);
      if (!k) return;
      lastMap.set(k, JSON.stringify(normalizeRow(r)));
    });
    const newMap = new Map<string, string>();
    newRows.forEach((r) => {
      const k = toKey(r);
      if (!k) return;
      newMap.set(k, JSON.stringify(normalizeRow(r)));
    });

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    newMap.forEach((v, k) => {
      if (!lastMap.has(k)) {
        added.push(k);
      } else if (lastMap.get(k) !== v) {
        modified.push(k);
      }
    });
    lastMap.forEach((_, k) => {
      if (!newMap.has(k)) removed.push(k);
    });

    const sample = (arr: string[]) => arr.slice(0, 10).join(', ');

    const html = `
      <div style="text-align:left">
        <div style="font-size:14px; font-weight:600; margin-bottom:8px">Comparison Summary</div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px">
          <div style="border:1px solid #e2e8f0; border-radius:10px; padding:10px">
            <div style="color:#64748b; font-size:12px">Previous</div>
            <div style="font-size:13px"><strong>Sheet:</strong> ${last.sheetName}</div>
            <div style="font-size:13px"><strong>Rows:</strong> ${lastRows.length}</div>
            <div style="font-size:13px"><strong>Columns:</strong> ${lastCols}</div>
          </div>
          <div style="border:1px solid #e2e8f0; border-radius:10px; padding:10px">
            <div style="color:#64748b; font-size:12px">Selected</div>
            <div style="font-size:13px"><strong>Sheet:</strong> ${parsed.sheetName}</div>
            <div style="font-size:13px"><strong>Rows:</strong> ${newRows.length} <span style="color:${rowDiff >= 0 ? '#16a34a' : '#dc2626'}">(${rowDiff >= 0 ? '+' : ''}${rowDiff})</span></div>
            <div style="font-size:13px"><strong>Columns:</strong> ${newCols} <span style="color:${colDiff >= 0 ? '#16a34a' : '#dc2626'}">(${colDiff >= 0 ? '+' : ''}${colDiff})</span></div>
          </div>
        </div>
        <div style="margin-top:12px; display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px">
          <div style="border:1px solid #e2e8f0; border-radius:10px; padding:10px">
            <div style="color:#64748b; font-size:12px">Added materials</div>
            <div style="font-size:16px; font-weight:700; margin-top:4px">${added.length}</div>
            ${added.length ? `<div style="margin-top:6px; font-size:12px; color:#334155"><strong>Sample:</strong> ${sample(added)}</div>` : ''}
          </div>
          <div style="border:1px solid #e2e8f0; border-radius:10px; padding:10px">
            <div style="color:#64748b; font-size:12px">Removed materials</div>
            <div style="font-size:16px; font-weight:700; margin-top:4px">${removed.length}</div>
            ${removed.length ? `<div style="margin-top:6px; font-size:12px; color:#334155"><strong>Sample:</strong> ${sample(removed)}</div>` : ''}
          </div>
          <div style="border:1px solid #e2e8f0; border-radius:10px; padding:10px">
            <div style="color:#64748b; font-size:12px">Modified materials</div>
            <div style="font-size:16px; font-weight:700; margin-top:4px">${modified.length}</div>
            ${modified.length ? `<div style="margin-top:6px; font-size:12px; color:#334155"><strong>Sample:</strong> ${sample(modified)}</div>` : ''}
          </div>
        </div>
      </div>
    `;

    await Swal.fire({
      title: 'Compare with Last Upload',
      html,
      width: '70%',
      confirmButtonText: 'Close',
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
            <div className="rounded-xl border border-slate-200 bg-indigo-50/40 p-4">
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
