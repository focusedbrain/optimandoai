import React from 'react';

interface DiffViewerProps {
	diff: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ diff }) => {
	if (!diff) {
		return <div className="text-slate-500 text-sm text-center py-8">Select a file to view diff</div>;
	}

	return (
		<pre className="font-mono text-xs whitespace-pre-wrap overflow-x-auto p-4 bg-slate-50 dark:bg-slate-950 rounded border border-slate-200 dark:border-slate-800">
			{diff.split('\n').map((line, i) => {
				let colorClass = 'text-slate-600 dark:text-slate-400';
				if (line.startsWith('+')) colorClass = 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/10';
				if (line.startsWith('-')) colorClass = 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10';
				if (line.startsWith('@@')) colorClass = 'text-purple-600 dark:text-purple-400';

				return (
					<div key={i} className={`${colorClass} px-1`}>
						{line}
					</div>
				);
			})}
		</pre>
	);
};
