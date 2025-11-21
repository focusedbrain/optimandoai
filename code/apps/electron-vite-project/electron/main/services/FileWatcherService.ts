import chokidar from 'chokidar';
import { EventEmitter } from 'events';

export class FileWatcherService extends EventEmitter {
	private watcher: any = null;
	private isWatching = false;

	constructor() {
		super();
	}

	startWatching(targetPath: string) {
		if (this.isWatching) {
			this.stopWatching();
		}

		console.log(`[FileWatcher] Starting watch on: ${targetPath}`);

		this.watcher = chokidar.watch(targetPath, {
			ignored: [
				/(^|[\/\\])\../, // ignore dotfiles
				'**/node_modules/**',
				'**/.git/**',
				'**/dist/**',
				'**/build/**'
			],
			persistent: true,
			ignoreInitial: true
		});

		this.watcher
			.on('add', (path: string) => this.emit('file-changed', { type: 'add', path }))
			.on('change', (path: string) => this.emit('file-changed', { type: 'change', path }))
			.on('unlink', (path: string) => this.emit('file-changed', { type: 'unlink', path }));

		this.isWatching = true;
	}

	stopWatching() {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
		this.isWatching = false;
		console.log('[FileWatcher] Stopped watching');
	}
}
