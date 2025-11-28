import React, { useState, useMemo } from 'react';

export interface BarChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface BarChartProps {
  data: BarChartDataPoint[];
  width?: number;
  height?: number;
  orientation?: 'vertical' | 'horizontal';
  showValues?: boolean;
  showGrid?: boolean;
  showTooltip?: boolean;
  title?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  animate?: boolean;
  style?: React.CSSProperties;
  className?: string;
  onBarClick?: (bar: BarChartDataPoint, index: number) => void;
}

export const BarChart: React.FC<BarChartProps> = ({
  data,
  width = 500,
  height = 300,
  orientation = 'vertical',
  showValues = true,
  showGrid = true,
  showTooltip = true,
  title,
  xAxisLabel,
  yAxisLabel,
  animate = true,
  style,
  className,
  onBarClick,
}) => {
  const [hoveredBar, setHoveredBar] = useState<{
    bar: BarChartDataPoint;
    index: number;
    x: number;
    y: number;
  } | null>(null);

  const padding = { top: 40, right: 40, bottom: 60, left: 80 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate data ranges
  const { maxValue, minValue } = useMemo(() => {
    const values = data.map(d => d.value);
    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    const padding = (max - min) * 0.1;
    
    return {
      maxValue: max + padding,
      minValue: min - padding,
    };
  }, [data]);

  // Scale functions
  const scaleValue = (value: number) => {
    if (orientation === 'vertical') {
      return ((value - minValue) / (maxValue - minValue)) * chartHeight;
    } else {
      return ((value - minValue) / (maxValue - minValue)) * chartWidth;
    }
  };

  // Bar dimensions
  const barSpacing = orientation === 'vertical' 
    ? chartWidth / (data.length * 1.5)
    : chartHeight / (data.length * 1.5);
  const barSize = barSpacing * 0.8;

  // Default colors
  const defaultColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#f97316'];

  // Grid lines
  const gridLines = [];
  if (showGrid) {
    const gridCount = 5;
    for (let i = 0; i <= gridCount; i++) {
      const value = minValue + ((maxValue - minValue) / gridCount) * i;
      
      if (orientation === 'vertical') {
        const y = chartHeight - scaleValue(value);
        gridLines.push(
          <line
            key={`grid-${i}`}
            x1={0}
            y1={y}
            x2={chartWidth}
            y2={y}
            stroke="#e5e7eb"
            strokeWidth={1}
          />
        );
      } else {
        const x = scaleValue(value);
        gridLines.push(
          <line
            key={`grid-${i}`}
            x1={x}
            y1={0}
            x2={x}
            y2={chartHeight}
            stroke="#e5e7eb"
            strokeWidth={1}
          />
        );
      }
    }
  }

  // Generate bars
  const bars = data.map((dataPoint, index) => {
    const color = dataPoint.color || defaultColors[index % defaultColors.length];
    
    if (orientation === 'vertical') {
      const x = (index + 0.5) * barSpacing;
      const barHeight = scaleValue(dataPoint.value);
      const y = chartHeight - barHeight;
      
      return (
        <g key={`bar-${index}`}>
          <rect
            x={x}
            y={y}
            width={barSize}
            height={barHeight}
            fill={color}
            stroke="white"
            strokeWidth={1}
            style={{
              cursor: onBarClick ? 'pointer' : 'default',
              opacity: animate ? 0 : 1,
              animation: animate ? `fadeInBar 0.6s ease-out ${index * 0.1}s forwards` : 'none',
              transformOrigin: 'bottom',
              transform: animate ? 'scaleY(0)' : 'scaleY(1)',
            }}
            onMouseEnter={(e) => {
              if (showTooltip) {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoveredBar({
                  bar: dataPoint,
                  index,
                  x: rect.left + rect.width / 2,
                  y: rect.top,
                });
              }
            }}
            onMouseLeave={() => setHoveredBar(null)}
            onClick={() => onBarClick && onBarClick(dataPoint, index)}
          />
          
          {/* Value labels */}
          {showValues && (
            <text
              x={x + barSize / 2}
              y={y - 5}
              textAnchor="middle"
              fontSize={12}
              fill="#374151"
              style={{
                opacity: animate ? 0 : 1,
                animation: animate ? `fadeIn 0.6s ease-out ${index * 0.1 + 0.3}s forwards` : 'none',
              }}
            >
              {dataPoint.value.toLocaleString()}
            </text>
          )}
          
          {/* X-axis labels */}
          <text
            x={x + barSize / 2}
            y={chartHeight + 20}
            textAnchor="middle"
            fontSize={12}
            fill="#6b7280"
            style={{
              opacity: animate ? 0 : 1,
              animation: animate ? `fadeIn 0.6s ease-out ${index * 0.1 + 0.2}s forwards` : 'none',
            }}
          >
            {dataPoint.label}
          </text>
        </g>
      );
    } else {
      // Horizontal bars
      const y = (index + 0.5) * barSpacing;
      const barWidth = scaleValue(dataPoint.value);
      
      return (
        <g key={`bar-${index}`}>
          <rect
            x={0}
            y={y}
            width={barWidth}
            height={barSize}
            fill={color}
            stroke="white"
            strokeWidth={1}
            style={{
              cursor: onBarClick ? 'pointer' : 'default',
              opacity: animate ? 0 : 1,
              animation: animate ? `fadeInBar 0.6s ease-out ${index * 0.1}s forwards` : 'none',
              transformOrigin: 'left',
              transform: animate ? 'scaleX(0)' : 'scaleX(1)',
            }}
            onMouseEnter={(e) => {
              if (showTooltip) {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoveredBar({
                  bar: dataPoint,
                  index,
                  x: rect.right,
                  y: rect.top + rect.height / 2,
                });
              }
            }}
            onMouseLeave={() => setHoveredBar(null)}
            onClick={() => onBarClick && onBarClick(dataPoint, index)}
          />
          
          {/* Value labels */}
          {showValues && (
            <text
              x={barWidth + 5}
              y={y + barSize / 2 + 4}
              fontSize={12}
              fill="#374151"
              style={{
                opacity: animate ? 0 : 1,
                animation: animate ? `fadeIn 0.6s ease-out ${index * 0.1 + 0.3}s forwards` : 'none',
              }}
            >
              {dataPoint.value.toLocaleString()}
            </text>
          )}
          
          {/* Y-axis labels */}
          <text
            x={-10}
            y={y + barSize / 2 + 4}
            textAnchor="end"
            fontSize={12}
            fill="#6b7280"
            style={{
              opacity: animate ? 0 : 1,
              animation: animate ? `fadeIn 0.6s ease-out ${index * 0.1 + 0.2}s forwards` : 'none',
            }}
          >
            {dataPoint.label}
          </text>
        </g>
      );
    }
  });

  // Axis tick labels for numerical axis
  const axisLabels = [];
  if (orientation === 'vertical') {
    // Y-axis labels for vertical bars
    for (let i = 0; i <= 5; i++) {
      const value = minValue + ((maxValue - minValue) / 5) * i;
      const y = chartHeight - scaleValue(value);
      axisLabels.push(
        <text
          key={`y-label-${i}`}
          x={-10}
          y={y + 4}
          textAnchor="end"
          fontSize={12}
          fill="#6b7280"
        >
          {value.toFixed(0)}
        </text>
      );
    }
  } else {
    // X-axis labels for horizontal bars
    for (let i = 0; i <= 5; i++) {
      const value = minValue + ((maxValue - minValue) / 5) * i;
      const x = scaleValue(value);
      axisLabels.push(
        <text
          key={`x-label-${i}`}
          x={x}
          y={chartHeight + 20}
          textAnchor="middle"
          fontSize={12}
          fill="#6b7280"
        >
          {value.toFixed(0)}
        </text>
      );
    }
  }

  return (
    <div 
      className={`bar-chart-container ${className || ''}`}
      style={{ 
        position: 'relative', 
        display: 'inline-block',
        ...style 
      }}
    >
      {title && (
        <h3 style={{ 
          margin: '0 0 20px 0', 
          textAlign: 'center', 
          fontSize: '18px',
          fontWeight: 'bold',
          color: '#1f2937'
        }}>
          {title}
        </h3>
      )}
      
      <svg width={width} height={height}>
        <g transform={`translate(${padding.left}, ${padding.top})`}>
          {/* Grid */}
          {gridLines}
          
          {/* Axes */}
          <line
            x1={0}
            y1={chartHeight}
            x2={chartWidth}
            y2={chartHeight}
            stroke="#374151"
            strokeWidth={2}
          />
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={chartHeight}
            stroke="#374151"
            strokeWidth={2}
          />
          
          {/* Axis labels */}
          {axisLabels}
          
          {/* Axis titles */}
          {xAxisLabel && (
            <text
              x={chartWidth / 2}
              y={chartHeight + 50}
              textAnchor="middle"
              fontSize={14}
              fontWeight="bold"
              fill="#374151"
            >
              {xAxisLabel}
            </text>
          )}
          {yAxisLabel && (
            <text
              x={-50}
              y={chartHeight / 2}
              textAnchor="middle"
              fontSize={14}
              fontWeight="bold"
              fill="#374151"
              transform={`rotate(-90, -50, ${chartHeight / 2})`}
            >
              {yAxisLabel}
            </text>
          )}
          
          {/* Bars */}
          {bars}
        </g>
      </svg>

      {/* Tooltip */}
      {hoveredBar && showTooltip && (
        <div
          style={{
            position: 'fixed',
            left: hoveredBar.x,
            top: hoveredBar.y - 10,
            transform: 'translate(-50%, -100%)',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            pointerEvents: 'none',
            zIndex: 1000,
            whiteSpace: 'nowrap'
          }}
        >
          <div style={{ fontWeight: 'bold' }}>
            {hoveredBar.bar.label}
          </div>
          <div>
            Value: {hoveredBar.bar.value.toLocaleString()}
          </div>
        </div>
      )}

      {/* Animation styles */}
      {animate && (
        <style>
          {`
            @keyframes fadeInBar {
              0% {
                opacity: 0;
                transform: scale${orientation === 'vertical' ? 'Y' : 'X'}(0);
              }
              100% {
                opacity: 1;
                transform: scale${orientation === 'vertical' ? 'Y' : 'X'}(1);
              }
            }
            @keyframes fadeIn {
              0% {
                opacity: 0;
              }
              100% {
                opacity: 1;
              }
            }
          `}
        </style>
      )}
    </div>
  );
};