import simpleGit from 'simple-git';
import path from 'path';

export class DiffService {
	constructor() { }

	async getDiff(filePath: string, projectRoot: string): Promise<string> {
		try {
			const git = simpleGit(projectRoot);
			// Get diff for the specific file
			// We use relative path for git commands
			const relativePath = path.relative(projectRoot, filePath);
			const diff = await git.diff([relativePath]);
			return diff;
		} catch (error) {
			console.error(`[DiffService] Error getting diff for ${filePath}:`, error);
			return '';
		}
	}

	async getChangedFiles(projectRoot: string): Promise<string[]> {
		try {
			const git = simpleGit(projectRoot);
			const status = await git.status();
			return [...status.modified, ...status.not_added, ...status.created, ...status.deleted];
		} catch (error) {
			console.error(`[DiffService] Error getting status for ${projectRoot}:`, error);
			return [];
		}
	}
}
