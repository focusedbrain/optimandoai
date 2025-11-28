import React, { useState, useMemo } from 'react';

export interface PieChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface PieChartProps {
  data: PieChartDataPoint[];
  width?: number;
  height?: number;
  innerRadius?: number; // For donut charts
  showLabels?: boolean;
  showValues?: boolean;
  showPercentages?: boolean;
  showLegend?: boolean;
  showTooltip?: boolean;
  title?: string;
  animate?: boolean;
  style?: React.CSSProperties;
  className?: string;
  onSliceClick?: (slice: PieChartDataPoint, index: number) => void;
}

export const PieChart: React.FC<PieChartProps> = ({
  data,
  width = 400,
  height = 400,
  innerRadius = 0,
  showLabels = true,
  showValues = false,
  showPercentages = true,
  showLegend = true,
  showTooltip = true,
  title,
  animate = true,
  style,
  className,
  onSliceClick,
}) => {
  const [hoveredSlice, setHoveredSlice] = useState<{
    slice: PieChartDataPoint;
    index: number;
    x: number;
    y: number;
    percentage: number;
  } | null>(null);

  const radius = Math.min(width, height) / 2 - 40;
  const centerX = width / 2;
  const centerY = height / 2;

  // Calculate total and percentages
  const { total, dataWithPercentages } = useMemo(() => {
    const totalValue = data.reduce((sum, item) => sum + Math.abs(item.value), 0);
    const processedData = data.map(item => ({
      ...item,
      percentage: totalValue > 0 ? (Math.abs(item.value) / totalValue) * 100 : 0,
    }));
    
    return {
      total: totalValue,
      dataWithPercentages: processedData,
    };
  }, [data]);

  // Default colors
  const defaultColors = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', 
    '#f97316', '#06b6d4', '#84cc16', '#ec4899', '#6366f1'
  ];

  // Generate pie slices
  let cumulativeAngle = 0;
  const slices = dataWithPercentages.map((dataPoint, index) => {
    const angle = (dataPoint.percentage / 100) * 2 * Math.PI;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + angle;
    cumulativeAngle += angle;

    const color = dataPoint.color || defaultColors[index % defaultColors.length];

    // Calculate path for the slice
    const largeArcFlag = angle > Math.PI ? 1 : 0;
    
    // Outer arc points
    const x1 = centerX + radius * Math.cos(startAngle);
    const y1 = centerY + radius * Math.sin(startAngle);
    const x2 = centerX + radius * Math.cos(endAngle);
    const y2 = centerY + radius * Math.sin(endAngle);

    // Inner arc points (for donut)
    const innerX1 = centerX + innerRadius * Math.cos(startAngle);
    const innerY1 = centerY + innerRadius * Math.sin(startAngle);
    const innerX2 = centerX + innerRadius * Math.cos(endAngle);
    const innerY2 = centerY + innerRadius * Math.sin(endAngle);

    // Create path
    let pathData;
    if (innerRadius > 0) {
      // Donut chart path
      pathData = [
        `M ${innerX1} ${innerY1}`,
        `L ${x1} ${y1}`,
        `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
        `L ${innerX2} ${innerY2}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerX1} ${innerY1}`,
        'Z'
      ].join(' ');
    } else {
      // Pie chart path
      pathData = [
        `M ${centerX} ${centerY}`,
        `L ${x1} ${y1}`,
        `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
        'Z'
      ].join(' ');
    }

    // Label position (middle of the slice)
    const labelAngle = startAngle + angle / 2;
    const labelRadius = innerRadius + (radius - innerRadius) * 0.7;
    const labelX = centerX + labelRadius * Math.cos(labelAngle);
    const labelY = centerY + labelRadius * Math.sin(labelAngle);

    return {
      path: pathData,
      color,
      dataPoint,
      index,
      labelX,
      labelY,
      angle,
      startAngle,
      endAngle,
    };
  });

  return (
    <div 
      className={`pie-chart-container ${className || ''}`}
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
        {/* Pie slices */}
        {slices.map((slice) => (
          <g key={`slice-${slice.index}`}>
            <path
              d={slice.path}
              fill={slice.color}
              stroke="white"
              strokeWidth={2}
              style={{
                cursor: onSliceClick ? 'pointer' : 'default',
                opacity: animate ? 0 : 1,
                transform: animate ? 'scale(0)' : 'scale(1)',
                transformOrigin: `${centerX}px ${centerY}px`,
                animation: animate ? `growSlice 0.8s ease-out ${slice.index * 0.1}s forwards` : 'none',
                transition: 'transform 0.2s ease',
              }}
              onMouseEnter={(e) => {
                if (showTooltip) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredSlice({
                    slice: slice.dataPoint,
                    index: slice.index,
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2,
                    percentage: dataWithPercentages[slice.index].percentage,
                  });
                }
                e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                setHoveredSlice(null);
                e.currentTarget.style.transform = 'scale(1)';
              }}
              onClick={() => onSliceClick && onSliceClick(slice.dataPoint, slice.index)}
            />
            
            {/* Labels */}
            {showLabels && slice.angle > 0.1 && ( // Only show label if slice is large enough
              <text
                x={slice.labelX}
                y={slice.labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={12}
                fill="#1f2937"
                fontWeight="600"
                style={{
                  pointerEvents: 'none',
                  opacity: animate ? 0 : 1,
                  animation: animate ? `fadeIn 0.6s ease-out ${slice.index * 0.1 + 0.5}s forwards` : 'none',
                }}
              >
                {showPercentages && `${dataWithPercentages[slice.index].percentage.toFixed(1)}%`}
                {showPercentages && showValues && '\n'}
                {showValues && slice.dataPoint.value.toLocaleString()}
              </text>
            )}
          </g>
        ))}

        {/* Center text for donut charts */}
        {innerRadius > 0 && (
          <g>
            <text
              x={centerX}
              y={centerY - 5}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={24}
              fontWeight="bold"
              fill="#1f2937"
            >
              {total.toLocaleString()}
            </text>
            <text
              x={centerX}
              y={centerY + 15}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={12}
              fill="#6b7280"
            >
              Total
            </text>
          </g>
        )}
      </svg>

      {/* Legend */}
      {showLegend && (
        <div style={{ 
          marginTop: '20px', 
          display: 'flex', 
          flexDirection: 'column',
          gap: '8px',
          maxWidth: '300px',
          margin: '20px auto 0'
        }}>
          {dataWithPercentages.map((item, index) => {
            const color = item.color || defaultColors[index % defaultColors.length];
            return (
              <div key={`legend-${index}`} style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px',
                padding: '4px',
                cursor: onSliceClick ? 'pointer' : 'default'
              }}
              onClick={() => onSliceClick && onSliceClick(item, index)}
              >
                <div style={{
                  width: '16px',
                  height: '16px',
                  backgroundColor: color,
                  borderRadius: '2px',
                  flexShrink: 0
                }} />
                <div style={{ 
                  flex: 1, 
                  fontSize: '14px', 
                  color: '#374151',
                  display: 'flex',
                  justifyContent: 'space-between'
                }}>
                  <span>{item.label}</span>
                  <span style={{ fontWeight: 'bold', marginLeft: '8px' }}>
                    {item.percentage.toFixed(1)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tooltip */}
      {hoveredSlice && showTooltip && (
        <div
          style={{
            position: 'fixed',
            left: hoveredSlice.x,
            top: hoveredSlice.y,
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '12px 16px',
            borderRadius: '6px',
            fontSize: '12px',
            pointerEvents: 'none',
            zIndex: 1000,
            whiteSpace: 'nowrap'
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
            {hoveredSlice.slice.label}
          </div>
          <div>Value: {hoveredSlice.slice.value.toLocaleString()}</div>
          <div>Percentage: {hoveredSlice.percentage.toFixed(1)}%</div>
        </div>
      )}

      {/* Animation styles */}
      {animate && (
        <style>
          {`
            @keyframes growSlice {
              0% {
                opacity: 0;
                transform: scale(0);
              }
              100% {
                opacity: 1;
                transform: scale(1);
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