import { useEffect, useMemo, useState } from 'react';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
import { filesApi, type FileRecord } from '../../app/api/filesApi';

type ParsedExcel = {
  sheetName: string;
  jsonData: unknown[][];
};

type LoadingStatus = 'pending' | 'loading' | 'success' | 'error';

type MrpRow = {
  material: string;
  uom: string;
  supplierCode: string;
  mpq: number;
  moq: number;
  reorder: number;
  instock: number;
  pendingPo: number;
  excessQty: number;
  leadTime: number;
  weeklyDemand: Record<string, number>;
  weeklyMrpQty: Record<string, number>;
  weeklyPoDate: Record<string, string>;
  totalDemand: number;
};

const LAST_PARSED_KEYS = {
  bom: 'mrp:bom:lastParsed:v1',
  materialMaster: 'mrp:materialMaster:lastParsed:v1',
  idp: 'mrp:idp:lastParsed:v1',
  supplierDetails: 'mrp:supplierDetails:lastParsed:v1',
  weekPlan: 'mrp:weekPlan:lastParsed:v1',
} as const;

function safeLoadLastParsed(key: string): ParsedExcel | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ParsedExcel;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.jsonData)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function scoreSheetByType(
  type: 'bom' | 'material_master' | 'idp' | 'supplier_details' | 'week_plan',
  sheetName: string,
  aoa: unknown[][],
) {
  const rows = aoa.slice(0, 15);
  const has = (q: string) => rows.some((r) => r.some((c) => normalizeHeaderValue(c).includes(q)));
  const hasRegex = (re: RegExp) => rows.some((r) => r.some((c) => re.test(String(c ?? '').trim())));
  const sn = normalizeHeaderValue(sheetName);

  if (type === 'bom') {
    let s = 0;
    if (sn.includes('bom')) s += 5;
    if (has('derived')) s += 2;
    if (has('child')) s += 3;
    if (has('quantity') || has('per kit')) s += 1;
    if (has('uom')) s += 1;
    return s;
  }

  if (type === 'material_master') {
    let s = 0;
    if (sn.includes('material')) s += 3;
    if (sn.includes('master')) s += 2;
    if (has('mpq')) s += 2;
    if (has('moq')) s += 2;
    if (has('reorder')) s += 2;
    if (has('instock') || has('in stock')) s += 1;
    if (has('pending po')) s += 1;
    return s;
  }

  if (type === 'supplier_details') {
    let s = 0;
    if (sn.includes('supplier')) s += 4;
    if (sn.includes('vendor')) s += 2;
    if (has('vendor')) s += 2;
    if (has('lead-time') || has('lead time')) s += 2;
    if (has('transport')) s += 1;
    return s;
  }

  if (type === 'week_plan') {
    let s = 0;
    if (sn.includes('week')) s += 4;
    if (sn.includes('plan')) s += 2;
    if (has('week')) s += 2;
    if (has('start date')) s += 2;
    if (has('end date')) s += 1;
    return s;
  }

  // idp
  let s = 0;
  if (sn.includes('production')) s += 2;
  if (sn.includes('plan')) s += 2;
  if (sn.includes('idp')) s += 4;
  if (has('derived')) s += 2;
  if (hasRegex(/^\d{2}\.\d{4}$/)) s += 4;
  return s;
}

function parseExcelArrayBuffer(buffer: ArrayBuffer, type: 'bom' | 'material_master' | 'idp' | 'supplier_details' | 'week_plan'): ParsedExcel {
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

    const score = scoreSheetByType(type, sn, aoa);
    if (score > bestScore) {
      bestScore = score;
      bestSheetName = sn;
      bestJsonData = aoa;
    }
  });

  return { sheetName: bestSheetName, jsonData: bestJsonData ?? ([] as unknown[][]) };
}

function toNumber(v: unknown) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(v: unknown) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatPoDate(d: Date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getDate()).padStart(2, '0');
  const month = months[d.getMonth()];
  const yearShort = String(d.getFullYear()).slice(-2);
  return `${day}-${month}-${yearShort}`;
}

function parsePoDateToIso(poDate: string) {
  if (!poDate || poDate === '-') return null;
  const parts = poDate.split('-');
  if (parts.length !== 3) return null;
  const monthMap: Record<string, string> = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  };
  const day = parts[0]?.padStart(2, '0');
  const month = monthMap[parts[1] ?? ''];
  if (!month) return null;
  let year = parts[2] ?? '';
  if (year.length === 2) year = `20${year}`;
  if (year.length !== 4) return null;
  return `${year}-${month}-${day}`;
}

function normalizeHeaderValue(v: unknown) {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, ' ')
    .replaceAll('_', ' ');
}

