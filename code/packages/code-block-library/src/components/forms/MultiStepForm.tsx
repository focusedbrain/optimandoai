import React, { useState, useEffect } from 'react';

export interface MultiStepFormStep {
  id: string;
  title: string;
  description?: string;
  fields: Array<{
    name: string;
    type: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'file' | 'date';
    label: string;
    placeholder?: string;
    required?: boolean;
    validation?: {
      pattern?: string;
      minLength?: number;
      maxLength?: number;
      min?: number;
      max?: number;
      custom?: (value: any) => string | null;
    };
    options?: { value: string | number; label: string }[];
    multiple?: boolean;
    rows?: number;
    defaultValue?: any;
    disabled?: boolean;
    hint?: string;
  }>;
  validation?: (data: Record<string, any>) => Record<string, string> | null; // Custom step validation
}

export interface MultiStepFormProps {
  steps: MultiStepFormStep[];
  onStepComplete?: (stepId: string, stepData: Record<string, any>, allData: Record<string, any>) => void;
  onFormComplete: (allData: Record<string, any>) => void;
  onStepChange?: (currentStep: number, stepId: string) => void;
  allowStepNavigation?: boolean;
  showStepNumbers?: boolean;
  showProgressBar?: boolean;
  nextLabel?: string;
  prevLabel?: string;
  submitLabel?: string;
  style?: React.CSSProperties;
  className?: string;
  stepHeaderStyle?: React.CSSProperties;
  stepContentStyle?: React.CSSProperties;
}

