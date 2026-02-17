export type AuthUser = {
  id: string | number;
  username: string;
  displayName?: string;
};

const STORAGE_KEY = 'mrp:auth:user:v1';

export function getAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.username) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setAuthUser(user: AuthUser) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function clearAuthUser() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isAuthenticated() {
  return Boolean(getAuthUser());
}
