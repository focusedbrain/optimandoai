import React, { useState, useRef, useEffect } from 'react';

export interface DatePickerProps {
  value?: string; // ISO date string (YYYY-MM-DD)
  onChange: (date: string) => void;
  min?: string; // ISO date string
  max?: string; // ISO date string
  placeholder?: string;
  disabled?: boolean;
  showCalendar?: boolean;
  format?: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD-MM-YYYY' | 'MM-DD-YYYY';
  firstDayOfWeek?: 0 | 1; // 0 = Sunday, 1 = Monday
  showToday?: boolean;
  showClear?: boolean;
  style?: React.CSSProperties;
  className?: string;
  calendarStyle?: React.CSSProperties;
}

export const DatePicker: React.FC<DatePickerProps> = ({
  value,
  onChange,
  min,
  max,
  placeholder = 'Select date',
  disabled = false,
  showCalendar = true,
  format = 'YYYY-MM-DD',
  firstDayOfWeek = 0,
  showToday = true,
  showClear = true,
  style,
  className,
  calendarStyle,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [inputValue, setInputValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Format date for display
  const formatDate = (dateString: string): string => {
    if (!dateString) return '';
    
    const date = new Date(dateString + 'T12:00:00'); // Add time to avoid timezone issues
    
    switch (format) {
      case 'DD/MM/YYYY':
        return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
      case 'MM/DD/YYYY':
        return `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}/${date.getFullYear()}`;
      case 'DD-MM-YYYY':
        return `${date.getDate().toString().padStart(2, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getFullYear()}`;
      case 'MM-DD-YYYY':
        return `${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}-${date.getFullYear()}`;
      default:
        return dateString;
    }
  };

  // Parse display format to ISO date
  const parseDate = (displayValue: string): string => {
    if (!displayValue) return '';
    
    let day: number, month: number, year: number;
    
    switch (format) {
      case 'DD/MM/YYYY':
        [day, month, year] = displayValue.split('/').map(Number);
        break;
      case 'MM/DD/YYYY':
        [month, day, year] = displayValue.split('/').map(Number);
        break;
      case 'DD-MM-YYYY':
        [day, month, year] = displayValue.split('-').map(Number);
        break;
      case 'MM-DD-YYYY':
        [month, day, year] = displayValue.split('-').map(Number);
        break;
      default:
        return displayValue; // Assume already in ISO format
    }
    
    if (isNaN(day) || isNaN(month) || isNaN(year)) return '';
    
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  };

  // Update input value when value prop changes
  useEffect(() => {
    setInputValue(value ? formatDate(value) : '');
    if (value) {
      setCurrentMonth(new Date(value + 'T12:00:00'));
    }
  }, [value, format]);

  // Close calendar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const displayValue = e.target.value;
    setInputValue(displayValue);
    
    // Try to parse and validate the date
    const isoDate = parseDate(displayValue);
    if (isoDate && isValidDate(isoDate)) {
      onChange(isoDate);
    }
  };

  // Validate date
  const isValidDate = (dateString: string): boolean => {
    const date = new Date(dateString + 'T12:00:00');
    return !isNaN(date.getTime()) && 
           (!min || date >= new Date(min + 'T12:00:00')) && 
           (!max || date <= new Date(max + 'T12:00:00'));
  };

  // Handle date selection from calendar
  const handleDateSelect = (dateString: string) => {
    onChange(dateString);
    setInputValue(formatDate(dateString));
    setIsOpen(false);
  };

  // Clear date
  const handleClear = () => {
    onChange('');
    setInputValue('');
  };

  // Navigate months
  const navigateMonth = (direction: 'prev' | 'next') => {
    const newMonth = new Date(currentMonth);
    if (direction === 'prev') {
      newMonth.setMonth(newMonth.getMonth() - 1);
    } else {
      newMonth.setMonth(newMonth.getMonth() + 1);
    }
    setCurrentMonth(newMonth);
  };

  // Get calendar days
  const getCalendarDays = () => {
    const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const lastDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    const startDate = new Date(firstDay);
    
    // Adjust start date to first day of week
    const dayOfWeek = firstDay.getDay();
    const daysToSubtract = firstDayOfWeek === 0 ? dayOfWeek : (dayOfWeek + 6) % 7;
    startDate.setDate(startDate.getDate() - daysToSubtract);

    const days: Date[] = [];
    const current = new Date(startDate);
    
    // Generate 42 days (6 weeks)
    for (let i = 0; i < 42; i++) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    
    return days;
  };

  // Check if date is today
  const isToday = (date: Date): boolean => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  // Check if date is selected
  const isSelected = (date: Date): boolean => {
    if (!value) return false;
    const selectedDate = new Date(value + 'T12:00:00');
    return date.toDateString() === selectedDate.toDateString();
  };

  // Check if date is in current month
  const isInCurrentMonth = (date: Date): boolean => {
    return date.getMonth() === currentMonth.getMonth() && 
           date.getFullYear() === currentMonth.getFullYear();
  };

  // Check if date is disabled
  const isDateDisabled = (date: Date): boolean => {
    const dateString = date.toISOString().split('T')[0];
    return !isValidDate(dateString);
  };

  const weekDays = firstDayOfWeek === 0 
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  return (
    <div 
      ref={containerRef}
      className={className}
      style={{ position: 'relative', width: '100%', ...style }}
    >
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          placeholder={placeholder}
          disabled={disabled}
          style={{
            width: '100%',
            padding: '12px',
            paddingRight: showCalendar || showClear ? '80px' : '12px',
            border: '2px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '14px',
            transition: 'border-color 0.2s',
          }}
          onFocus={() => showCalendar && setIsOpen(true)}
        />
        
        {/* Action buttons */}
        <div style={{
          position: 'absolute',
          right: '8px',
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          gap: '4px'
        }}>
          {showClear && value && (
            <button
              type="button"
              onClick={handleClear}
              style={{
                padding: '4px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                borderRadius: '4px',
                color: '#6b7280',
                fontSize: '16px',
              }}
              title="Clear date"
            >
              ✕
            </button>
          )}
          
          {showCalendar && (
            <button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              disabled={disabled}
              style={{
                padding: '4px',
                border: 'none',
                background: 'transparent',
                cursor: disabled ? 'not-allowed' : 'pointer',
                borderRadius: '4px',
                color: '#6b7280',
                fontSize: '16px',
              }}
              title="Open calendar"
            >
              📅
            </button>
          )}
        </div>
      </div>

      {/* Calendar */}
      {isOpen && showCalendar && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          zIndex: 1000,
          backgroundColor: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
          padding: '16px',
          minWidth: '280px',
          ...calendarStyle,
        }}>
          {/* Calendar Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px'
          }}>
            <button
              type="button"
              onClick={() => navigateMonth('prev')}
              style={{
                padding: '8px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                borderRadius: '4px',
                fontSize: '18px',
                color: '#374151',
              }}
            >
              ←
            </button>
            
            <div style={{
              fontWeight: '600',
              fontSize: '16px',
              color: '#1f2937'
            }}>
              {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </div>
            
            <button
              type="button"
              onClick={() => navigateMonth('next')}
              style={{
                padding: '8px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                borderRadius: '4px',
                fontSize: '18px',
                color: '#374151',
              }}
            >
              →
            </button>
          </div>

          {/* Week Days */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '2px',
            marginBottom: '8px'
          }}>
            {weekDays.map(day => (
              <div key={day} style={{
                padding: '8px 4px',
                textAlign: 'center',
                fontSize: '12px',
                fontWeight: '600',
                color: '#6b7280'
              }}>
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Days */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '2px'
          }}>
            {getCalendarDays().map((date, index) => {
              const dateString = date.toISOString().split('T')[0];
              const disabled = isDateDisabled(date);
              const selected = isSelected(date);
              const today = isToday(date);
              const inCurrentMonth = isInCurrentMonth(date);
              
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => !disabled && handleDateSelect(dateString)}
                  disabled={disabled}
                  style={{
                    padding: '8px 4px',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    backgroundColor: selected ? '#3b82f6' : today ? '#f0f9ff' : 'transparent',
                    color: selected ? 'white' : 
                           disabled ? '#d1d5db' : 
                           today ? '#3b82f6' : 
                           inCurrentMonth ? '#374151' : '#9ca3af',
                    fontWeight: selected || today ? '600' : '400',
                    opacity: inCurrentMonth ? 1 : 0.5,
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (!disabled && !selected) {
                      e.currentTarget.style.backgroundColor = '#f3f4f6';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!disabled && !selected) {
                      e.currentTarget.style.backgroundColor = today ? '#f0f9ff' : 'transparent';
                    }
                  }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          {/* Today button */}
          {showToday && (
            <div style={{
              marginTop: '16px',
              paddingTop: '16px',
              borderTop: '1px solid #e5e7eb',
              textAlign: 'center'
            }}>
              <button
                type="button"
                onClick={() => {
                  const today = new Date().toISOString().split('T')[0];
                  if (isValidDate(today)) {
                    handleDateSelect(today);
                  }
                }}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  backgroundColor: 'white',
                  color: '#374151',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f9fafb';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'white';
                }}
              >
                Today
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};