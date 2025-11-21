import React, { useState, useEffect } from 'react';

import { MiniAppContainer, FileList, DiffViewer } from '@shared/components';

// --- Main Component ---

export const GlassDoorMiniApp: React.FC = () => {
	const [projectPath, setProjectPath] = useState('');
	const [isWatching, setIsWatching] = useState(false);
	const [changedFiles, setChangedFiles] = useState<string[]>([]);
	const [selectedFile, setSelectedFile] = useState<string | undefined>(undefined);
	const [diff, setDiff] = useState('');
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const handleMessage = (message: any) => {
			if (message.type === 'WATCHING_STARTED') {
				setIsWatching(true);
				setError(null);
			}
			if (message.type === 'WATCHING_STOPPED') {
				setIsWatching(false);
				setChangedFiles([]);
				setSelectedFile(undefined);
				setDiff('');
			}
			if (message.type === 'FILE_CHANGED') {
				// Ideally we should re-fetch the list of changed files or update it incrementally
				// For now, let's just add it if it's not there (simplification)
				// In a real app, we'd ask for the full status
				const path = message.payload.path;
				setChangedFiles(prev => Array.from(new Set([...prev, path])));
			}
			if (message.type === 'DIFF_RESULT') {
				setDiff(message.diff);
			}
			if (message.type === 'DIFF_ERROR') {
				setError(message.error);
			}
		};

		chrome.runtime.onMessage.addListener(handleMessage);
		return () => chrome.runtime.onMessage.removeListener(handleMessage);
	}, []);

	const handleStartWatching = () => {
		if (!projectPath) return;
		chrome.runtime.sendMessage({ type: 'START_WATCHING', path: projectPath });
	};

	const handleStopWatching = () => {
		chrome.runtime.sendMessage({ type: 'STOP_WATCHING' });
	};

	const handleSelectFile = (file: string) => {
		setSelectedFile(file);
		chrome.runtime.sendMessage({ type: 'GET_DIFF', filePath: file, projectRoot: projectPath });
	};

	return (
		<MiniAppContainer title="WR-Code-GlassDoor">
			<div className="space-y-4">
				{!isWatching ? (
					<div className="space-y-2">
						<label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
							Project Path
						</label>
						<div className="flex gap-2">
							<input
								type="text"
								value={projectPath}
								onChange={(e) => setProjectPath(e.target.value)}
								placeholder="/path/to/your/project"
								className="flex-1 px-3 py-2 text-xs border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
							/>
							<button
								onClick={handleStartWatching}
								disabled={!projectPath}
								className="px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								Watch
							</button>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<div className="text-xs text-slate-500 truncate flex-1 mr-2" title={projectPath}>
								Watching: {projectPath}
							</div>
							<button
								onClick={handleStopWatching}
								className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
							>
								Stop
							</button>
						</div>

						<div className="grid grid-cols-1 gap-4">
							<div className="border border-slate-200 dark:border-slate-700 rounded p-2 max-h-40 overflow-y-auto">
								<h3 className="text-xs font-semibold mb-2 text-slate-700 dark:text-slate-300">Changed Files</h3>
								<FileList files={changedFiles} onSelectFile={handleSelectFile} selectedFile={selectedFile} />
							</div>

							<div className="border border-slate-200 dark:border-slate-700 rounded p-2">
								<h3 className="text-xs font-semibold mb-2 text-slate-700 dark:text-slate-300">Diff</h3>
								<DiffViewer diff={diff} />
							</div>
						</div>
					</div>
				)}

				{error && (
					<div className="p-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
						Error: {error}
					</div>
				)}
			</div>
		</MiniAppContainer>
	);
};
