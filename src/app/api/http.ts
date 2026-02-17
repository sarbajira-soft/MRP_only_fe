import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL as string | undefined;

export const http = axios.create({
  baseURL: baseURL || undefined,
});
