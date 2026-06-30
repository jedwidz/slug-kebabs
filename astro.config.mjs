// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';
import { buildLastmodMap } from './sitemap-lastmod.mjs';

const lastmodByPath = buildLastmodMap();

// https://astro.build/config
export default defineConfig({
	site: 'https://slug-kebabs.dev',
	integrations: [
		mdx(),
		sitemap({
			// Attach a meaningful <lastmod> to each URL so downstream consumers
			// (e.g. IndexNow submission) can detect which pages actually changed.
			serialize(item) {
				const lastmod = lastmodByPath.get(new URL(item.url).pathname);
				if (lastmod) item.lastmod = lastmod;
				return item;
			},
		}),
	],
	fonts: [
		{
			provider: fontProviders.local(),
			name: 'Atkinson',
			cssVariable: '--font-atkinson',
			fallbacks: ['sans-serif'],
			options: {
				variants: [
					{
						src: ['./src/assets/fonts/atkinson-regular.woff'],
						weight: 400,
						style: 'normal',
						display: 'swap',
					},
					{
						src: ['./src/assets/fonts/atkinson-bold.woff'],
						weight: 700,
						style: 'normal',
						display: 'swap',
					},
				],
			},
		},
	],
});
