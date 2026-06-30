// Submit changed URLs to IndexNow.
//
// Change detection is driven by a git commit range: every file changed since
// the last successfully-submitted commit (the `indexnow-submitted` branch) is
// mapped to the URL(s) it affects. Page/content files map to a single URL;
// shared files (layouts, components, styles, config) fall back to submitting
// the whole site; non-rendering files (docs, CI, deps) are ignored. Candidate
// URLs are intersected with the live sitemap so only real, canonical URLs are
// submitted. With no range base (first run / deleted branch) or FORCE_ALL,
// every URL is submitted.
//
// Environment variables:
//   INDEXNOW_KEY  - the IndexNow key (also hosted at https://<host>/<key>.txt)
//   SITE          - the site origin, e.g. https://slug-kebabs.dev
//   RANGE_BASE    - commit/ref of the last submission; empty => submit all
//   FORCE_ALL     - "true" to submit every URL regardless of the diff

import { execSync } from 'node:child_process';

const key = process.env.INDEXNOW_KEY;
const site = (process.env.SITE || '').replace(/\/$/, '');
const base = (process.env.RANGE_BASE || '').trim();
const forceAll = process.env.FORCE_ALL === 'true';

if (!key) {
	console.error('INDEXNOW_KEY is not set; skipping IndexNow submission.');
	process.exit(0);
}
if (!site) {
	console.error('SITE is not set; skipping IndexNow submission.');
	process.exit(0);
}

const host = new URL(site).host;

async function fetchText(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
	return res.text();
}

const extractLocs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);

/** All canonical page URLs from the sitemap index and its sub-sitemaps. */
async function collectSitemapUrls() {
	const indexXml = await fetchText(`${site}/sitemap-index.xml`);
	const isIndex = /<sitemapindex[\s>]/.test(indexXml);
	if (!isIndex) return extractLocs(indexXml);

	const urls = new Set();
	for (const sitemapUrl of extractLocs(indexXml)) {
		for (const loc of extractLocs(await fetchText(sitemapUrl))) urls.add(loc);
	}
	return [...urls];
}

/** Files changed between the range base and HEAD. */
function changedFiles() {
	const out = execSync(`git diff --name-only ${base} HEAD`, {
		stdio: ['ignore', 'pipe', 'pipe'],
	}).toString();
	return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * Map changed files to affected URL pathnames.
 * Returns { paths: Set<string>, submitAll: boolean }.
 */
function mapFilesToPaths(files) {
	const paths = new Set();
	let submitAll = false;

	for (const f of files) {
		const blog = f.match(/^src\/content\/blog\/(.+)\.(?:md|mdx)$/);
		if (blog) {
			paths.add(`/blog/${blog[1]}/`);
			continue;
		}
		if (f === 'src/pages/index.astro') {
			paths.add('/');
			continue;
		}
		if (f === 'src/pages/about.astro') {
			paths.add('/about/');
			continue;
		}
		if (f === 'src/pages/blog/index.astro') {
			paths.add('/blog/');
			continue;
		}
		// Other render-affecting files change many/all pages -> submit everything.
		if (f.startsWith('src/') || f.startsWith('public/') || f === 'astro.config.mjs' || f === 'sitemap-lastmod.mjs') {
			submitAll = true;
			continue;
		}
		// Anything else (docs, CI, dependencies) does not change rendered output.
	}

	return { paths, submitAll };
}

const sitemapUrls = await collectSitemapUrls();
if (sitemapUrls.length === 0) {
	console.error('No URLs found in sitemap; nothing to submit.');
	process.exit(0);
}

// Decide which URLs to submit.
let urlList;
if (forceAll || !base) {
	urlList = sitemapUrls;
	console.log(forceAll ? 'FORCE_ALL set: submitting all URLs.' : 'No range base: submitting all URLs.');
} else {
	const files = changedFiles();
	const { paths, submitAll } = mapFilesToPaths(files);
	if (submitAll) {
		urlList = sitemapUrls;
		console.log('A shared/render-affecting file changed: submitting all URLs.');
	} else {
		// Intersect mapped pathnames with real sitemap URLs (canonical form).
		const byPath = new Map(sitemapUrls.map((u) => [new URL(u).pathname, u]));
		urlList = [...paths].map((p) => byPath.get(p)).filter(Boolean);
	}
}

if (urlList.length === 0) {
	console.log('No new or changed URLs since the last submission; nothing to submit.');
	process.exit(0);
}

const body = {
	host,
	key,
	keyLocation: `${site}/${key}.txt`,
	urlList,
};

console.log(`Submitting ${urlList.length} of ${sitemapUrls.length} URL(s) to IndexNow for ${host}:`);
for (const u of urlList) console.log(`  ${u}`);

const res = await fetch('https://api.indexnow.org/indexnow', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json; charset=utf-8' },
	body: JSON.stringify(body),
});

const text = await res.text();
console.log(`IndexNow responded: ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`);

// 200 (OK) and 202 (Accepted) are both success responses.
if (res.status !== 200 && res.status !== 202) {
	console.error('IndexNow submission failed.');
	process.exit(1);
}
console.log('IndexNow submission succeeded.');