function findHeaderRowIndex(rows: unknown[][], matchers: ((row: unknown[]) => boolean)[], maxScan = 10) {
  const scan = rows.slice(0, Math.min(maxScan, rows.length));
  for (let i = 0; i < scan.length; i += 1) {
    const row = scan[i] ?? [];
    if (matchers.every((m) => m(row))) return i;
  }
  return 0;
}

function findColumnIndex(headers: unknown[], predicates: ((h: string) => boolean)[]) {
  for (let i = 0; i < headers.length; i += 1) {
    const h = normalizeHeaderValue(headers[i]);
    if (!h) continue;
    if (predicates.some((p) => p(h))) return i;
  }
  return -1;
}

export default function MrpDataPage() {
  const [isLoading, setIsLoading] = useState(false);

  const [mrpCalculatedData, setMrpCalculatedData] = useState<MrpRow[] | null>(null);

  const [weekColumns, setWeekColumns] = useState<string[]>([]);
  const [allWeekColumns, setAllWeekColumns] = useState<string[]>([]);

  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
  const [startWeek, setStartWeek] = useState<number>(1);
  const [endWeek, setEndWeek] = useState<number>(20);

  const [startWeekText, setStartWeekText] = useState<string>('1');
  const [endWeekText, setEndWeekText] = useState<string>('20');

  const [searchMaterial, setSearchMaterial] = useState('');
  const [poDateFrom, setPoDateFrom] = useState('');
  const [poDateTo, setPoDateTo] = useState('');

  const [loadingStatus, setLoadingStatus] = useState<Record<string, LoadingStatus>>({
    bom: 'pending',
    materialMaster: 'pending',
    idp: 'pending',
    supplierDetails: 'pending',
    weekPlan: 'pending',
  });

  useEffect(() => {
    document.title = 'MRP - MRP Data';
  }, []);

  const currentYear = new Date().getFullYear();
  const availableYears = useMemo(
    () => Array.from({ length: 21 }, (_, i) => (currentYear - 10 + i).toString()),
    [currentYear],
  );

  useEffect(() => {
    setStartWeekText(String(startWeek));
  }, [startWeek]);

  useEffect(() => {
    setEndWeekText(String(endWeek));
  }, [endWeek]);

  const clampWeek = (v: number) => Math.max(1, Math.min(53, v));

  const commitStartWeek = () => {
    const raw = startWeekText.trim();
    if (!raw) return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setStartWeek(clampWeek(Math.floor(n)));
  };

  const commitEndWeek = () => {
    const raw = endWeekText.trim();
    if (!raw) return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setEndWeek(clampWeek(Math.floor(n)));
  };

  const parseWeekText = (raw: string) => {
    const t = raw.trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return clampWeek(Math.floor(n));
  };

  const weekValidation = useMemo(() => {
    const s = parseWeekText(startWeekText);
    const e = parseWeekText(endWeekText);
    if (s == null || e == null) return { isValid: false, message: 'Enter valid start and end week (1 to 53).' };
    if (s > e) return { isValid: false, message: 'Enter a valid week range (Start Week must be ≤ End Week).' };
    return { isValid: true, message: '' };
  }, [endWeekText, startWeekText]);

  const getStatusPillClass = (status: LoadingStatus) => {
    if (status === 'success') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (status === 'loading') return 'bg-sky-50 text-sky-700 border-sky-200';
    if (status === 'error') return 'bg-red-50 text-red-700 border-red-200';
    return 'bg-slate-50 text-slate-700 border-slate-200';
  };

  const getStatusText = (status: LoadingStatus) => {
    if (status === 'success') return 'Loaded';
    if (status === 'loading') return 'Loading';
    if (status === 'error') return 'Failed';
    return 'Pending';
  };

  const fetchLatestFileId = async (type: string) => {
    const list = await filesApi.list({ type, limit: 1, offset: 0 });
    const first = (Array.isArray(list) ? list[0] : null) as FileRecord | undefined;
    return first?.id;
  };

  const fetchDataSource = async (type: 'bom' | 'material_master' | 'idp' | 'supplier_details' | 'week_plan') => {
    const statusKey =
      type === 'material_master'
        ? 'materialMaster'
        : type === 'supplier_details'
          ? 'supplierDetails'
          : type === 'week_plan'
            ? 'weekPlan'
            : type;

    setLoadingStatus((prev) => ({ ...prev, [statusKey]: 'loading' }));
    try {
      let parsed: ParsedExcel | null = null;

      try {
        const latestId = await fetchLatestFileId(type);
        if (latestId) {
          const buffer = await filesApi.downloadArrayBuffer(latestId, type);
          parsed = parseExcelArrayBuffer(buffer, type);
        }
      } catch {
        parsed = null;
      }

      if (!parsed) {
        const localKey =
          type === 'material_master'
            ? LAST_PARSED_KEYS.materialMaster
            : type === 'supplier_details'
              ? LAST_PARSED_KEYS.supplierDetails
              : type === 'week_plan'
                ? LAST_PARSED_KEYS.weekPlan
                : type === 'bom'
                  ? LAST_PARSED_KEYS.bom
                  : LAST_PARSED_KEYS.idp;
        parsed = safeLoadLastParsed(localKey);
      }

      if (!parsed || !Array.isArray(parsed.jsonData) || parsed.jsonData.length === 0) {
        setLoadingStatus((prev) => ({ ...prev, [statusKey]: 'error' }));
        return { success: false as const, data: null as ParsedExcel | null };
      }

      setLoadingStatus((prev) => ({ ...prev, [statusKey]: 'success' }));
      return { success: true as const, data: parsed };
    } catch {
      setLoadingStatus((prev) => ({ ...prev, [statusKey]: 'error' }));
      return { success: false as const, data: null as ParsedExcel | null };
    }
  };

  const calculatePoDate = (weekStr: string, leadTimeDays: number, mrpQty: number, weekPlan: ParsedExcel | null) => {
    try {
      if (mrpQty <= 0) return '-';

      let requiredDate: Date | null = null;

      if (weekPlan?.jsonData?.length) {
        const headers = (weekPlan.jsonData[0] ?? []) as unknown[];
        const rows = weekPlan.jsonData.slice(1) as unknown[][];
        const weekNoIdx = headers.findIndex((h) => String(h ?? '').toLowerCase().includes('week'));
        const startDateIdx = headers.findIndex((h) => String(h ?? '').toLowerCase().includes('start date'));
        const weekRow = rows.find((r) => (r as unknown[])[weekNoIdx] === weekStr) as unknown[] | undefined;
        const cell = weekRow?.[startDateIdx];
        if (cell != null && cell !== '') {
          if (typeof cell === 'number') {
            const excelEpoch = new Date(1899, 11, 30);
            requiredDate = new Date(excelEpoch.getTime() + cell * 24 * 60 * 60 * 1000);
          } else {
            const d = new Date(String(cell));
            if (!Number.isNaN(d.getTime())) requiredDate = d;
          }
        }
      }

      if (!requiredDate || Number.isNaN(requiredDate.getTime())) {
        const [weekNumRaw, yearRaw] = weekStr.split('.');
        const weekNum = Number(weekNumRaw);
        const year = Number(yearRaw);
        const yearStart = new Date(year, 0, 1);
        requiredDate = new Date(yearStart);
        requiredDate.setDate(requiredDate.getDate() + weekNum * 7);
      }

      const poDate = new Date(requiredDate);
      poDate.setDate(poDate.getDate() - (Number.isFinite(leadTimeDays) ? leadTimeDays : 0));
      return formatPoDate(poDate);
    } catch {
      return '-';
    }
  };

  const buildMaterialMasterMap = (headers: unknown[], rows: unknown[][]) => {
    const map = new Map<string, { mpq: number; moq: number; reorder: number; instock: number; pendingPo: number }>();
    const childPartIdx = 0;
    const mpqIdx = headers.findIndex((h) => String(h ?? '').toLowerCase().includes('mpq'));
    const moqIdx = headers.findIndex((h) => String(h ?? '').toLowerCase().includes('moq'));
    const reorderIdx = headers.findIndex((h) => String(h ?? '').toLowerCase().includes('reorder'));
    const instockIdx = headers.findIndex((h) => {
      const s = String(h ?? '').toLowerCase();
      return s.includes('instock') || s.includes('in stock');
    });
    const pendingPoIdx = headers.findIndex((h) => {
      const s = String(h ?? '').toLowerCase();
      return s.includes('pending po') || s.includes('pending_po');
    });

    rows.forEach((row) => {
      const material = String(row[childPartIdx] ?? '').trim();
      if (!material) return;
      map.set(material, {
        mpq: toNumber(row[mpqIdx]),
        moq: toNumber(row[moqIdx]),
        reorder: toNumber(row[reorderIdx]),
        instock: toNumber(row[instockIdx]),
        pendingPo: toNumber(row[pendingPoIdx]),
      });
    });

    return map;
  };

  const buildSupplierDetailsMap = (headers: unknown[], rows: unknown[][]) => {
    const map = new Map<string, { vendor: string; vendorLeadTime: number; transportTime: number; totalLeadTime: number }>();
    const materialIdx = 0;
    const vendorIdx = 1;
    const vendorLeadTimeIdx = headers.findIndex((h) => String(h ?? '').toLowerCase().includes('vendor lead-time'));
    const transportTimeIdx = headers.findIndex((h) => String(h ?? '').toLowerCase().includes('transport time'));

    rows.forEach((row) => {
      const material = String(row[materialIdx] ?? '').trim();
      if (!material) return;
      const vendor = String(row[vendorIdx] ?? '').trim();
      const vendorLeadTime = toNumber(row[vendorLeadTimeIdx]);
      const transportTime = toNumber(row[transportTimeIdx]);
      const totalLeadTime = vendorLeadTime + transportTime;

      if (!map.has(material) || (map.get(material)?.totalLeadTime ?? Number.POSITIVE_INFINITY) > totalLeadTime) {
        map.set(material, { vendor, vendorLeadTime, transportTime, totalLeadTime });
      }
    });

    return map;
  };

  const buildProductionDemandMap = (
    idpHeaders: unknown[],
    idpRows: unknown[][],
    bomHeaders: unknown[],
    bomRows: unknown[][],
    selectedWeeks: string[],
  ) => {
    const demandMap = new Map<string, Map<string, number>>();

    const bomDerivedMaterialIdx = bomHeaders.findIndex((h) => String(h ?? '').toLowerCase().includes('derived material'));
    const bomChildPartIdx = bomHeaders.findIndex((h) => String(h ?? '').toLowerCase().includes('child part'));
    const bomQtyIdx = bomHeaders.findIndex((h) => {
      const s = String(h ?? '').toLowerCase();
      return s.includes('quantity') || s.includes('per kit');
    });
    const idpDerivedMaterialIdx = idpHeaders.findIndex((h) => String(h ?? '').toLowerCase().includes('derived material'));

    const weekCols: { index: number; week: string }[] = [];
    idpHeaders.forEach((header, idx) => {
      const s = String(header ?? '').trim();
      if (s && /^\d{2}\.\d{4}$/.test(s) && selectedWeeks.includes(s)) {
        weekCols.push({ index: idx, week: s });
      }
    });

    const bomLookup = new Map<string, { childPart: string; quantity: number }[]>();
    bomRows.forEach((row) => {
      const derivedMaterial = String(row[bomDerivedMaterialIdx] ?? '').trim();
      const childPart = String(row[bomChildPartIdx] ?? '').trim();
      const qty = toNumber(row[bomQtyIdx]);
      if (!derivedMaterial || !childPart || qty <= 0) return;
      const arr = bomLookup.get(derivedMaterial) ?? [];
      arr.push({ childPart, quantity: qty });
      bomLookup.set(derivedMaterial, arr);
    });

    idpRows.forEach((row) => {
      const derivedMaterial = String(row[idpDerivedMaterialIdx] ?? '').trim();
      if (!derivedMaterial) return;
      const bomItems = bomLookup.get(derivedMaterial) ?? [];

      weekCols.forEach((wk) => {
        const productionQty = toNumber(row[wk.index]);
        if (productionQty <= 0) return;

        bomItems.forEach((item) => {
          const demandQty = productionQty * item.quantity;
          if (!demandMap.has(item.childPart)) demandMap.set(item.childPart, new Map());
          const weekMap = demandMap.get(item.childPart)!;
          weekMap.set(wk.week, (weekMap.get(wk.week) ?? 0) + demandQty);
        });
      });
    });

    return demandMap;
  };

  const lookupBomUom = (material: string, bomRows: unknown[][], childPartIdx: number, uomIdx: number) => {
    const row = bomRows.find((r) => String(r[childPartIdx] ?? '').trim() === material);
    return row ? String(row[uomIdx] ?? '').trim() : '';
  };

  const calculateMrpDataInternal = (inputs: {
    bom: ParsedExcel | null;
    materialMaster: ParsedExcel | null;
    idp: ParsedExcel | null;
    supplierDetails: ParsedExcel | null;
    weekPlan: ParsedExcel | null;
  }) => {
    const bom = inputs.bom;
    const materialMaster = inputs.materialMaster;
    const idp = inputs.idp;
    const supplierDetails = inputs.supplierDetails;
    const weekPlan = inputs.weekPlan;

    if (!bom?.jsonData?.length) {
      void Swal.fire({ icon: 'error', title: 'Data Error', text: 'BOM data is missing or empty' });
      return;
    }
    if (!idp?.jsonData?.length) {
      void Swal.fire({ icon: 'error', title: 'Data Error', text: 'Production Plan (IDP) data is missing or empty' });
      return;
    }
    if (!materialMaster?.jsonData?.length || !supplierDetails?.jsonData?.length) {
      void Swal.fire({ icon: 'error', title: 'Data Error', text: 'Material Master / Supplier Details data is missing' });
      return;
    }

    const bomAllRows = (bom.jsonData ?? []) as unknown[][];
    const bomHeaderRowIndex = findHeaderRowIndex(
      bomAllRows,
      [
        (row) => row.some((c) => normalizeHeaderValue(c).includes('child')),
        (row) => row.some((c) => normalizeHeaderValue(c).includes('derived')),
      ],
      10,
    );

    const bomHeaders = (bomAllRows[bomHeaderRowIndex] ?? []) as unknown[];
    const bomRows = bomAllRows.slice(bomHeaderRowIndex + 1) as unknown[][];

    const childPartIdx = findColumnIndex(bomHeaders, [
      (h) => h.includes('child part'),
      (h) => h === 'child',
      (h) => h === 'childpart',
      (h) => h.includes('childpart'),
      (h) => h.includes('component'),
      (h) => h.includes('comp part'),
    ]);

    const uomIdx = findColumnIndex(bomHeaders, [(h) => h === 'uom', (h) => h.includes(' uom'), (h) => h.includes('unit')]);

    if (childPartIdx === -1) {
      const headerPreview = bomHeaders
        .map((h) => String(h ?? '').trim())
        .filter(Boolean)
        .slice(0, 25)
        .join(', ');
      void Swal.fire({
        icon: 'error',
        title: 'Column Error',
        html: `Child Part column not found in BOM sheet.<br/><br/><div style="text-align:left"><strong>Sheet selected:</strong> ${escapeHtml(
          bom.sheetName,
        )}<br/><strong>Detected headers:</strong><br/>${escapeHtml(
          headerPreview || '(empty)',
        )}</div>`,
      });
      return;
    }

    const uniqueMaterials = [...new Set(bomRows.map((r) => String(r[childPartIdx] ?? '').trim()).filter(Boolean))];

    const mmHeaders = (materialMaster.jsonData[0] ?? []) as unknown[];
    const mmRows = materialMaster.jsonData.slice(1) as unknown[][];
    const sdHeaders = (supplierDetails.jsonData[0] ?? []) as unknown[];
    const sdRows = supplierDetails.jsonData.slice(1) as unknown[][];

    const idpHeaders = (idp.jsonData[0] ?? []) as unknown[];
    const idpRows = idp.jsonData.slice(1) as unknown[][];

    const allWeeks: string[] = [];
    idpHeaders.forEach((h) => {
      const s = String(h ?? '').trim();
      if (s && /^\d{2}\.\d{4}$/.test(s)) allWeeks.push(s);
    });

    const weeksInYear = allWeeks.filter((w) => w.split('.')[1] === selectedYear);
    const selectedWeeks = weeksInYear.filter((w) => {
      const num = Number(w.split('.')[0]);
      return num >= startWeek && num <= endWeek;
    });

    const materialMasterMap = buildMaterialMasterMap(mmHeaders, mmRows);
    const supplierDetailsMap = buildSupplierDetailsMap(sdHeaders, sdRows);
    const productionDemandMap = buildProductionDemandMap(idpHeaders, idpRows, bomHeaders, bomRows, selectedWeeks);

    const mrpData: MrpRow[] = uniqueMaterials.map((material) => {
      const mmInfo = materialMasterMap.get(material) ?? { mpq: 0, moq: 0, reorder: 0, instock: 0, pendingPo: 0 };
      const sdInfo = supplierDetailsMap.get(material) ?? { vendor: '', totalLeadTime: 0, vendorLeadTime: 0, transportTime: 0 };
      const demandByWeek = productionDemandMap.get(material) ?? new Map<string, number>();

      const weeklyDemand: Record<string, number> = {};
      const weeklyMrpQty: Record<string, number> = {};
      const weeklyPoDate: Record<string, string> = {};

      let totalDemand = 0;
      const excessQty = (mmInfo.instock || 0) + (mmInfo.pendingPo || 0);
      let remainingExcess = excessQty;

      demandByWeek.forEach((qty, week) => {
        weeklyDemand[week] = qty;

        if (selectedWeeks.includes(week)) {
          totalDemand += qty;
        }

        let requiredQty = 0;
        if (qty > 0) {
          let adjustedDemand = qty;

          if (remainingExcess > 0) {
            if (remainingExcess >= qty) {
              adjustedDemand = 0;
              remainingExcess -= qty;
            } else {
              adjustedDemand = qty - remainingExcess;
              remainingExcess = 0;
            }
          }

          if (adjustedDemand > 0) {
            if (mmInfo.reorder > 0) {
              requiredQty = mmInfo.reorder + adjustedDemand;
            } else if (mmInfo.moq > adjustedDemand) {
              requiredQty = mmInfo.moq;
            } else if (mmInfo.mpq > 0) {
              requiredQty = Math.ceil(adjustedDemand / mmInfo.mpq) * mmInfo.mpq;
            } else {
              requiredQty = adjustedDemand;
            }
          }
        }

        weeklyMrpQty[week] = requiredQty;
        weeklyPoDate[week] = calculatePoDate(week, sdInfo.totalLeadTime || 0, requiredQty, weekPlan);
      });

      return {
        material,
        uom: lookupBomUom(material, bomRows, childPartIdx, uomIdx),
        supplierCode: sdInfo.vendor || '',
        mpq: mmInfo.mpq || 0,
        moq: mmInfo.moq || 0,
        reorder: mmInfo.reorder || 0,
        instock: mmInfo.instock || 0,
        pendingPo: mmInfo.pendingPo || 0,
        excessQty,
        leadTime: sdInfo.totalLeadTime || 0,
        weeklyDemand,
        weeklyMrpQty,
        weeklyPoDate,
        totalDemand,
      };
    });

    setMrpCalculatedData(mrpData);
    setAllWeekColumns(allWeeks);
    setWeekColumns(selectedWeeks);

    const materialsWithDemand = mrpData.filter((m) => m.totalDemand > 0).length;
    void Swal.fire({
      icon: 'success',
      title: 'Calculation Complete',
      html: `
        <p><strong>MRP data calculated successfully!</strong></p>
        <ul style="text-align:left; margin:0; padding-left:16px">
          <li>Total materials: ${mrpData.length}</li>
          <li>Materials with demand: ${materialsWithDemand}</li>
          <li>Week range: Week ${startWeek} to Week ${endWeek} (${selectedWeeks.length} weeks)</li>
        </ul>
      `,
    });
  };

  const fetchAllData = async () => {
    setIsLoading(true);
    setMrpCalculatedData(null);
    try {
      const [bomRes, mmRes, idpRes, sdRes, wpRes] = await Promise.all([
        fetchDataSource('bom'),
        fetchDataSource('material_master'),
        fetchDataSource('idp'),
        fetchDataSource('supplier_details'),
        fetchDataSource('week_plan'),
      ]);

      if (bomRes.success && mmRes.success && idpRes.success && sdRes.success && wpRes.success) {
        calculateMrpDataInternal({
          bom: bomRes.data,
          materialMaster: mmRes.data,
          idp: idpRes.data,
          supplierDetails: sdRes.data,
          weekPlan: wpRes.data,
        });
      } else {
        void Swal.fire({
          icon: 'error',
          title: 'Data Load Failed',
          text: 'Failed to load one or more data sources (check uploads or backend).',
        });
      }
    } catch {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'An error occurred while loading data' });
    } finally {
      setIsLoading(false);
    }
  };

  const calculateMrp = async () => {
    if (!weekValidation.isValid) {
      await Swal.fire({ icon: 'warning', title: 'Invalid Week Range', text: weekValidation.message });
      return;
    }
    if (allWeekColumns.length) {
      const weeksInYear = allWeekColumns.filter((w) => w.split('.')[1] === selectedYear);
      const selectedWeeks = weeksInYear.filter((w) => {
        const num = Number(w.split('.')[0]);
        return num >= startWeek && num <= endWeek;
      });
      setWeekColumns(selectedWeeks);
    }
    await fetchAllData();
  };

  const exportToExcel = async () => {
    if (!mrpCalculatedData || mrpCalculatedData.length === 0) {
      await Swal.fire({ icon: 'warning', title: 'No Data', text: 'Please calculate MRP data first before exporting.' });
      return;
    }

    try {
      let filtered = mrpCalculatedData;
      let displayWeeks = weekColumns;

      if (searchMaterial) {
        filtered = filtered.filter((item) => item.material.toLowerCase().includes(searchMaterial.toLowerCase()));
      }

      if (poDateFrom && poDateTo) {
        const matchingWeeks = new Set<string>();
        filtered = filtered.filter((item) => {
          return weekColumns.some((week) => {
            const po = item.weeklyPoDate[week];
            const iso = po ? parsePoDateToIso(po) : null;
            if (!iso) return false;
            const match = iso >= poDateFrom && iso <= poDateTo;
            if (match) matchingWeeks.add(week);
            return match;
          });
        });
        if (matchingWeeks.size > 0) {
          displayWeeks = weekColumns.filter((w) => matchingWeeks.has(w));
        }
      }

      if (!filtered.length) {
        await Swal.fire({
          icon: 'warning',
          title: 'No Data to Export',
          text: 'No data matches the current filters. Please adjust your filters.',
        });
        return;
      }

      const aoa: unknown[][] = [];
      const headers = [
        'S.No',
        'Material',
        'UOM',
        'Supplier Code',
        'MPQ',
        'MOQ',
        'Reorder',
        'Instock',
        'Pending PO',
        'Lead Time (days)',
        'Total Demand',
      ];
      displayWeeks.forEach((week) => {
        headers.push(`${week} - MRP Qty`);
        headers.push(`${week} - PO Date`);
      });
      aoa.push(headers);

      filtered.forEach((item, idx) => {
        const row: unknown[] = [
          idx + 1,
          item.material,
          item.uom,
          item.supplierCode,
          item.mpq,
          item.moq,
          item.reorder,
          item.instock,
          item.pendingPo,
          item.leadTime,
          Number(item.totalDemand.toFixed(2)),
        ];
        displayWeeks.forEach((week) => {
          const mrpQty = item.weeklyMrpQty[week] ?? 0;
          const po = item.weeklyPoDate[week] ?? '-';
          row.push(mrpQty > 0 ? Number(mrpQty.toFixed(2)) : '-');
          row.push(po);
        });
        aoa.push(row);
      });

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'MRP Data');
      const filename = `MRP_Data_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;
      XLSX.writeFile(wb, filename, { compression: true });

      await Swal.fire({
        icon: 'success',
        title: 'Export Successful',
        text: `${filtered.length} material(s) exported`,
        timer: 2500,
      });
    } catch {
      await Swal.fire({ icon: 'error', title: 'Export Failed', text: 'An error occurred while exporting the data.' });
    }
  };

  const displayWeekColumns = useMemo(() => {
    if (!mrpCalculatedData) return weekColumns;
    if (!poDateFrom || !poDateTo) return weekColumns;
    const matching = new Set<string>();
    mrpCalculatedData.forEach((item) => {
      weekColumns.forEach((week) => {
        const po = item.weeklyPoDate[week];
        const iso = po ? parsePoDateToIso(po) : null;
        if (iso && iso >= poDateFrom && iso <= poDateTo) matching.add(week);
      });
    });
    return weekColumns.filter((w) => matching.has(w));
  }, [mrpCalculatedData, poDateFrom, poDateTo, weekColumns]);

  const filteredMrpData = useMemo(() => {
    if (!mrpCalculatedData) return null;
    let filtered = mrpCalculatedData;
    if (searchMaterial) {
      filtered = filtered.filter((item) => item.material.toLowerCase().includes(searchMaterial.toLowerCase()));
    }
    if (poDateFrom && poDateTo) {
      filtered = filtered.filter((item) => {
        return weekColumns.some((week) => {
          const po = item.weeklyPoDate[week];
          const iso = po ? parsePoDateToIso(po) : null;
          if (!iso) return false;
          return iso >= poDateFrom && iso <= poDateTo;
        });
      });
    }
    return filtered;
  }, [mrpCalculatedData, searchMaterial, poDateFrom, poDateTo, weekColumns]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-700 p-6 text-white shadow-sm">
        <div className="text-2xl font-semibold">MRP Data</div>
        <div className="mt-1 text-sm text-white/80">Load uploaded sources, calculate MRP, filter and export.</div>
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">BOM</div>
              <div className="mt-2 flex items-center justify-between">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${getStatusPillClass(loadingStatus.bom)}`}
                >
                  {getStatusText(loadingStatus.bom)}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Material Master</div>
              <div className="mt-2 flex items-center justify-between">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${getStatusPillClass(loadingStatus.materialMaster)}`}
                >
                  {getStatusText(loadingStatus.materialMaster)}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">IDP</div>
              <div className="mt-2 flex items-center justify-between">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${getStatusPillClass(loadingStatus.idp)}`}
                >
                  {getStatusText(loadingStatus.idp)}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Supplier Details</div>
              <div className="mt-2 flex items-center justify-between">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${getStatusPillClass(loadingStatus.supplierDetails)}`}
                >
                  {getStatusText(loadingStatus.supplierDetails)}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Week Plan</div>
              <div className="mt-2 flex items-center justify-between">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${getStatusPillClass(loadingStatus.weekPlan)}`}
                >
                  {getStatusText(loadingStatus.weekPlan)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void calculateMrp()}
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isLoading || !weekValidation.isValid}
            >
              {isLoading ? 'Loading...' : 'Calculate MRP'}
            </button>
            <button
              type="button"
              onClick={() => void exportToExcel()}
              className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isLoading || !mrpCalculatedData?.length}
            >
              Export
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Year</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Start Week</label>
            <input
              type="number"
              min={1}
              max={53}
              value={startWeekText}
              onChange={(e) => {
                const v = e.target.value;
                setStartWeekText(v);
                if (!v) return;
                const n = Number(v);
                if (!Number.isFinite(n)) return;
                setStartWeek(clampWeek(Math.floor(n)));
              }}
              onBlur={() => {
                if (!startWeekText.trim()) {
                  setStartWeekText(String(startWeek));
                  return;
                }
                commitStartWeek();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitStartWeek();
                  if (weekValidation.isValid) void calculateMrp();
                }
              }}
              className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            />
            {!weekValidation.isValid ? <div className="mt-1 text-xs text-red-600">{weekValidation.message}</div> : null}
          </div>

          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">End Week</label>
            <input
              type="number"
              min={1}
              max={53}
              value={endWeekText}
              onChange={(e) => {
                const v = e.target.value;
                setEndWeekText(v);
                if (!v) return;
                const n = Number(v);
                if (!Number.isFinite(n)) return;
                setEndWeek(clampWeek(Math.floor(n)));
              }}
              onBlur={() => {
                if (!endWeekText.trim()) {
                  setEndWeekText(String(endWeek));
                  return;
                }
                commitEndWeek();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitEndWeek();
                  if (weekValidation.isValid) void calculateMrp();
                }
              }}
              className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </div>

          <div className="lg:col-span-6">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Search Material</label>
            <input
              value={searchMaterial}
              onChange={(e) => setSearchMaterial(e.target.value)}
              placeholder="Type material..."
              className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </div>

          <div className="lg:col-span-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">PO Date Range</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                type="date"
                value={poDateFrom}
                onChange={(e) => setPoDateFrom(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={poDateTo}
                onChange={(e) => setPoDateTo(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="lg:col-span-4 lg:flex lg:items-end">
            <button
              type="button"
              onClick={() => {
                setSearchMaterial('');
                setPoDateFrom('');
                setPoDateTo('');
              }}
              className="mt-6 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Calculated MRP</div>
            <div className="mt-1 text-sm text-slate-600">{filteredMrpData ? `${filteredMrpData.length} row(s)` : 'No data yet'}</div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="sticky left-0 z-20 border-b border-slate-200 bg-white px-3 py-2">#</th>
                <th className="sticky left-10 z-20 border-b border-slate-200 bg-white px-3 py-2">Material</th>
                <th className="border-b border-slate-200 px-3 py-2">UOM</th>
                <th className="border-b border-slate-200 px-3 py-2">Supplier</th>
                <th className="border-b border-slate-200 px-3 py-2">MPQ</th>
                <th className="border-b border-slate-200 px-3 py-2">MOQ</th>
                <th className="border-b border-slate-200 px-3 py-2">Reorder</th>
                <th className="border-b border-slate-200 px-3 py-2">Instock</th>
                <th className="border-b border-slate-200 px-3 py-2">Pending PO</th>
                <th className="border-b border-slate-200 px-3 py-2">Lead Time</th>
                <th className="border-b border-slate-200 px-3 py-2">Total Demand</th>
                {displayWeekColumns.map((week) => (
                  <th key={week} className="border-b border-slate-200 px-3 py-2">
                    {week}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!filteredMrpData || filteredMrpData.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-sm text-slate-600" colSpan={11 + displayWeekColumns.length}>
                    No data to display
                  </td>
                </tr>
              ) : (
                filteredMrpData.map((row, idx) => (
                  <tr key={`${row.material}-${idx}`} className="text-sm">
                    <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-2 text-slate-600">{idx + 1}</td>
                    <td className="sticky left-10 z-10 border-b border-slate-100 bg-white px-3 py-2 font-medium text-slate-900">
                      {row.material}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">{row.uom}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">{row.supplierCode}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">{row.mpq}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">{row.moq}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">{row.reorder}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">{row.instock}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">{row.pendingPo}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">{row.leadTime}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-slate-700">{row.totalDemand.toFixed(2)}</td>
                    {displayWeekColumns.map((week) => {
                      const mrpQty = row.weeklyMrpQty[week] ?? 0;
                      const po = row.weeklyPoDate[week] ?? '-';
                      return (
                        <td key={`${row.material}-${week}`} className="border-b border-slate-100 px-3 py-2">
                          <div className="text-slate-900">{mrpQty > 0 ? mrpQty.toFixed(2) : '-'}</div>
                          <div className="text-xs text-slate-500">{po}</div>
                        </td>
                      );
                    })}
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
