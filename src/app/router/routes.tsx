import type { ReactNode } from 'react';

export type AppRoute = {
  label: string;
  path: string;
  icon?: ReactNode;
};

export const mrpRoutes: AppRoute[] = [
  { label: 'Dashboard', path: '/mrp' },
  { label: 'Upload BOM', path: '/mrp/upload-bom' },
  { label: 'Upload Material Master', path: '/mrp/upload-material-master' },
  { label: 'Upload IDP', path: '/mrp/upload-idp' },
  { label: 'Upload Supplier Details', path: '/mrp/upload-supplier-details' },
  { label: 'Upload Week Plan', path: '/mrp/upload-week-plan' },
  { label: 'MRP Data', path: '/mrp/mrp-data' },
];
