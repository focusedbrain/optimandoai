import simpleGit from 'simple-git';
import path from 'path';

export class DiffService {
	constructor() { }

	async getDiff(filePath: string, projectRoot: string): Promise<string> {
		try {
			console.log('[DiffService] Getting diff for:', filePath);
			console.log('[DiffService] Project root:', projectRoot);
			
			const git = simpleGit(projectRoot);
			
			// Check if it's a git repository
			const isRepo = await git.checkIsRepo();
			console.log('[DiffService] Is git repo?', isRepo);
			
			if (!isRepo) {
				return 'This directory is not a Git repository. Initialize Git to see diffs:\n\ngit init\ngit add .\ngit commit -m "Initial commit"';
			}
			
			// Get diff for the specific file
			// We use relative path for git commands
			const relativePath = path.relative(projectRoot, filePath);
			console.log('[DiffService] Relative path:', relativePath);
			
			const diff = await git.diff([relativePath]);
			console.log('[DiffService] Diff length:', diff.length);
			
			if (!diff || diff.length === 0) {
				return `No changes detected for ${relativePath}.\n\nPossible reasons:\n- File is not tracked by Git\n- No changes since last commit\n- File needs to be staged: git add ${relativePath}`;
			}
			
			return diff;
		} catch (error) {
			console.error(`[DiffService] Error getting diff for ${filePath}:`, error);
			throw error;
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
