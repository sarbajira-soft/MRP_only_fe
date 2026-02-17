import { http } from '../api/http';
import type { AuthUser } from './session';

export type LoginResponse = {
  success: boolean;
  message?: string;
  data?: {
    id: string | number;
    username: string;
    displayName?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
};

export async function loginApi(params: { username: string; password: string }): Promise<AuthUser> {
  const username = (params.username || '').toString().trim();
  const password = (params.password || '').toString();

  const res = await http.post<LoginResponse>('/api/login', {
    username,
    password,
  });

  const body = res.data;
  if (!body?.success || !body.data) {
    const msg = body?.error?.message || 'Login failed';
    throw new Error(msg);
  }

  return {
    id: body.data.id,
    username: body.data.username,
    displayName: body.data.displayName,
  };
}
