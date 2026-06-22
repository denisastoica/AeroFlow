import React from 'react';
import './Skeleton.css';

export function Skeleton({ width = '100%', height = '1.2em', style = {}, className = '' }) {
  return (
    <span
      className={`skeleton-loader ${className}`}
      style={{ display: 'inline-block', width, height, borderRadius: 6, ...style }}
    />
  );
}

export function SkeletonBlock({ rows = 3, width = '100%', height = '1em', gap = '0.5em', style = {} }) {
  return (
    <div style={{ width, ...style }}>
      {Array.from({ length: rows }).map((_, i) => (
        <span
          key={i}
          className="skeleton-loader"
          style={{ display: 'block', width: '100%', height, borderRadius: 6, marginBottom: i < rows - 1 ? gap : 0 }}
        />
      ))}
    </div>
  );
}
