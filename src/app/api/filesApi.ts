import { http } from './http';

export type FileRecord = {
  id: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  bucket: string;
  s3_key: string;
  etag: string | null;
  created_at: string;
};

type ApiResponse<T> = {
  success: boolean;
  data: T;
  meta?: unknown;
};

function safeString(v: unknown) {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function parseS3Path(s3Path: string) {
  // s3://bucket/key
  const trimmed = safeString(s3Path).trim();
  if (!trimmed.startsWith('s3://')) return null;
  const without = trimmed.slice('s3://'.length);
  const firstSlash = without.indexOf('/');
  if (firstSlash === -1) return null;
  const bucket = without.slice(0, firstSlash);
  const key = without.slice(firstSlash + 1);
  return { bucket, key };
}

function fileNameFromKey(key: string) {
  const parts = safeString(key).split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function normalizeToFileRecord(item: any): FileRecord {
  // Supports both canonical API records and simplified records:
  // { id, original_name, created_at, ... }
  // { id, s3_upload_path, uploaded_at, ... }
  const rawId = item?.id;
  const id = safeString(rawId);

  const originalName = safeString(item?.original_name || item?.file_name || item?.fileName);
  const createdAt = safeString(item?.created_at || item?.uploaded_at || item?.uploadedAt);

  const s3 = parseS3Path(safeString(item?.s3_upload_path || item?.s3Path));
  const bucket = safeString(item?.bucket || item?.Bucket || s3?.bucket);
  const s3_key = safeString(item?.s3_key || item?.s3Key || item?.key || s3?.key);

  return {
    id,
    original_name: originalName || fileNameFromKey(s3_key) || fileNameFromKey(s3?.key ?? '') || id,
    content_type: safeString(item?.content_type || item?.mime_type || item?.mimeType || ''),
    size_bytes: Number(item?.size_bytes ?? item?.size ?? 0) || 0,
    bucket: bucket || safeString(s3?.bucket),
    s3_key: s3_key || safeString(s3?.key),
    etag: item?.etag ?? null,
    created_at: createdAt || new Date(0).toISOString(),
  };
}

function base64ToArrayBuffer(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function tryDecodeJsonArrayBuffer(buf: ArrayBuffer) {
  try {
    const text = new TextDecoder('utf-8').decode(new Uint8Array(buf));
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

export const filesApi = {
  async upload(file: File, type: string) {
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);

    const res = await http.post<ApiResponse<FileRecord>>('/api/files/upload', form, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return res.data.data;
  },

  async list(params?: { type?: string; limit?: number; offset?: number }) {
    const res = await http.get<ApiResponse<unknown>>('/api/files', { params });
    const data = res.data?.data;

    let items: unknown[] | null = null;

    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === 'object') {
      const maybeItems = (data as { items?: unknown; files?: unknown }).items ?? (data as { files?: unknown }).files;
      if (Array.isArray(maybeItems)) items = maybeItems;
    }

    if (!items) return [] as FileRecord[];
    return items.map((i) => normalizeToFileRecord(i));
  },

  async downloadArrayBuffer(id: string, type?: string) {
    const res = await http.get<ArrayBuffer>(`/api/files/${encodeURIComponent(id)}/download`, {
      params: {
        ...(type ? { type } : null),
        _ts: Date.now(),
      },
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      responseType: 'arraybuffer',
    });

    const contentType = String(res.headers?.['content-type'] ?? '').toLowerCase();
    const data = res.data;

    const maybeJson = contentType.includes('application/json') ? tryDecodeJsonArrayBuffer(data) : null;
    const json = maybeJson ?? tryDecodeJsonArrayBuffer(data);

    if (json && typeof json === 'object') {
      const content = (json as any)?.data?.fileData?.content;
      if (typeof content === 'string' && content.length > 0) {
        return base64ToArrayBuffer(content);
      }
    }

    return data;
  },

  async remove(id: string, type?: string) {
    if (type) {
      const res = await http.delete<ApiResponse<{ id: string }>>(
        `/api/delete/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
      );
      return res.data.data;
    }

    const res = await http.delete<ApiResponse<{ id: string }>>(`/api/files/${encodeURIComponent(id)}`);
    return res.data.data;
  },

  downloadUrl(id: string) {
    const base = `${http.defaults.baseURL ?? ''}/api/files/${encodeURIComponent(id)}/download`;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}_ts=${Date.now()}`;
  },
};
