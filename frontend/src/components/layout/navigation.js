import {
  CloudLightning,
  Database,
  Download,
  Gauge,
  LayoutDashboard,
  Package,
  Radio,
  Settings,
  ShieldCheck,
  Timer,
  Warehouse,
} from 'lucide-react';

export const NAV_SECTIONS = [
  {
    label: 'Operations',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/shipments', label: 'Shipments', icon: Package },
      { to: '/tracking', label: 'Tracking Events', icon: Radio },
      { to: '/facilities', label: 'Facilities', icon: Warehouse },
      { to: '/disruptions', label: 'Disruptions', icon: CloudLightning },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/eta', label: 'ETA Intelligence', icon: Gauge },
      { to: '/delays', label: 'Delay Analysis', icon: Timer },
      { to: '/data-quality', label: 'Data Quality', icon: ShieldCheck },
    ],
  },
  {
    label: 'Data platform',
    items: [
      { to: '/generator', label: 'Dataset Generator', icon: Database },
      { to: '/exports', label: 'Exports', icon: Download },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

/** Breadcrumb labels for the first path segment. */
export const SECTION_LABELS = {
  '': 'Overview',
  shipments: 'Shipments',
  tracking: 'Tracking Events',
  facilities: 'Facilities',
  disruptions: 'Disruptions',
  eta: 'ETA Intelligence',
  delays: 'Delay Analysis',
  'data-quality': 'Data Quality',
  generator: 'Dataset Generator',
  exports: 'Exports',
  settings: 'Settings',
};
