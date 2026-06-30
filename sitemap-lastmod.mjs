// Builds a map of URL pathname -> ISO `lastmod` date for the sitemap.
//
// Blog posts use their frontmatter date (updatedDate, falling back to pubDate).
// Static pages use the git last-commit date of their source file. The map is
// keyed by pathname (e.g. "/blog/what-are-you/") so the sitemap `serialize`
// hook can look each URL up regardless of the configured `site` origin.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('./', import.meta.url);
const fromRoot = (p) => fileURLToPath(new URL(p, root));

/** Pull a YAML date value (pubDate / updatedDate) out of a frontmatter block. */
function readFrontmatterDate(file) {
	const text = readFileSync(file, 'utf8');
	const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!fm) return undefined;
	const block = fm[1];
	const get = (key) => {
		const m = block.match(new RegExp(`^${key}:\\s*['"]?([^'"\\n]+)['"]?\\s*$`, 'm'));
		return m ? new Date(m[1]) : undefined;
	};
	const d = get('updatedDate') ?? get('pubDate');
	return d && !Number.isNaN(d.getTime()) ? d : undefined;
}

/** Last git commit date for a file, or its mtime if git history is unavailable. */
function gitLastModified(file) {
	try {
		const iso = execSync(`git log -1 --format=%cI -- "${file}"`, {
			cwd: fromRoot('.'),
			stdio: ['ignore', 'pipe', 'ignore'],
		})
			.toString()
			.trim();
		if (iso) return new Date(iso);
	} catch {
		// fall through to mtime
	}
	return existsSync(file) ? statSync(file).mtime : undefined;
}

export function buildLastmodMap() {
	const map = new Map();

	// Blog posts: /blog/<id>/ -> frontmatter date.
	const blogDir = fromRoot('src/content/blog');
	if (existsSync(blogDir)) {
		for (const name of readdirSync(blogDir)) {
			if (!/\.(md|mdx)$/.test(name)) continue;
			const id = name.replace(/\.(md|mdx)$/, '');
			const date = readFrontmatterDate(`${blogDir}/${name}`);
			if (date) map.set(`/blog/${id}/`, date.toISOString());
		}
	}

	// Static pages: pathname -> source file, dated by git history.
	const staticPages = {
		'/': 'src/pages/index.astro',
		'/about/': 'src/pages/about.astro',
		'/blog/': 'src/pages/blog/index.astro',
	};
	for (const [pathname, src] of Object.entries(staticPages)) {
		const date = gitLastModified(fromRoot(src));
		if (date) map.set(pathname, date.toISOString());
	}

	return map;
}
