import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
	size?: 'sm' | 'md' | 'lg';
}

export const Button: React.FC<ButtonProps> = ({
	children,
	variant = 'primary',
	size = 'md',
	className = '',
	...props
}) => {
	const baseStyles = 'inline-flex items-center justify-center rounded font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed';

	const variants = {
		primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
		secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200 focus:ring-slate-500 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
		danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
		ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 focus:ring-slate-500 dark:text-slate-400 dark:hover:bg-slate-800'
	};

	const sizes = {
		sm: 'px-2 py-1 text-xs',
		md: 'px-3 py-2 text-sm',
		lg: 'px-4 py-2 text-base'
	};

	return (
		<button
			className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
			{...props}
		>
			{children}
		</button>
	);
};
