import React, { useState, useMemo } from 'react';

export interface LineChartDataPoint {
  x: string | number;
  y: number;
  label?: string;
}

export interface LineChartSeries {
  name: string;
  data: LineChartDataPoint[];
  color?: string;
  strokeWidth?: number;
  showPoints?: boolean;
}

export interface LineChartProps {
  series: LineChartSeries[];
  width?: number;
  height?: number;
  showLegend?: boolean;
  showGrid?: boolean;
  showTooltip?: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
  title?: string;
  animate?: boolean;
  style?: React.CSSProperties;
  className?: string;
  onPointClick?: (point: LineChartDataPoint, seriesIndex: number) => void;
}

export const LineChart: React.FC<LineChartProps> = ({
  series,
  width = 500,
  height = 300,
  showLegend = true,
  showGrid = true,
  showTooltip = true,
  xAxisLabel,
  yAxisLabel,
  title,
  animate = true,
  style,
  className,
  onPointClick,
}) => {
  const [hoveredPoint, setHoveredPoint] = useState<{
    point: LineChartDataPoint;
    seriesIndex: number;
    x: number;
    y: number;
  } | null>(null);

  const padding = { top: 40, right: 40, bottom: 60, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate data ranges
  const { xRange, yRange, allXValues, maxY, minY } = useMemo(() => {
    const allPoints = series.flatMap(s => s.data);
    const allX = allPoints.map(p => p.x);
    const allY = allPoints.map(p => p.y);
    
    const uniqueX = Array.from(new Set(allX));
    const maxYVal = Math.max(...allY);
    const minYVal = Math.min(...allY);
    const yPadding = (maxYVal - minYVal) * 0.1;

    return {
      xRange: [0, uniqueX.length - 1],
      yRange: [minYVal - yPadding, maxYVal + yPadding],
      allXValues: uniqueX,
      maxY: maxYVal + yPadding,
      minY: minYVal - yPadding,
    };
  }, [series]);

  // Scale functions
  const scaleX = (x: string | number) => {
    const index = allXValues.indexOf(x);
    return (index / (allXValues.length - 1)) * chartWidth;
  };

  const scaleY = (y: number) => {
    return chartHeight - ((y - minY) / (maxY - minY)) * chartHeight;
  };

  // Generate path for each series
  const generatePath = (data: LineChartDataPoint[]) => {
    if (data.length === 0) return '';
    
    const points = data.map(point => ({
      x: scaleX(point.x),
      y: scaleY(point.y),
    }));

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x} ${points[i].y}`;
    }
    
    return path;
  };

  // Default colors
  const defaultColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#f97316'];

  // Grid lines
  const gridLines = [];
  if (showGrid) {
    // Horizontal grid lines
    for (let i = 0; i <= 5; i++) {
      const y = (chartHeight / 5) * i;
      gridLines.push(
        <line
          key={`h-grid-${i}`}
          x1={0}
          y1={y}
          x2={chartWidth}
          y2={y}
          stroke="#e5e7eb"
          strokeWidth={1}
        />
      );
    }

    // Vertical grid lines
    for (let i = 0; i < allXValues.length; i++) {
      const x = scaleX(allXValues[i]);
      gridLines.push(
        <line
          key={`v-grid-${i}`}
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

  // Axis labels
  const xAxisLabels = allXValues.map((value, index) => (
    <text
      key={`x-label-${index}`}
      x={scaleX(value)}
      y={chartHeight + 20}
      textAnchor="middle"
      fontSize={12}
      fill="#6b7280"
    >
      {value}
    </text>
  ));

  const yAxisLabels = [];
  for (let i = 0; i <= 5; i++) {
    const value = minY + ((maxY - minY) / 5) * (5 - i);
    const y = (chartHeight / 5) * i;
    yAxisLabels.push(
      <text
        key={`y-label-${i}`}
        x={-10}
        y={y + 5}
        textAnchor="end"
        fontSize={12}
        fill="#6b7280"
      >
        {value.toFixed(1)}
      </text>
    );
  }

  return (
    <div 
      className={`line-chart-container ${className || ''}`}
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
          {xAxisLabels}
          {yAxisLabels}
          
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
              x={-40}
              y={chartHeight / 2}
              textAnchor="middle"
              fontSize={14}
              fontWeight="bold"
              fill="#374151"
              transform={`rotate(-90, -40, ${chartHeight / 2})`}
            >
              {yAxisLabel}
            </text>
          )}
          
          {/* Lines */}
          {series.map((seriesData, seriesIndex) => (
            <g key={`series-${seriesIndex}`}>
              <path
                d={generatePath(seriesData.data)}
                fill="none"
                stroke={seriesData.color || defaultColors[seriesIndex % defaultColors.length]}
                strokeWidth={seriesData.strokeWidth || 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                style={animate ? {
                  strokeDasharray: '1000',
                  strokeDashoffset: '1000',
                  animation: `drawLine 1.5s ease-in-out forwards`,
                  animationDelay: `${seriesIndex * 0.2}s`
                } : {}}
              />
              
              {/* Data points */}
              {(seriesData.showPoints !== false) && seriesData.data.map((point, pointIndex) => (
                <circle
                  key={`point-${seriesIndex}-${pointIndex}`}
                  cx={scaleX(point.x)}
                  cy={scaleY(point.y)}
                  r={4}
                  fill={seriesData.color || defaultColors[seriesIndex % defaultColors.length]}
                  stroke="white"
                  strokeWidth={2}
                  style={{ 
                    cursor: onPointClick ? 'pointer' : 'default',
                    transition: 'r 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (showTooltip) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setHoveredPoint({
                        point,
                        seriesIndex,
                        x: rect.left + rect.width / 2,
                        y: rect.top,
                      });
                    }
                    e.currentTarget.setAttribute('r', '6');
                  }}
                  onMouseLeave={(e) => {
                    setHoveredPoint(null);
                    e.currentTarget.setAttribute('r', '4');
                  }}
                  onClick={() => onPointClick && onPointClick(point, seriesIndex)}
                />
              ))}
            </g>
          ))}
        </g>
      </svg>

      {/* Legend */}
      {showLegend && (
        <div style={{ 
          marginTop: '20px', 
          display: 'flex', 
          justifyContent: 'center', 
          flexWrap: 'wrap',
          gap: '20px'
        }}>
          {series.map((seriesData, index) => (
            <div key={`legend-${index}`} style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px'
            }}>
              <div style={{
                width: '16px',
                height: '3px',
                backgroundColor: seriesData.color || defaultColors[index % defaultColors.length],
                borderRadius: '2px'
              }} />
              <span style={{ fontSize: '14px', color: '#374151' }}>
                {seriesData.name}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Tooltip */}
      {hoveredPoint && showTooltip && (
        <div
          style={{
            position: 'fixed',
            left: hoveredPoint.x,
            top: hoveredPoint.y - 10,
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
            {series[hoveredPoint.seriesIndex].name}
          </div>
          <div>
            {hoveredPoint.point.label || `${hoveredPoint.point.x}: ${hoveredPoint.point.y}`}
          </div>
        </div>
      )}

      {/* Animation styles */}
      {animate && (
        <style>
          {`
            @keyframes drawLine {
              to {
                stroke-dashoffset: 0;
              }
            }
          `}
        </style>
      )}
    </div>
  );
};