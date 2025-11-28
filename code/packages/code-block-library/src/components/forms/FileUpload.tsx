import React, { useRef, useState } from 'react';

export interface FileUploadProps {
  onFileSelect: (files: File[]) => void;
  onFileRemove?: (file: File, index: number) => void;
  multiple?: boolean;
  accept?: string;
  maxFileSize?: number; // in bytes
  maxFiles?: number;
  disabled?: boolean;
  dragAndDrop?: boolean;
  showPreview?: boolean;
  showFileList?: boolean;
  uploadText?: string;
  browseText?: string;
  removeText?: string;
  style?: React.CSSProperties;
  className?: string;
  dropzoneStyle?: React.CSSProperties;
  previewStyle?: React.CSSProperties;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onFileSelect,
  onFileRemove,
  multiple = false,
  accept,
  maxFileSize = 10 * 1024 * 1024, // 10MB default
  maxFiles = 10,
  disabled = false,
  dragAndDrop = true,
  showPreview = true,
  showFileList = true,
  uploadText = 'Drag and drop files here, or click to browse',
  browseText = 'Browse Files',
  removeText = 'Remove',
  style,
  className,
  dropzoneStyle,
  previewStyle,
}) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Validate file
  const validateFile = (file: File): string | null => {
    if (file.size > maxFileSize) {
      return `File "${file.name}" is too large. Maximum size is ${formatFileSize(maxFileSize)}.`;
    }

    if (accept) {
      const acceptedTypes = accept.split(',').map(type => type.trim());
      const isValid = acceptedTypes.some(type => {
        if (type.startsWith('.')) {
          return file.name.toLowerCase().endsWith(type.toLowerCase());
        } else {
          return file.type.match(type.replace('*', '.*'));
        }
      });
      
      if (!isValid) {
        return `File "${file.name}" is not a supported file type.`;
      }
    }

    return null;
  };

  // Handle file selection
  const handleFiles = (files: FileList | null) => {
    if (!files || disabled) return;

    const newFiles = Array.from(files);
    const currentFileCount = selectedFiles.length;
    
    // Check file count limit
    if (multiple && currentFileCount + newFiles.length > maxFiles) {
      setErrors([`Cannot upload more than ${maxFiles} files.`]);
      return;
    }

    if (!multiple && newFiles.length > 1) {
      setErrors(['Only one file is allowed.']);
      return;
    }

    // Validate files
    const validFiles: File[] = [];
    const newErrors: string[] = [];

    newFiles.forEach(file => {
      const error = validateFile(file);
      if (error) {
        newErrors.push(error);
      } else {
        validFiles.push(file);
      }
    });

    if (newErrors.length > 0) {
      setErrors(newErrors);
      return;
    }

    // Update selected files
    const updatedFiles = multiple ? [...selectedFiles, ...validFiles] : validFiles;
    setSelectedFiles(updatedFiles);
    setErrors([]);
    onFileSelect(updatedFiles);
  };

  // Handle file removal
  const handleRemoveFile = (fileToRemove: File, index: number) => {
    const updatedFiles = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(updatedFiles);
    onFileSelect(updatedFiles);
    
    if (onFileRemove) {
      onFileRemove(fileToRemove, index);
    }
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && dragAndDrop) {
      setDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    
    if (!disabled && dragAndDrop) {
      handleFiles(e.dataTransfer.files);
    }
  };

  // Handle click to browse
  const handleBrowseClick = () => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Get file type icon
  const getFileIcon = (file: File): string => {
    const type = file.type.toLowerCase();
    if (type.startsWith('image/')) return '🖼️';
    if (type.startsWith('video/')) return '🎥';
    if (type.startsWith('audio/')) return '🎵';
    if (type.includes('pdf')) return '📄';
    if (type.includes('word') || type.includes('doc')) return '📝';
    if (type.includes('excel') || type.includes('sheet')) return '📊';
    if (type.includes('powerpoint') || type.includes('presentation')) return '📽️';
    if (type.includes('zip') || type.includes('rar') || type.includes('archive')) return '📦';
    return '📎';
  };

  // Generate preview for images
  const generatePreview = (file: File): string | null => {
    if (file.type.startsWith('image/')) {
      return URL.createObjectURL(file);
    }
    return null;
  };

  return (
    <div className={className} style={{ width: '100%', ...style }}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        onChange={(e) => handleFiles(e.target.files)}
        style={{ display: 'none' }}
        disabled={disabled}
      />

      {/* Dropzone */}
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleBrowseClick}
        style={{
          border: `2px dashed ${dragOver ? '#3b82f6' : errors.length > 0 ? '#ef4444' : '#d1d5db'}`,
          borderRadius: '8px',
          padding: '40px 20px',
          textAlign: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          backgroundColor: dragOver ? '#f0f9ff' : disabled ? '#f9fafb' : '#ffffff',
          transition: 'all 0.2s ease',
          opacity: disabled ? 0.6 : 1,
          ...dropzoneStyle,
        }}
      >
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>
          {dragOver ? '📤' : '📁'}
        </div>
        
        <div style={{ 
          fontSize: '16px', 
          color: '#6b7280', 
          marginBottom: '12px',
          lineHeight: '1.5'
        }}>
          {dragAndDrop ? uploadText : 'Click to select files'}
        </div>
        
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleBrowseClick();
          }}
          disabled={disabled}
          style={{
            padding: '10px 20px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1,
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => {
            if (!disabled) {
              e.currentTarget.style.backgroundColor = '#2563eb';
            }
          }}
          onMouseLeave={(e) => {
            if (!disabled) {
              e.currentTarget.style.backgroundColor = '#3b82f6';
            }
          }}
        >
          {browseText}
        </button>

        <div style={{ 
          fontSize: '12px', 
          color: '#9ca3af', 
          marginTop: '12px' 
        }}>
          {accept && `Accepted formats: ${accept}`}
          {maxFileSize && (
            <div>Maximum file size: {formatFileSize(maxFileSize)}</div>
          )}
          {multiple && maxFiles && (
            <div>Maximum {maxFiles} files</div>
          )}
        </div>
      </div>

      {/* Error Messages */}
      {errors.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          {errors.map((error, index) => (
            <div key={index} style={{ 
              color: '#ef4444', 
              fontSize: '14px',
              marginBottom: '4px',
              fontWeight: '500'
            }}>
              {error}
            </div>
          ))}
        </div>
      )}

      {/* File List */}
      {showFileList && selectedFiles.length > 0 && (
        <div style={{ 
          marginTop: '20px',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          overflow: 'hidden'
        }}>
          <div style={{ 
            padding: '12px 16px',
            backgroundColor: '#f9fafb',
            borderBottom: '1px solid #e5e7eb',
            fontSize: '14px',
            fontWeight: '600',
            color: '#374151'
          }}>
            Selected Files ({selectedFiles.length})
          </div>
          
          {selectedFiles.map((file, index) => {
            const previewUrl = showPreview ? generatePreview(file) : null;
            
            return (
              <div key={index} style={{ 
                padding: '16px',
                borderBottom: index < selectedFiles.length - 1 ? '1px solid #e5e7eb' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                {/* File Preview or Icon */}
                {previewUrl ? (
                  <img 
                    src={previewUrl}
                    alt={file.name}
                    style={{ 
                      width: '48px', 
                      height: '48px', 
                      objectFit: 'cover',
                      borderRadius: '6px',
                      border: '1px solid #e5e7eb',
                      ...previewStyle
                    }}
                  />
                ) : (
                  <div style={{ 
                    fontSize: '24px',
                    width: '48px',
                    height: '48px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {getFileIcon(file)}
                  </div>
                )}
                
                {/* File Info */}
                <div style={{ flex: 1 }}>
                  <div style={{ 
                    fontWeight: '600',
                    color: '#374151',
                    fontSize: '14px',
                    marginBottom: '4px'
                  }}>
                    {file.name}
                  </div>
                  <div style={{ 
                    fontSize: '12px',
                    color: '#6b7280'
                  }}>
                    {formatFileSize(file.size)} • {file.type || 'Unknown type'}
                  </div>
                </div>
                
                {/* Remove Button */}
                <button
                  type="button"
                  onClick={() => handleRemoveFile(file, index)}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#ef4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#dc2626';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#ef4444';
                  }}
                >
                  {removeText}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};