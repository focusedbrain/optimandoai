import React, { useState, useEffect } from 'react';

interface SliderNavigationProps {
  items: any[];
  currentIndex: number;
  showDots?: boolean;
  showArrows?: boolean;
  onChange: (index: number) => void;
}

/**
 * Slider Navigation Component
 * 
 * Allows users to navigate through a collection of items using:
 * - Previous/Next arrow buttons
 * - Dot indicators for direct selection
 * - Keyboard navigation (arrow keys)
 */
export const SliderNavigation: React.FC<SliderNavigationProps> = ({
  items,
  currentIndex,
  showDots = true,
  showArrows = true,
  onChange
}) => {
  const [index, setIndex] = useState(currentIndex);

  useEffect(() => {
    setIndex(currentIndex);
  }, [currentIndex]);

  const handlePrev = () => {
    const newIndex = index > 0 ? index - 1 : items.length - 1;
    setIndex(newIndex);
    onChange(newIndex);
  };

  const handleNext = () => {
    const newIndex = index < items.length - 1 ? index + 1 : 0;
    setIndex(newIndex);
    onChange(newIndex);
  };

  const handleDotClick = (dotIndex: number) => {
    setIndex(dotIndex);
    onChange(dotIndex);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [index, items.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
      {/* Navigation Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        {showArrows && (
          <button
            onClick={handlePrev}
            style={{
              padding: '8px 12px',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '14px'
            }}
            title="Previous (Arrow Left)"
          >
            ← Prev
          </button>
        )}

        <div style={{ flex: 1, textAlign: 'center', fontSize: '14px', color: '#64748b' }}>
          {index + 1} / {items.length}
        </div>

        {showArrows && (
          <button
            onClick={handleNext}
            style={{
              padding: '8px 12px',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '14px'
            }}
            title="Next (Arrow Right)"
          >
            Next →
          </button>
        )}
      </div>

      {/* Dot Indicators */}
      {showDots && items.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => handleDotClick(i)}
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                border: 'none',
                background: i === index ? '#3b82f6' : '#cbd5e1',
                cursor: 'pointer',
                padding: 0,
                transition: 'all 0.2s'
              }}
              title={`Go to item ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};
