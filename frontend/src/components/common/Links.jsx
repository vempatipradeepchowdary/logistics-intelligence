import { Link } from 'react-router-dom';

const base = 'id-mono text-cobalt-700 hover:text-cobalt-800 hover:underline underline-offset-2';

export const ShipmentLink = ({ id }) =>
  id ? (
    <Link to={`/shipments/${id}`} className={base}>
      {id}
    </Link>
  ) : (
    '—'
  );

export const FacilityLink = ({ id, label }) =>
  id ? (
    <Link to={`/facilities/${id}`} className={label ? 'text-cobalt-700 hover:underline underline-offset-2' : base}>
      {label ?? id}
    </Link>
  ) : (
    '—'
  );

export const DisruptionLink = ({ id }) =>
  id ? (
    <Link to={`/disruptions/${id}`} className={base}>
      {id}
    </Link>
  ) : (
    '—'
  );

export const EtaLink = ({ id, children }) =>
  id ? (
    <Link to={`/eta/${encodeURIComponent(id)}`} className={children ? 'text-cobalt-700 hover:underline underline-offset-2' : base}>
      {children ?? id}
    </Link>
  ) : (
    '—'
  );

export const Mono = ({ children, className = '' }) => <span className={`id-mono text-ink-2 ${className}`}>{children ?? '—'}</span>;
