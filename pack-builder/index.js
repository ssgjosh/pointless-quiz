#!/usr/bin/env node
/**
 * Pointless Pack Builder
 *
 * Generates game packs from YAML category definitions by:
 * 1. Running SPARQL queries against Wikidata
 * 2. Fetching Wikipedia pageviews for scoring
 * 3. Computing 0-100 "pointless" scores
 * 4. Fetching images and attribution from Wikimedia Commons
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '.cache');

// Rate limiting
const RATE_LIMIT_MS = 100;
let lastRequestTime = 0;

async function rateLimitedFetch(url, options = {}) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < RATE_LIMIT_MS) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();

    const response = await fetch(url, {
        ...options,
        headers: {
            'User-Agent': 'PointlessGamePackBuilder/1.0 (Family Quiz Night; contact@example.com)',
            ...options.headers
        }
    });
    return response;
}

// Cache helpers
function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}

function getCacheKey(type, id) {
    return path.join(CACHE_DIR, `${type}_${id.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
}

function getFromCache(type, id) {
    const cacheFile = getCacheKey(type, id);
    if (fs.existsSync(cacheFile)) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        // Cache valid for 7 days
        if (Date.now() - cached.timestamp < 7 * 24 * 60 * 60 * 1000) {
            return cached.data;
        }
    }
    return null;
}

function saveToCache(type, id, data) {
    ensureCacheDir();
    const cacheFile = getCacheKey(type, id);
    fs.writeFileSync(cacheFile, JSON.stringify({ timestamp: Date.now(), data }));
}

/**
 * Run a SPARQL query against Wikidata
 */
async function runSparqlQuery(sparql) {
    const cacheKey = Buffer.from(sparql).toString('base64').slice(0, 50);
    const cached = getFromCache('sparql', cacheKey);
    if (cached) {
        console.log('  Using cached SPARQL results');
        return cached;
    }

    const url = 'https://query.wikidata.org/sparql';
    const response = await rateLimitedFetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/sparql-results+json'
        },
        body: `query=${encodeURIComponent(sparql)}`
    });

    if (!response.ok) {
        throw new Error(`SPARQL query failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    saveToCache('sparql', cacheKey, data);
    return data;
}

/**
 * Fetch Wikipedia pageviews for an article
 */
async function getPageviews(articleTitle, days = 365) {
    const cached = getFromCache('pageviews', `${articleTitle}_${days}`);
    if (cached !== null) {
        return cached;
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const formatDate = (d) => d.toISOString().split('T')[0].replace(/-/g, '');

    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${encodeURIComponent(articleTitle)}/daily/${formatDate(startDate)}/${formatDate(endDate)}`;

    try {
        const response = await rateLimitedFetch(url);
        if (!response.ok) {
            saveToCache('pageviews', `${articleTitle}_${days}`, 0);
            return 0;
        }
        const data = await response.json();
        const totalViews = data.items?.reduce((sum, item) => sum + item.views, 0) || 0;
        saveToCache('pageviews', `${articleTitle}_${days}`, totalViews);
        return totalViews;
    } catch (e) {
        saveToCache('pageviews', `${articleTitle}_${days}`, 0);
        return 0;
    }
}

/**
 * Get image info and attribution from Wikimedia Commons
 */
async function getImageInfo(commonsFilename) {
    if (!commonsFilename) return null;

    // Extract filename from URL if needed
    let filename = commonsFilename;
    if (filename.includes('commons.wikimedia.org')) {
        filename = decodeURIComponent(filename.split('/').pop());
    }
    if (filename.startsWith('File:')) {
        filename = filename.substring(5);
    }

    const cached = getFromCache('imageinfo', filename);
    if (cached) {
        return cached;
    }

    const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(filename)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&format=json`;

    try {
        const response = await rateLimitedFetch(url);
        const data = await response.json();
        const pages = data.query?.pages;
        const page = pages ? Object.values(pages)[0] : null;
        const imageinfo = page?.imageinfo?.[0];

        if (!imageinfo) {
            saveToCache('imageinfo', filename, null);
            return null;
        }

        const meta = imageinfo.extmetadata || {};
        const result = {
            url: imageinfo.thumburl || imageinfo.url,
            fullUrl: imageinfo.url,
            author: meta.Artist?.value?.replace(/<[^>]*>/g, '') || 'Unknown',
            license: meta.LicenseShortName?.value || 'Unknown license',
            licenseUrl: meta.LicenseUrl?.value || null,
            description: meta.ImageDescription?.value?.replace(/<[^>]*>/g, '') || '',
            source: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(filename)}`
        };

        saveToCache('imageinfo', filename, result);
        return result;
    } catch (e) {
        console.error(`  Failed to get image info for ${filename}:`, e.message);
        saveToCache('imageinfo', filename, null);
        return null;
    }
}

/**
 * Extract Wikipedia article title from SPARQL result
 */
function extractArticleTitle(articleUrl) {
    if (!articleUrl) return null;
    const match = articleUrl.match(/wikipedia\.org\/wiki\/(.+)$/);
    return match ? decodeURIComponent(match[1].replace(/_/g, ' ')) : null;
}

/**
 * Extract Commons filename from Wikidata image URL
 */
function extractCommonsFilename(imageUrl) {
    if (!imageUrl) return null;
    if (imageUrl.includes('commons.wikimedia.org')) {
        return decodeURIComponent(imageUrl.split('/').pop());
    }
    return imageUrl;
}

/**
 * Compute pointless scores using log-normalized pageviews
 */
