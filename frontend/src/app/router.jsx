import { lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell.jsx';
import { RouteErrorPage } from '../pages/RouteErrorPage.jsx';

const page = (loader) => lazy(loader);

const DashboardPage = page(() => import('../pages/DashboardPage.jsx'));
const ShipmentsPage = page(() => import('../pages/ShipmentsPage.jsx'));
const ShipmentDetailPage = page(() => import('../pages/ShipmentDetailPage.jsx'));
const TrackingEventsPage = page(() => import('../pages/TrackingEventsPage.jsx'));
const ETAIntelligencePage = page(() => import('../pages/ETAIntelligencePage.jsx'));
const EtaDetailPage = page(() => import('../pages/EtaDetailPage.jsx'));
const DelayAnalysisPage = page(() => import('../pages/DelayAnalysisPage.jsx'));
const FacilitiesPage = page(() => import('../pages/FacilitiesPage.jsx'));
const FacilityDetailPage = page(() => import('../pages/FacilityDetailPage.jsx'));
const DisruptionsPage = page(() => import('../pages/DisruptionsPage.jsx'));
const DisruptionDetailPage = page(() => import('../pages/DisruptionDetailPage.jsx'));
const DataQualityPage = page(() => import('../pages/DataQualityPage.jsx'));
const DatasetGeneratorPage = page(() => import('../pages/DatasetGeneratorPage.jsx'));
const ExportsPage = page(() => import('../pages/ExportsPage.jsx'));
const SettingsPage = page(() => import('../pages/SettingsPage.jsx'));
const NotFoundPage = page(() => import('../pages/NotFoundPage.jsx'));

export const routes = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'shipments', element: <ShipmentsPage /> },
      { path: 'shipments/:id', element: <ShipmentDetailPage /> },
      { path: 'tracking', element: <TrackingEventsPage /> },
      { path: 'eta', element: <ETAIntelligencePage /> },
      { path: 'eta/:id', element: <EtaDetailPage /> },
      { path: 'delays', element: <DelayAnalysisPage /> },
      { path: 'facilities', element: <FacilitiesPage /> },
      { path: 'facilities/:id', element: <FacilityDetailPage /> },
      { path: 'disruptions', element: <DisruptionsPage /> },
      { path: 'disruptions/:id', element: <DisruptionDetailPage /> },
      { path: 'data-quality', element: <DataQualityPage /> },
      { path: 'generator', element: <DatasetGeneratorPage /> },
      { path: 'exports', element: <ExportsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
