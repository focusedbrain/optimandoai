import React from 'react';

interface FileListProps {
	files: string[];
	onSelectFile: (file: string) => void;
	selectedFile?: string;
}

export const FileList: React.FC<FileListProps> = ({ files, onSelectFile, selectedFile }) => {
	if (files.length === 0) {
		return <div className="text-slate-500 text-sm text-center py-4">No changed files</div>;
	}

	return (
		<ul className="space-y-1">
			{files.map((file) => (
				<li key={file}>
					<button
						onClick={() => onSelectFile(file)}
						className={`w-full text-left px-3 py-2 rounded text-sm truncate transition-colors ${selectedFile === file
								? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
								: 'hover:bg-slate-100 dark:hover:bg-slate-800'
							}`}
						title={file}
					>
						{file}
					</button>
				</li>
			))}
		</ul>
	);
};