function computeScores(answers, pointlessPercentile = 10) {
    // Calculate log popularity for each answer
    const withPop = answers.map(a => ({
        ...a,
        logPop: Math.log10(a.pageviews + 1)
    }));

    if (withPop.length === 0) return [];

    const pops = withPop.map(a => a.logPop);
    const minPop = Math.min(...pops);
    const maxPop = Math.max(...pops);
    const range = maxPop - minPop || 1;

    // Calculate normalized scores
    const scored = withPop.map(a => {
        const norm = (a.logPop - minPop) / range;
        return {
            ...a,
            rawScore: Math.round(norm * 100)
        };
    });

    // Find the threshold for "pointless" answers (bottom percentile)
    const sortedScores = [...scored].sort((a, b) => a.rawScore - b.rawScore);
    const thresholdIndex = Math.floor(sortedScores.length * (pointlessPercentile / 100));
    const pointlessThreshold = sortedScores[thresholdIndex]?.rawScore || 0;

    // Apply pointless threshold - anything at or below becomes 0
    return scored.map(a => ({
        ...a,
        points: a.rawScore <= pointlessThreshold ? 0 : a.rawScore
    }));
}

/**
 * Process a single category
 */
async function processCategory(category) {
    console.log(`\nProcessing category: ${category.prompt}`);

    // Run SPARQL query
    console.log('  Running SPARQL query...');
    const sparqlResults = await runSparqlQuery(category.sparql);
    const bindings = sparqlResults.results?.bindings || [];
    console.log(`  Found ${bindings.length} items`);

    if (bindings.length === 0) {
        console.log('  WARNING: No results from SPARQL query!');
        return { ...category, answers: [] };
    }

    // Process each answer
    const answers = [];
    const seenLabels = new Set();

    for (let i = 0; i < bindings.length; i++) {
        const binding = bindings[i];
        const label = binding.itemLabel?.value;

        if (!label || seenLabels.has(label.toLowerCase())) continue;
        seenLabels.add(label.toLowerCase());

        const articleTitle = extractArticleTitle(binding.article?.value);
        const wikidataId = binding.item?.value?.split('/').pop();

        process.stdout.write(`\r  Processing ${i + 1}/${bindings.length}: ${label.padEnd(40).slice(0, 40)}`);

        // Get pageviews
        const days = category.scoring?.window_days || 365;
        const pageviews = articleTitle ? await getPageviews(articleTitle, days) : 0;

        // Build answer object
        const answer = {
            text: label,
            wikidataId,
            articleTitle,
            pageviews,
            aliases: [] // Could be expanded with Wikidata aliases
        };

        // Get image if enabled
        if (category.images?.enabled !== false && binding.image?.value) {
            const filename = extractCommonsFilename(binding.image.value);
            const imageInfo = await getImageInfo(filename);
            if (imageInfo) {
                answer.image = imageInfo;
            }
        }

        answers.push(answer);
    }

    console.log(''); // New line after progress

    // Compute scores
    console.log('  Computing scores...');
    const pointlessPercentile = category.scoring?.pointless_percentile || 10;
    const scoredAnswers = computeScores(answers, pointlessPercentile);

    // Log score distribution
    const pointlessCount = scoredAnswers.filter(a => a.points === 0).length;
    const avgScore = scoredAnswers.reduce((s, a) => s + a.points, 0) / scoredAnswers.length;
    console.log(`  Score distribution: ${pointlessCount} pointless (0), avg score: ${avgScore.toFixed(1)}`);

    // Clean up answer objects for output
    const cleanAnswers = scoredAnswers.map(a => ({
        text: a.text,
        aliases: a.aliases,
        points: a.points,
        wikidataId: a.wikidataId,
        ...(a.image && { image: a.image })
    }));

    return {
        id: category.id,
        prompt: category.prompt,
        answers: cleanAnswers
    };
}

/**
 * Main pack builder function
 */
async function buildPack(yamlPath, outputDir) {
    console.log(`\n${'='.repeat(60)}`);
    console.log('POINTLESS PACK BUILDER');
    console.log('='.repeat(60));

    // Read YAML
    const yamlContent = fs.readFileSync(yamlPath, 'utf8');
    const packDef = YAML.parse(yamlContent);

    console.log(`\nPack: ${packDef.title}`);
    console.log(`Categories: ${packDef.categories.length}`);

    // Process each category
    const categories = [];
    for (const categoryDef of packDef.categories) {
        const processed = await processCategory(categoryDef);
        categories.push(processed);
    }

    // Build final pack
    const pack = {
        title: packDef.title,
        version: packDef.version || 1,
        generatedAt: new Date().toISOString(),
        categories
    };

    // Ensure output directory exists
    const packDir = path.join(outputDir, packDef.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    if (!fs.existsSync(packDir)) {
        fs.mkdirSync(packDir, { recursive: true });
    }

    // Write pack.json
    const outputPath = path.join(packDir, 'pack.json');
    fs.writeFileSync(outputPath, JSON.stringify(pack, null, 2));

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Pack saved to: ${outputPath}`);
    console.log(`Total categories: ${categories.length}`);
    console.log(`Total answers: ${categories.reduce((s, c) => s + c.answers.length, 0)}`);
    console.log('='.repeat(60));

    return pack;
}

// CLI
const args = process.argv.slice(2);
if (args.length < 1) {
    console.log('Usage: node pack-builder/index.js <path-to-yaml> [output-dir]');
    console.log('');
    console.log('Example:');
    console.log('  node pack-builder/index.js categories/uk-general.yaml packs/');
    process.exit(1);
}

const yamlPath = args[0];
const outputDir = args[1] || path.join(path.dirname(yamlPath), '..', 'packs');

buildPack(yamlPath, outputDir).catch(err => {
    console.error('Error building pack:', err);
    process.exit(1);
});
