import React from 'react';

interface BadgeProps {
	children: React.ReactNode;
	variant?: 'default' | 'success' | 'warning' | 'error';
	className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
	children,
	variant = 'default',
	className = ''
}) => {
	const baseStyles = 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium';

	const variants = {
		default: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
		success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
		warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
		error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
	};

	return (
		<span className={`${baseStyles} ${variants[variant]} ${className}`}>
			{children}
		</span>
	);
};
