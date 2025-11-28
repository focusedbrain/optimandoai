import React from 'react';

export interface AreaChartDataPoint {
  x: string | number;
  y: number;
  label?: string;
}

export interface AreaChartSeries {
  name: string;
  data: AreaChartDataPoint[];
  color?: string;
  fillOpacity?: number;
  strokeWidth?: number;
}

export interface AreaChartProps {
  series: AreaChartSeries[];
  width?: number;
  height?: number;
  showLegend?: boolean;
  showGrid?: boolean;
  showTooltip?: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
  title?: string;
  animate?: boolean;
  stacked?: boolean;
  style?: React.CSSProperties;
  className?: string;
  onAreaClick?: (point: AreaChartDataPoint, seriesIndex: number) => void;
}

export const AreaChart: React.FC<AreaChartProps> = ({
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
  stacked = false,
  style,
  className,
  onAreaClick,
}) => {
  const padding = { top: 40, right: 40, bottom: 60, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate data ranges and prepare stacked data if needed
  const { xRange, yRange, allXValues, maxY, minY, processedSeries } = React.useMemo(() => {
    const allPoints = series.flatMap(s => s.data);
    const allX = allPoints.map(p => p.x);
    const uniqueX = Array.from(new Set(allX));
    
    let processedSeriesData = [...series];
    let calculatedMaxY: number;
    let calculatedMinY: number;

    if (stacked) {
      // Calculate stacked values
      const stackedData = uniqueX.map(x => {
        let cumulativeValue = 0;
        const stackValues: { [seriesIndex: number]: number } = {};
        
        series.forEach((s, index) => {
          const point = s.data.find(p => p.x === x);
          const value = point?.y || 0;
          stackValues[index] = cumulativeValue;
          cumulativeValue += value;
        });
        
        return { x, stackValues, total: cumulativeValue };
      });

      // Update series data with stacked positions
      processedSeriesData = series.map((s, seriesIndex) => ({
        ...s,
        data: uniqueX.map(x => {
          const originalPoint = s.data.find(p => p.x === x);
          const stackInfo = stackedData.find(sd => sd.x === x);
          return {
            x,
            y: originalPoint?.y || 0,
            stackedY: (stackInfo?.stackValues[seriesIndex] || 0) + (originalPoint?.y || 0),
            stackedBase: stackInfo?.stackValues[seriesIndex] || 0,
            label: originalPoint?.label,
          };
        }),
      }));

      const allStackedValues = stackedData.map(sd => sd.total);
      calculatedMaxY = Math.max(...allStackedValues);
      calculatedMinY = 0; // Stacked charts start at 0
    } else {
      const allY = allPoints.map(p => p.y);
      calculatedMaxY = Math.max(...allY);
      calculatedMinY = Math.min(...allY);
    }

    const yPadding = (calculatedMaxY - calculatedMinY) * 0.1;

    return {
      xRange: [0, uniqueX.length - 1],
      yRange: [calculatedMinY - yPadding, calculatedMaxY + yPadding],
      allXValues: uniqueX,
      maxY: calculatedMaxY + yPadding,
      minY: calculatedMinY - yPadding,
      processedSeries: processedSeriesData,
    };
  }, [series, stacked]);

  // Scale functions
  const scaleX = (x: string | number) => {
    const index = allXValues.indexOf(x);
    return (index / (allXValues.length - 1)) * chartWidth;
  };

  const scaleY = (y: number) => {
    return chartHeight - ((y - minY) / (maxY - minY)) * chartHeight;
  };

  // Generate area path for each series
  const generateAreaPath = (data: any[], seriesIndex: number) => {
    if (data.length === 0) return '';
    
    let topPath = '';
    let bottomPath = '';
    
    data.forEach((point, index) => {
      const x = scaleX(point.x);
      const topY = stacked ? scaleY(point.stackedY) : scaleY(point.y);
      const bottomY = stacked ? scaleY(point.stackedBase) : scaleY(0);
      
      if (index === 0) {
        topPath = `M ${x} ${topY}`;
        bottomPath = `L ${x} ${bottomY}`;
      } else {
        topPath += ` L ${x} ${topY}`;
        bottomPath = `L ${x} ${bottomY}` + bottomPath;
      }
    });
    
    // Complete the area path
    const lastPoint = data[data.length - 1];
    const firstPoint = data[0];
    const lastX = scaleX(lastPoint.x);
    const firstX = scaleX(firstPoint.x);
    const lastBottomY = stacked ? scaleY(lastPoint.stackedBase) : scaleY(0);
    const firstBottomY = stacked ? scaleY(firstPoint.stackedBase) : scaleY(0);
    
    return `${topPath} L ${lastX} ${lastBottomY} ${bottomPath} Z`;
  };

  // Generate line path for each series
  const generateLinePath = (data: any[]) => {
    if (data.length === 0) return '';
    
    let path = '';
    data.forEach((point, index) => {
      const x = scaleX(point.x);
      const y = stacked ? scaleY(point.stackedY) : scaleY(point.y);
      
      if (index === 0) {
        path = `M ${x} ${y}`;
      } else {
        path += ` L ${x} ${y}`;
      }
    });
    
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
      className={`area-chart-container ${className || ''}`}
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
        <defs>
          {/* Gradients for area fills */}
          {processedSeries.map((seriesData, index) => {
            const color = seriesData.color || defaultColors[index % defaultColors.length];
            return (
              <linearGradient
                key={`gradient-${index}`}
                id={`areaGradient-${index}`}
                x1="0%"
                y1="0%"
                x2="0%"
                y2="100%"
              >
                <stop offset="0%" stopColor={color} stopOpacity={seriesData.fillOpacity || 0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            );
          })}
        </defs>
        
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
          
          {/* Areas (render in reverse order for proper stacking) */}
          {processedSeries.slice().reverse().map((seriesData, reverseIndex) => {
            const seriesIndex = processedSeries.length - 1 - reverseIndex;
            const color = seriesData.color || defaultColors[seriesIndex % defaultColors.length];
            
            return (
              <g key={`area-${seriesIndex}`}>
                {/* Area fill */}
                <path
                  d={generateAreaPath(seriesData.data, seriesIndex)}
                  fill={`url(#areaGradient-${seriesIndex})`}
                  style={{
                    opacity: animate ? 0 : 1,
                    animation: animate ? `fadeInArea 1s ease-in-out ${seriesIndex * 0.2}s forwards` : 'none',
                    cursor: onAreaClick ? 'pointer' : 'default',
                  }}
                  onClick={() => {
                    if (onAreaClick && seriesData.data.length > 0) {
                      onAreaClick(seriesData.data[0], seriesIndex);
                    }
                  }}
                />
                
                {/* Area stroke */}
                <path
                  d={generateLinePath(seriesData.data)}
                  fill="none"
                  stroke={color}
                  strokeWidth={seriesData.strokeWidth || 2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  style={animate ? {
                    strokeDasharray: '1000',
                    strokeDashoffset: '1000',
                    animation: `drawLine 1.5s ease-in-out ${seriesIndex * 0.2 + 0.5}s forwards`,
                  } : {}}
                />
              </g>
            );
          })}
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
          {processedSeries.map((seriesData, index) => {
            const color = seriesData.color || defaultColors[index % defaultColors.length];
            return (
              <div key={`legend-${index}`} style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px'
              }}>
                <div style={{
                  width: '16px',
                  height: '3px',
                  backgroundColor: color,
                  borderRadius: '2px'
                }} />
                <span style={{ fontSize: '14px', color: '#374151' }}>
                  {seriesData.name}
                </span>
              </div>
            );
          })}
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
            @keyframes fadeInArea {
              to {
                opacity: 1;
              }
            }
          `}
        </style>
      )}
    </div>
  );
};