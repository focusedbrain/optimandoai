import React from 'react';

interface GlassViewContainerProps {
	title: string;
	children: React.ReactNode;
	onClose?: () => void;
}

export const GlassViewContainer: React.FC<GlassViewContainerProps> = ({ title, children, onClose }) => {
	return (
		<div className="flex flex-col h-full bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
			<div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
				<h2 className="text-lg font-semibold">{title}</h2>
				{onClose && (
					<button
						onClick={onClose}
						className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
					>
						✕
					</button>
				)}
			</div>
			<div className="flex-1 overflow-auto p-4">
				{children}
			</div>
		</div>
	);
};