export const MultiStepForm: React.FC<MultiStepFormProps> = ({
  steps,
  onStepComplete,
  onFormComplete,
  onStepChange,
  allowStepNavigation = false,
  showStepNumbers = true,
  showProgressBar = true,
  nextLabel = 'Next',
  prevLabel = 'Previous',
  submitLabel = 'Submit',
  style,
  className,
  stepHeaderStyle,
  stepContentStyle,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [stepData, setStepData] = useState<Record<string, Record<string, any>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const currentStep = steps[currentStepIndex];

  // Initialize step data
  useEffect(() => {
    const initialStepData: Record<string, Record<string, any>> = {};
    const initialFormData: Record<string, any> = {};

    steps.forEach(step => {
      const stepInitialData: Record<string, any> = {};
      step.fields.forEach(field => {
        if (field.defaultValue !== undefined) {
          stepInitialData[field.name] = field.defaultValue;
          initialFormData[field.name] = field.defaultValue;
        } else if (field.type === 'checkbox') {
          stepInitialData[field.name] = false;
          initialFormData[field.name] = false;
        } else if (field.type === 'select' && field.multiple) {
          stepInitialData[field.name] = [];
          initialFormData[field.name] = [];
        } else {
          stepInitialData[field.name] = '';
          initialFormData[field.name] = '';
        }
      });
      initialStepData[step.id] = stepInitialData;
    });

    setStepData(initialStepData);
    setFormData(initialFormData);
  }, [steps]);

  // Validation function
  const validateField = (field: any, value: any): string | null => {
    if (field.required && (!value || value === '' || (Array.isArray(value) && value.length === 0))) {
      return `${field.label} is required`;
    }

    if (!value || value === '') return null;

    const validation = field.validation;
    if (!validation) return null;

    if (validation.pattern && typeof value === 'string') {
      const regex = new RegExp(validation.pattern);
      if (!regex.test(value)) {
        return `${field.label} format is invalid`;
      }
    }

    if (validation.minLength && typeof value === 'string' && value.length < validation.minLength) {
      return `${field.label} must be at least ${validation.minLength} characters`;
    }

    if (validation.maxLength && typeof value === 'string' && value.length > validation.maxLength) {
      return `${field.label} must be no more than ${validation.maxLength} characters`;
    }

    if (validation.min !== undefined && typeof value === 'number' && value < validation.min) {
      return `${field.label} must be at least ${validation.min}`;
    }

    if (validation.max !== undefined && typeof value === 'number' && value > validation.max) {
      return `${field.label} must be no more than ${validation.max}`;
    }

    if (validation.custom) {
      return validation.custom(value);
    }

    return null;
  };

  // Validate current step
  const validateCurrentStep = (): boolean => {
    const newErrors: Record<string, string> = {};
    let hasErrors = false;

    // Field validations
    currentStep.fields.forEach(field => {
      const value = formData[field.name];
      const error = validateField(field, value);
      if (error) {
        newErrors[field.name] = error;
        hasErrors = true;
      }
    });

    // Custom step validation
    if (currentStep.validation) {
      const currentStepData = stepData[currentStep.id] || {};
      const stepErrors = currentStep.validation(currentStepData);
      if (stepErrors) {
        Object.assign(newErrors, stepErrors);
        hasErrors = true;
      }
    }

    setErrors(newErrors);
    setTouched(Object.fromEntries(currentStep.fields.map(f => [f.name, true])));

    return !hasErrors;
  };

  // Handle field change
  const handleFieldChange = (fieldName: string, value: any) => {
    const newFormData = { ...formData, [fieldName]: value };
    const newStepData = {
      ...stepData,
      [currentStep.id]: {
        ...stepData[currentStep.id],
        [fieldName]: value,
      },
    };

    setFormData(newFormData);
    setStepData(newStepData);

    // Clear error if field becomes valid
    if (touched[fieldName] && errors[fieldName]) {
      const field = currentStep.fields.find(f => f.name === fieldName);
      if (field) {
        const error = validateField(field, value);
        if (!error) {
          setErrors(prev => ({ ...prev, [fieldName]: '' }));
        }
      }
    }
  };

  // Handle field blur
  const handleFieldBlur = (fieldName: string) => {
    setTouched(prev => ({ ...prev, [fieldName]: true }));
    
    const field = currentStep.fields.find(f => f.name === fieldName);
    if (field) {
      const error = validateField(field, formData[fieldName]);
      setErrors(prev => ({ ...prev, [fieldName]: error || '' }));
    }
  };

  // Navigate to next step
  const handleNext = () => {
    if (validateCurrentStep()) {
      setCompletedSteps(prev => new Set([...prev, currentStepIndex]));
      
      if (onStepComplete) {
        onStepComplete(currentStep.id, stepData[currentStep.id], formData);
      }

      if (currentStepIndex < steps.length - 1) {
        const nextIndex = currentStepIndex + 1;
        setCurrentStepIndex(nextIndex);
        setErrors({});
        setTouched({});
        
        if (onStepChange) {
          onStepChange(nextIndex, steps[nextIndex].id);
        }
      } else {
        // Form complete
        onFormComplete(formData);
      }
    }
  };

  // Navigate to previous step
  const handlePrevious = () => {
    if (currentStepIndex > 0) {
      const prevIndex = currentStepIndex - 1;
      setCurrentStepIndex(prevIndex);
      setErrors({});
      setTouched({});
      
      if (onStepChange) {
        onStepChange(prevIndex, steps[prevIndex].id);
      }
    }
  };

  // Navigate to specific step (if allowed)
  const goToStep = (stepIndex: number) => {
    if (allowStepNavigation && stepIndex >= 0 && stepIndex < steps.length) {
      setCurrentStepIndex(stepIndex);
      setErrors({});
      setTouched({});
      
      if (onStepChange) {
        onStepChange(stepIndex, steps[stepIndex].id);
      }
    }
  };

  // Render field
  const renderField = (field: any) => {
    const hasError = touched[field.name] && errors[field.name];
    const fieldId = `step-field-${field.name}`;

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
      },
      onBlur: () => handleFieldBlur(field.name),
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
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
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
                handleFieldChange(field.name, values);
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
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
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
              onChange={(e) => handleFieldChange(field.name, e.target.checked)}
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
                  onChange={(e) => handleFieldChange(field.name, e.target.value)}
                  style={{ margin: 0, transform: 'scale(1.2)' }}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
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
              handleFieldChange(field.name, value);
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

  const progressPercentage = ((currentStepIndex + 1) / steps.length) * 100;

  return (
    <div 
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
      {/* Step Header */}
      <div style={{ marginBottom: '40px', ...stepHeaderStyle }}>
        {/* Progress Bar */}
        {showProgressBar && (
          <div style={{ 
            marginBottom: '20px',
            backgroundColor: '#f3f4f6',
            borderRadius: '8px',
            overflow: 'hidden',
            height: '8px'
          }}>
            <div style={{
              width: `${progressPercentage}%`,
              height: '100%',
              backgroundColor: '#3b82f6',
              transition: 'width 0.3s ease',
            }} />
          </div>
        )}

        {/* Step Navigation */}
        {showStepNumbers && (
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: '20px',
            overflowX: 'auto',
            padding: '0 0 10px 0'
          }}>
            {steps.map((step, index) => {
              const isActive = index === currentStepIndex;
              const isCompleted = completedSteps.has(index);
              const isClickable = allowStepNavigation && (isCompleted || index <= currentStepIndex);
              
              return (
                <div
                  key={step.id}
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center',
                    cursor: isClickable ? 'pointer' : 'default',
                    opacity: isClickable ? 1 : 0.6,
                    minWidth: 'fit-content'
                  }}
                  onClick={() => isClickable && goToStep(index)}
                >
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isActive ? '#3b82f6' : isCompleted ? '#10b981' : '#e5e7eb',
                    color: isActive || isCompleted ? 'white' : '#6b7280',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    transition: 'all 0.2s'
                  }}>
                    {isCompleted ? '✓' : index + 1}
                  </div>
                  <div style={{ 
                    marginLeft: '8px',
                    fontSize: '14px',
                    fontWeight: isActive ? '600' : '400',
                    color: isActive ? '#1f2937' : '#6b7280'
                  }}>
                    {step.title}
                  </div>
                  {index < steps.length - 1 && (
                    <div style={{
                      width: '20px',
                      height: '2px',
                      backgroundColor: '#e5e7eb',
                      margin: '0 12px'
                    }} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Current Step Info */}
        <div>
          <h2 style={{ 
            margin: '0 0 8px 0', 
            fontSize: '24px',
            fontWeight: 'bold',
            color: '#1f2937'
          }}>
            {currentStep.title}
          </h2>
          {currentStep.description && (
            <p style={{ 
              margin: 0, 
              color: '#6b7280',
              fontSize: '16px',
              lineHeight: '1.5'
            }}>
              {currentStep.description}
            </p>
          )}
        </div>
      </div>

      {/* Step Content */}
      <div style={{ marginBottom: '40px', ...stepContentStyle }}>
        {currentStep.fields.map(renderField)}
      </div>

      {/* Navigation Buttons */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between',
        paddingTop: '20px',
        borderTop: '1px solid #e5e7eb'
      }}>
        <button
          type="button"
          onClick={handlePrevious}
          disabled={currentStepIndex === 0}
          style={{
            padding: '12px 24px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            backgroundColor: 'white',
            color: '#374151',
            fontSize: '14px',
            fontWeight: '600',
            cursor: currentStepIndex === 0 ? 'not-allowed' : 'pointer',
            opacity: currentStepIndex === 0 ? 0.5 : 1,
            transition: 'all 0.2s',
          }}
        >
          {prevLabel}
        </button>

        <button
          type="button"
          onClick={handleNext}
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
          }}
        >
          {currentStepIndex === steps.length - 1 ? submitLabel : nextLabel}
        </button>
      </div>
    </div>
  );
};