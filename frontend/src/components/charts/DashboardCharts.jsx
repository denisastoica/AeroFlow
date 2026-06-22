import React, { useState, useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, Cell, PieChart, Pie, ReferenceLine, BarChart, Bar
} from "recharts";
import { parseBackendDateTime } from "../../utils/datetime";

const COLORS = ['#ff4d6d', '#ffd166', '#ff8c42', '#6ae4ff', '#8884d8', '#a855f7'];

export function SuccessRateChart({ data = [], globalSuccess, globalFailed, globalRate, timeWindowLabel }) {
    const ts = data.reduce((sum, item) => sum + (item.success || item.successful || 0), 0);
  const tf = data.reduce((sum, item) => sum + (item.failed || 0), 0);
  const totalSuccess = globalSuccess !== undefined ? globalSuccess : ts;
  const totalFailed = globalFailed !== undefined ? globalFailed : tf;
  const totalDeliveries = totalSuccess + totalFailed;
  const successRate = globalRate !== undefined ? globalRate : (totalDeliveries > 0 ? ((totalSuccess / totalDeliveries) * 100).toFixed(1) : 0);

  const peakPoint = [...data].sort((a, b) => (b.success || b.successful || 0) - (a.success || a.successful || 0))[0];
  const peakValue = peakPoint ? (peakPoint.success || peakPoint.successful || 0) : 0;
  const toDisplayDate = (value, options) => {
    const d = parseBackendDateTime(value);
    return d ? d.toLocaleDateString([], options) : value;
  };
  const peakDate = peakPoint
    ? toDisplayDate(peakPoint.date, { month: 'short', day: 'numeric' })
    : null;

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const success = payload[0].value;
      const failed = payload[1].value;
      const total = success + failed;
      const rate = total > 0 ? ((success / total) * 100).toFixed(1) : 0;

      return (
        <div style={{
          background: '#1a263e',
          border: '1px solid rgba(255,255,255,0.15)',
          padding: '12px',
          borderRadius: '8px',
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          fontSize: '12px'
        }}>
          <div style={{ fontWeight: 800, marginBottom: 10, color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 6 }}>
            {toDisplayDate(label, { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
              <span style={{ color: '#33d69f', fontWeight: 600 }}>Success:</span>
              <span style={{ fontWeight: 800 }}>{success}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
              <span style={{ color: '#ff4d6d', fontWeight: 600 }}>Failed:</span>
              <span style={{ fontWeight: 800 }}>{failed}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <span style={{ color: '#fff', fontWeight: 700 }}>Total:</span>
              <span style={{ fontWeight: 800 }}>{total}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
              <span style={{ color: '#ffd166', fontWeight: 700 }}>Success Rate:</span>
              <span style={{ fontWeight: 900, color: '#ffd166' }}>{rate}%</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomizedDot = (props) => {
    const { cx, cy, payload } = props;
    const val = payload.success || payload.successful || 0;
    if (val === peakValue && peakValue > 0) {
      return (
        <g>
          <circle cx={cx} cy={cy} r={6} fill="#33d69f" stroke="#fff" strokeWidth={2} />
          <text x={cx} y={cy - 15} textAnchor="middle" fill="#33d69f" fontSize={10} fontWeight={900} style={{ letterSpacing: '0.5px' }}>PEAK</text>
        </g>
      );
    }
    return <circle cx={cx} cy={cy} r={3} fill="#33d69f" />;
  };

  return (
    <div style={{ padding: '12px 8px 4px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Delivery Throughput</h3>
          </div>
          <div style={{ marginTop: 3, fontSize: 11, color: 'rgba(255,255,255,0.48)', fontWeight: 600 }}>
            {timeWindowLabel || 'Last 7 days'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 8 }}>
            <div style={{ fontSize: 11 }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>Success: </span>
              <span style={{ fontWeight: 700, color: '#33d69f' }}>{totalSuccess}</span>
            </div>
            <div style={{ fontSize: 11 }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>Fail: </span>
              <span style={{ fontWeight: 700, color: '#ff4d6d' }}>{totalFailed}</span>
            </div>
            <div style={{ fontSize: 11 }} title="Calculated as delivered / (delivered + failed). Cancelled and pending orders are excluded.">
              <span style={{ color: 'rgba(255,255,255,0.4)', cursor: 'help', borderBottom: '1px dashed rgba(255,255,255,0.25)' }}>Rate: </span>
              <span style={{ fontWeight: 700, color: '#ffd166' }}>{successRate}%</span>
            </div>
            {peakDate && (
              <div style={{ fontSize: 11 }}>
                <span style={{ color: 'rgba(255,255,255,0.4)' }}>Peak: </span>
                <span style={{ fontWeight: 700 }}>{peakDate}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 180, marginLeft: -25 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 15, right: 10, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="colorSuccess" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#33d69f" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#33d69f" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="rgba(255,255,255,0.3)"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(str) => toDisplayDate(str, { month: 'short', day: 'numeric' })}
            />
            <YAxis
              stroke="rgba(255,255,255,0.3)"
              fontSize={10}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }} />
            <ReferenceLine y={20} stroke="rgba(51, 214, 159, 0.2)" strokeDasharray="3 3" label={{ value: 'Target', fill: 'rgba(51, 214, 159, 0.4)', fontSize: 9, position: 'insideTopRight' }} />
            <Area
              type="monotone"
              dataKey={data[0]?.successful !== undefined ? "successful" : "success"}
              stroke="#33d69f"
              strokeWidth={3}
              fillOpacity={1}
              fill="url(#colorSuccess)"
              dot={<CustomizedDot />}
              activeDot={{ r: 5, strokeWidth: 0, fill: '#fff' }}
            />
            <Area
              type="monotone"
              dataKey="failed"
              stroke="#ff3355"
              strokeWidth={2.5}
              strokeDasharray="4 4"
              fill="transparent"
              dot={{ r: 2.5, fill: '#ff3355', strokeWidth: 0, opacity: 0.8 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function FailureReasonsChart({ data = [] }) {
    const sortedData = useMemo(() => {
    return [...data].sort((a, b) => b.value - a.value);
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <div className="card" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="subtle">No failure data available</div>
      </div>
    );
  }

  const topCause = sortedData[0]?.name;
  const secondCause = sortedData[1]?.name;

  const CustomPieTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const p = payload[0].payload;
      return (
        <div style={{
          background: '#1a263e',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '10px 14px',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          fontSize: '12px'
        }}>
          <div style={{ fontWeight: 800, color: payload[0].payload.fill, marginBottom: 4 }}>{p.name}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ opacity: 0.7 }}>Share:</span>
            <span style={{ fontWeight: 700 }}>{p.value}%</span>
          </div>
          {p.count != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <span style={{ opacity: 0.7 }}>Occurrences:</span>
              <span style={{ fontWeight: 700 }}>{p.count} cases</span>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ padding: '12px 8px 4px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Mission Failure Breakdown</h3>
        <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
          {topCause && (
            <div style={{ fontSize: 11 }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>Top Cause: </span>
              <span style={{ fontWeight: 700, color: COLORS[0] }}>{topCause}</span>
            </div>
          )}
          {secondCause && (
            <div style={{ fontSize: 11 }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>Secondary: </span>
              <span style={{ fontWeight: 700, color: COLORS[1] }}>{secondCause}</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 24, minHeight: 180, justifyContent: 'center' }}>
        <div style={{ width: '45%', height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={sortedData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={4}
                dataKey="value"
                stroke="none"
              >
                {sortedData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomPieTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div style={{ width: '55%', display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 10, columnGap: 12, alignItems: 'center' }}>
          {sortedData.map((reason, i) => (
            <React.Fragment key={i}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0, marginTop: 3 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 700, fontSize: 11, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{reason.name}</span>
                  {reason.count != null && (
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>{reason.count} cases</span>
                  )}
                </div>
              </div>
              <span style={{ fontWeight: 800, color: COLORS[i % COLORS.length], fontSize: 13, textAlign: 'right' }}>{reason.value}%</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

export function UtilizationChart({ data = [] }) {
  return (
    <div style={{ padding: '4px 8px 4px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 180, marginLeft: -25 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 15, right: 10, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="label"
              stroke="rgba(255,255,255,0.3)"
              fontSize={10}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="rgba(255,255,255,0.3)"
              fontSize={10}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{ background: '#1a263e', border: 'none', borderRadius: 8, fontSize: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
              itemStyle={{ color: '#fff' }}
              cursor={{ fill: 'rgba(255,255,255,0.05)' }}
            />
            <Bar dataKey="volume" fill="#6ae4ff" radius={[3, 3, 0, 0]} name="Orders Placed" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
