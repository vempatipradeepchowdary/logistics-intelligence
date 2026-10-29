import { useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatNumber } from '../../utils/format.js';

// Validated palette (see README "Design system"): one primary series hue, reserved status hues,
// and a single-hue sequential ramp for ordinal magnitude (e.g. severity 1-5).
/** Axis label for minute values: whole or half hours, e.g. 90 -> "1.5h". */
export const hoursTick = (minutes) => `${Number((minutes / 60).toFixed(minutes % 60 ? 1 : 0))}h`;

export const CHART = {
  primary: '#315CF5',
  primarySoft: '#BCCBFB',
  good: '#00977F',
  warn: '#C77D0A',
  crit: '#D23F57',
  neutral: '#8A95A8',
  ink: '#172033',
  sequential: ['#C9D6FD', '#93ADFA', '#5C82F7', '#315CF5', '#1D3BB0'],
};

const axisProps = { tickLine: false, axisLine: false, tickMargin: 6 };

/** Chart container with title, accessible summary and a data-table alternative view. */
export function ChartFrame({ title, summary, table, height = 260, children, actions }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="m-0">
      <div className="mb-2 flex items-start justify-between gap-2">
        {title && <figcaption className="text-[12.5px] font-medium text-ink-2">{title}</figcaption>}
        <div className="ml-auto flex items-center gap-1">
          {actions}
          {table && (
            <button
              type="button"
              onClick={() => setAsTable((v) => !v)}
              className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-[11.5px] text-muted hover:bg-subtle hover:text-ink"
              aria-pressed={asTable}
            >
              {asTable ? <BarChart3 className="size-3" aria-hidden /> : <Table2 className="size-3" aria-hidden />}
              {asTable ? 'Chart' : 'Table'}
            </button>
          )}
        </div>
      </div>
      {summary && <p className="sr-only">{summary}</p>}
      {asTable && table ? (
        <div className="max-h-[320px] overflow-auto rounded-md border border-line">
          <table className="table-base text-[12px]">
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j} className={j ? 'num text-right' : ''}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }} aria-hidden={Boolean(summary)}>
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}

export function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter = formatNumber }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-2.5 py-2 text-[12px] shadow-[var(--shadow-pop)]">
      {label !== undefined && <p className="mb-1 font-medium text-ink">{labelFormatter ? labelFormatter(label) : label}</p>}
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={p.dataKey ?? p.name} className="flex items-center gap-2 text-ink-2">
            <span className="size-2 rounded-[2px]" style={{ background: p.color ?? p.fill }} aria-hidden />
            <span>{p.name}</span>
            <span className="num ml-auto pl-3 font-medium text-ink">{valueFormatter(p.value, p)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars, one hue (magnitude by category), value labels at bar ends. */
export function HBarChart({ data, labelKey, valueKey, name, color = CHART.primary, valueFormatter = formatNumber, axisFormatter, width, height, onBarClick, labelWidth = 130 }) {
  return (
    <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }} width={width} height={height}>
      <CartesianGrid horizontal={false} />
      <XAxis type="number" {...axisProps} tickFormatter={axisFormatter ?? ((v) => formatNumber(v, { compact: true }))} />
      <YAxis type="category" dataKey={labelKey} width={labelWidth} {...axisProps} tick={{ fontSize: 11.5, fill: '#3c475b' }} />
      <Tooltip cursor={{ fill: '#f1f4f9' }} content={<ChartTooltip valueFormatter={valueFormatter} />} />
      <Bar
        dataKey={valueKey}
        name={name}
        fill={color}
        radius={[0, 4, 4, 0]}
        maxBarSize={18}
        onClick={onBarClick ? (d) => onBarClick(d.payload ?? d) : undefined}
        cursor={onBarClick ? 'pointer' : undefined}
      >
        <LabelList dataKey={valueKey} position="right" formatter={valueFormatter} className="num" fill="#3c475b" fontSize={11} />
      </Bar>
    </BarChart>
  );
}

export function TimeAreaChart({ data, xKey, series, xFormatter, valueFormatter = formatNumber, yFormatter, width, height }) {
  return (
    <AreaChart data={data} width={width} height={height} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
      <defs>
        {series.map((s) => (
          <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={s.color} stopOpacity={0.01} />
          </linearGradient>
        ))}
      </defs>
      <CartesianGrid vertical={false} />
      <XAxis dataKey={xKey} {...axisProps} tickFormatter={xFormatter} minTickGap={28} />
      <YAxis {...axisProps} width={48} tickFormatter={yFormatter ?? ((v) => formatNumber(v, { compact: true }))} />
      <Tooltip content={<ChartTooltip labelFormatter={xFormatter} valueFormatter={valueFormatter} />} />
      {series.length > 1 && <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 12 }} />}
      {series.map((s) => (
        <Area
          key={s.key}
          type="monotone"
          dataKey={s.key}
          name={s.name}
          stroke={s.color}
          strokeWidth={2}
          fill={`url(#fill-${s.key})`}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
          isAnimationActive={false}
        />
      ))}
    </AreaChart>
  );
}

