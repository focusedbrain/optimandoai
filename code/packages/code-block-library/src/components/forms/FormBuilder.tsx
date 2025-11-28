import React, { useState, useEffect, useRef } from 'react';

export interface FormField {
  name: string;
  type: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'file' | 'date' | 'time';
  label: string;
  placeholder?: string;
  required?: boolean;
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    custom?: (value: any) => string | null; // Return error message or null if valid
  };
  options?: { value: string | number; label: string }[]; // For select/radio
  multiple?: boolean; // For select/file
  rows?: number; // For textarea
  defaultValue?: any;
  disabled?: boolean;
  hint?: string;
}

export interface FormBuilderProps {
  fields: FormField[];
  onSubmit: (data: Record<string, any>) => void;
  onFieldChange?: (fieldName: string, value: any, allData: Record<string, any>) => void;
  submitLabel?: string;
  resetLabel?: string;
  showReset?: boolean;
  layout?: 'vertical' | 'horizontal' | 'grid';
  gridColumns?: number;
  style?: React.CSSProperties;
  className?: string;
  validateOnChange?: boolean;
  submitButtonStyle?: React.CSSProperties;
  fieldStyle?: React.CSSProperties;
}

export const FormBuilder: React.FC<FormBuilderProps> = ({
  fields,
  onSubmit,
  onFieldChange,
  submitLabel = 'Submit',
  resetLabel = 'Reset',
  showReset = true,
  layout = 'vertical',
  gridColumns = 2,
  style,
  className,
  validateOnChange = true,
  submitButtonStyle,
  fieldStyle,
}) => {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const formRef = useRef<HTMLFormElement>(null);

  // Initialize form data with default values
  useEffect(() => {
    const initialData: Record<string, any> = {};
    fields.forEach(field => {
      if (field.defaultValue !== undefined) {
        initialData[field.name] = field.defaultValue;
      } else if (field.type === 'checkbox') {
        initialData[field.name] = false;
      } else if (field.type === 'select' && field.multiple) {
        initialData[field.name] = [];
      } else {
        initialData[field.name] = '';
      }
    });
    setFormData(initialData);
  }, [fields]);

  // Validation function
  const validateField = (field: FormField, value: any): string | null => {
    // Required validation
    if (field.required && (!value || value === '' || (Array.isArray(value) && value.length === 0))) {
      return `${field.label} is required`;
    }

    // Skip other validations if field is empty and not required
    if (!value || value === '') return null;

    const validation = field.validation;
    if (!validation) return null;

    // Pattern validation
    if (validation.pattern && typeof value === 'string') {
      const regex = new RegExp(validation.pattern);
      if (!regex.test(value)) {
        return `${field.label} format is invalid`;
      }
    }

    // Length validations
    if (validation.minLength && typeof value === 'string' && value.length < validation.minLength) {
      return `${field.label} must be at least ${validation.minLength} characters`;
    }

    if (validation.maxLength && typeof value === 'string' && value.length > validation.maxLength) {
      return `${field.label} must be no more than ${validation.maxLength} characters`;
    }

    // Number validations
    if (validation.min !== undefined && typeof value === 'number' && value < validation.min) {
      return `${field.label} must be at least ${validation.min}`;
    }

    if (validation.max !== undefined && typeof value === 'number' && value > validation.max) {
      return `${field.label} must be no more than ${validation.max}`;
    }

    // Custom validation
    if (validation.custom) {
      return validation.custom(value);
    }

    return null;
  };

  // Handle field change
  const handleFieldChange = (field: FormField, value: any) => {
    const newFormData = { ...formData, [field.name]: value };
    setFormData(newFormData);

    // Validate on change if enabled
    if (validateOnChange && touched[field.name]) {
      const error = validateField(field, value);
      setErrors(prev => ({
        ...prev,
        [field.name]: error || ''
      }));
    }

    // Call onChange callback
    if (onFieldChange) {
      onFieldChange(field.name, value, newFormData);
    }
  };

  // Handle field blur
  const handleFieldBlur = (field: FormField) => {
    setTouched(prev => ({ ...prev, [field.name]: true }));
    
    const error = validateField(field, formData[field.name]);
    setErrors(prev => ({
      ...prev,
      [field.name]: error || ''
    }));
  };

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const newErrors: Record<string, string> = {};
    let hasErrors = false;

    fields.forEach(field => {
      const error = validateField(field, formData[field.name]);
      if (error) {
        newErrors[field.name] = error;
        hasErrors = true;
      }
    });

    setErrors(newErrors);
    setTouched(Object.fromEntries(fields.map(f => [f.name, true])));

    // Submit if no errors
    if (!hasErrors) {
      onSubmit(formData);
    }
  };

  // Handle form reset
  const handleReset = () => {
    const resetData: Record<string, any> = {};
    fields.forEach(field => {
      if (field.defaultValue !== undefined) {
        resetData[field.name] = field.defaultValue;
      } else if (field.type === 'checkbox') {
        resetData[field.name] = false;
      } else if (field.type === 'select' && field.multiple) {
        resetData[field.name] = [];
      } else {
        resetData[field.name] = '';
      }
    });
    setFormData(resetData);
    setErrors({});
    setTouched({});
  };

  // Render field
  const renderField = (field: FormField) => {
    const hasError = touched[field.name] && errors[field.name];
    const fieldId = `form-field-${field.name}`;

    const commonProps = {
      id: fieldId,
      name: field.name,
      disabled: field.disabled,
      style: {
        width: '100%',
        padding: '12px',
        border: `2px solid ${hasError ? '#ef4444' : '#d1d5db'}`,
        borderRadius: '6px',
        fontSize: '14px',
        transition: 'border-color 0.2s',
        ...fieldStyle,
      },
      onBlur: () => handleFieldBlur(field),
    };

    let fieldElement: React.ReactNode;

    switch (field.type) {
      case 'textarea':
        fieldElement = (
          <textarea
            {...commonProps}
            value={formData[field.name] || ''}
            placeholder={field.placeholder}
            rows={field.rows || 4}
            onChange={(e) => handleFieldChange(field, e.target.value)}
          />
        );
        break;

      case 'select':
        if (field.multiple) {
          fieldElement = (
            <select
              {...commonProps}
              value={formData[field.name] || []}
              multiple
              onChange={(e) => {
                const values = Array.from(e.target.selectedOptions, option => option.value);
                handleFieldChange(field, values);
              }}
              style={{ ...commonProps.style, height: 'auto', minHeight: '120px' }}
            >
              {field.options?.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          );
        } else {
          fieldElement = (
            <select
              {...commonProps}
              value={formData[field.name] || ''}
              onChange={(e) => handleFieldChange(field, e.target.value)}
            >
              <option value="">{field.placeholder || 'Select an option'}</option>
              {field.options?.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          );
        }
        break;

      case 'checkbox':
        fieldElement = (
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={formData[field.name] || false}
              disabled={field.disabled}
              onChange={(e) => handleFieldChange(field, e.target.checked)}
              style={{ margin: 0, transform: 'scale(1.2)' }}
            />
            <span>{field.label}</span>
          </label>
        );
        break;

      case 'radio':
        fieldElement = (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {field.options?.map(option => (
              <label key={option.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name={field.name}
                  value={option.value}
                  checked={formData[field.name] === option.value}
                  disabled={field.disabled}
                  onChange={(e) => handleFieldChange(field, e.target.value)}
                  style={{ margin: 0, transform: 'scale(1.2)' }}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        );
        break;

      case 'file':
        fieldElement = (
          <input
            type="file"
            {...commonProps}
            multiple={field.multiple}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              handleFieldChange(field, field.multiple ? files : files[0]);
            }}
            style={{
              ...commonProps.style,
              padding: '8px',
              cursor: 'pointer',
            }}
          />
        );
        break;

      default:
        fieldElement = (
          <input
            type={field.type}
            {...commonProps}
            value={formData[field.name] || ''}
            placeholder={field.placeholder}
            onChange={(e) => {
              const value = field.type === 'number' ? 
                (e.target.value === '' ? '' : Number(e.target.value)) : 
                e.target.value;
              handleFieldChange(field, value);
            }}
          />
        );
    }

    return (
      <div key={field.name} style={{ marginBottom: '20px' }}>
        {field.type !== 'checkbox' && field.type !== 'radio' && (
          <label 
            htmlFor={fieldId}
            style={{ 
              display: 'block', 
              marginBottom: '6px', 
              fontWeight: '600', 
              color: '#374151',
              fontSize: '14px'
            }}
          >
            {field.label}
            {field.required && <span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>}
          </label>
        )}
        
        {fieldElement}
        
        {field.hint && (
          <div style={{ 
            fontSize: '12px', 
            color: '#6b7280', 
            marginTop: '4px' 
          }}>
            {field.hint}
          </div>
        )}
        
        {hasError && (
          <div style={{ 
            color: '#ef4444', 
            fontSize: '12px', 
            marginTop: '4px',
            fontWeight: '500'
          }}>
            {errors[field.name]}
          </div>
        )}
      </div>
    );
  };

  // Calculate form layout styles
  const getFormLayoutStyles = (): React.CSSProperties => {
    switch (layout) {
      case 'horizontal':
        return { display: 'flex', flexWrap: 'wrap', gap: '20px' };
      case 'grid':
        return { 
          display: 'grid', 
          gridTemplateColumns: `repeat(${gridColumns}, 1fr)`, 
          gap: '20px' 
        };
      default:
        return {};
    }
  };

  return (
    <form 
      ref={formRef}
      onSubmit={handleSubmit}
      className={className}
      style={{ 
        maxWidth: '800px',
        margin: '0 auto',
        padding: '20px',
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        ...style 
      }}
    >
      <div style={getFormLayoutStyles()}>
        {fields.map(renderField)}
      </div>
      
      <div style={{ 
        display: 'flex', 
        gap: '12px', 
        justifyContent: 'flex-end',
        marginTop: '30px',
        paddingTop: '20px',
        borderTop: '1px solid #e5e7eb'
      }}>
        {showReset && (
          <button
            type="button"
            onClick={handleReset}
            style={{
              padding: '12px 24px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              backgroundColor: 'white',
              color: '#374151',
              fontSize: '14px',
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
            {resetLabel}
          </button>
        )}
        
        <button
          type="submit"
          style={{
            padding: '12px 24px',
            border: 'none',
            borderRadius: '6px',
            backgroundColor: '#3b82f6',
            color: 'white',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s',
            ...submitButtonStyle,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#2563eb';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = submitButtonStyle?.backgroundColor || '#3b82f6';
          }}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
};