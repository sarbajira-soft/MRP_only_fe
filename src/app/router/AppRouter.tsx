import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from '../layout/AppLayout';
import RequireAuth from '../auth/RequireAuth';
import LoginPage from '../../pages/LoginPage';
import MrpDashboardPage from '../../pages/mrp/MrpDashboardPage';
import UploadBomPage from '../../pages/mrp/UploadBomPage';
import UploadIdpPage from '../../pages/mrp/UploadIdpPage';
import UploadMaterialMasterPage from '../../pages/mrp/UploadMaterialMasterPage';
import UploadSupplierDetailsPage from '../../pages/mrp/UploadSupplierDetailsPage';
import UploadWeekPlanPage from '../../pages/mrp/UploadWeekPlanPage';
import MrpDataPage from '../../pages/mrp/MrpDataPage';
import NotFoundPage from '../../pages/NotFoundPage';

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />

      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/mrp" element={<MrpDashboardPage />} />
        <Route path="/mrp/upload-bom" element={<UploadBomPage />} />
        <Route path="/mrp/upload-material-master" element={<UploadMaterialMasterPage />} />
        <Route path="/mrp/upload-idp" element={<UploadIdpPage />} />
        <Route path="/mrp/upload-supplier-details" element={<UploadSupplierDetailsPage />} />
        <Route path="/mrp/upload-week-plan" element={<UploadWeekPlanPage />} />
        <Route path="/mrp/mrp-data" element={<MrpDataPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