export function TimeLineChart({ data, xKey, series, xFormatter, valueFormatter = formatNumber, yFormatter, referenceY, curve = 'monotone', width, height }) {
  return (
    <LineChart data={data} width={width} height={height} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
      <CartesianGrid vertical={false} />
      <XAxis dataKey={xKey} {...axisProps} tickFormatter={xFormatter} minTickGap={28} />
      <YAxis {...axisProps} width={52} tickFormatter={yFormatter ?? ((v) => formatNumber(v, { compact: true }))} />
      <Tooltip content={<ChartTooltip labelFormatter={xFormatter} valueFormatter={valueFormatter} />} />
      {series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />}
      {referenceY !== undefined && <ReferenceLine y={referenceY} stroke={CHART.neutral} strokeDasharray="3 3" />}
      {series.map((s) => (
        <Line
          key={s.key}
          type={curve}
          dataKey={s.key}
          name={s.name}
          stroke={s.color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
          isAnimationActive={false}
        />
      ))}
    </LineChart>
  );
}

/** Vertical bars (stacked when several series share stackId). */
export function ColumnChart({ data, xKey, series, xFormatter, valueFormatter = formatNumber, yFormatter, stacked = false, colorFor, width, height }) {
  return (
    <BarChart data={data} width={width} height={height} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
      <CartesianGrid vertical={false} />
      <XAxis dataKey={xKey} {...axisProps} tickFormatter={xFormatter} minTickGap={12} interval="preserveStartEnd" />
      <YAxis {...axisProps} width={48} tickFormatter={yFormatter ?? ((v) => formatNumber(v, { compact: true }))} />
      <Tooltip cursor={{ fill: '#f1f4f9' }} content={<ChartTooltip labelFormatter={xFormatter} valueFormatter={valueFormatter} />} />
      {series.length > 1 && <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 12 }} />}
      {series.map((s, idx) => (
        <Bar
          key={s.key}
          dataKey={s.key}
          name={s.name}
          fill={s.color}
          stackId={stacked ? 'stack' : undefined}
          radius={!stacked || idx === series.length - 1 ? [3, 3, 0, 0] : 0}
          stroke={stacked ? '#fff' : undefined}
          strokeWidth={stacked ? 1 : 0}
          maxBarSize={36}
          isAnimationActive={false}
        >
          {colorFor && data.map((d, i) => <Cell key={i} fill={colorFor(d)} />)}
        </Bar>
      ))}
    </BarChart>
  );
}

export function PredictedActualScatter({ data, onPointClick, width, height }) {
  const max = Math.ceil(Math.max(24, ...data.map((d) => Math.max(d.actualHours, d.predictedHours))) / 24) * 24;
  return (
    <ScatterChart width={width} height={height} margin={{ top: 8, right: 12, bottom: 18, left: 4 }}>
      <CartesianGrid />
      <XAxis
        type="number"
        dataKey="actualHours"
        name="Actual time to delivery"
        unit="h"
        domain={[0, max]}
        {...axisProps}
        label={{ value: 'Actual hours to delivery', position: 'insideBottom', offset: -10, fontSize: 11, fill: '#5e6b80' }}
      />
      <YAxis
        type="number"
        dataKey="predictedHours"
        name="Predicted time to delivery"
        unit="h"
        domain={[0, max]}
        width={52}
        {...axisProps}
        label={{ value: 'Predicted hours', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#5e6b80' }}
      />
      <ReferenceLine
        segment={[
          { x: 0, y: 0 },
          { x: max, y: max },
        ]}
        stroke={CHART.neutral}
        strokeDasharray="4 4"
        ifOverflow="extendDomain"
      />
      <Tooltip
        cursor={{ strokeDasharray: '3 3' }}
        content={({ active, payload }) =>
          active && payload?.length ? (
            <div className="rounded-md border border-line bg-surface px-2.5 py-2 text-[12px] shadow-[var(--shadow-pop)]">
              <p className="id-mono mb-1 text-ink">{payload[0].payload.etaId}</p>
              <p className="num text-ink-2">Predicted {payload[0].payload.predictedHours}h · Actual {payload[0].payload.actualHours}h</p>
            </div>
          ) : null
        }
      />
      <Scatter
        data={data}
        fill={CHART.primary}
        fillOpacity={0.55}
        stroke="#fff"
        strokeWidth={1}
        onClick={onPointClick ? (p) => onPointClick(p.payload ?? p) : undefined}
        cursor={onPointClick ? 'pointer' : undefined}
        isAnimationActive={false}
      />
    </ScatterChart>
  );
}
