/**
 * Fetch UN General Assembly agenda item documents (A/X/251) for sessions 1-80
 * using undifferent/un-fetcher. Saves:
 *   - data/downloads/session_XX.json   (one raw file per session — for inspection)
 *   - data/output/agenda_items.json    (flat array of parsed agenda items — for analysis)
 *
 * Usage: node scripts/fetch-agenda-items.mjs [--start N] [--end N] [--parse-only]
 */

import {
  fetchUNDocument,
  fetchDocumentMetadata,
} from "undifferent/un-fetcher";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DL_DIR = join(__dirname, "..", "data", "downloads");
const OUT_DIR = join(__dirname, "..", "data", "output");
const PARSED_FILE = join(OUT_DIR, "agenda_items.json");

mkdirSync(DL_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const rawPath = (session) =>
  join(DL_DIR, `session_${String(session).padStart(2, "0")}.json`);

// --- Parser ---

const SECTION_RE = /^([A-Z])\.\s+(.+)$/;
const ITEM_RE = /^(\d+)\.\s+(.+)$/;
const SUB_ITEM_RE = /^\(([a-z]{1,2})\)\s+(.+)$/;

function parseAgendaLines(lines, session, symbol, year) {
  const items = [];
  let currentSection = null;
  let currentSectionTitle = null;
  let currentItemNumber = null;
  let unparsedLines = [];

  // Clean PDF page artifacts from lines
  const cleaned = lines
    .map((l) =>
      l.replace(/\s*\/\.\.\..*$/, "")       // strip "/... A/50/251 English Page N"
       .replace(/\s*A\/\d+\/251\s+English\s+Page\s+\d+.*$/, "")
       .trim()
    )
    .filter((l) => l && !l.match(/^(UNITEDUNITED|General Assembly|Distr\.|ORIGINAL:|GENERAL|English$|\d{2}-\d{4,})/))
    // Split lines where a new numbered item starts mid-line (PDF artifact)
    .flatMap((l) => {
      const parts = l.split(/(?<=\.)\s+(?=\d+\.\s)/);
      return parts.length > 1 ? parts : [l];
    });

  for (const line of cleaned) {
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      currentSectionTitle = sectionMatch[2].trim();
      continue;
    }

    const itemMatch = line.match(ITEM_RE);
    if (itemMatch) {
      currentItemNumber = parseInt(itemMatch[1]);
      items.push({
        session,
        symbol,
        year,
        section: currentSection,
        section_title: currentSectionTitle,
        item_number: currentItemNumber,
        sub_item: null,
        title: cleanTitle(itemMatch[2]),
      });
      continue;
    }

    const subMatch = line.match(SUB_ITEM_RE);
    if (subMatch && currentItemNumber !== null) {
      // Skip Roman numeral sub-sub-items from older PDFs: (i) ...; (ii) ...
      if (line.match(/\(ii\)/)) continue;
      items.push({
        session,
        symbol,
        year,
        section: currentSection,
        section_title: currentSectionTitle,
        item_number: currentItemNumber,
        sub_item: subMatch[1],
        title: cleanTitle(subMatch[2]),
      });
      continue;
    }

    // Track lines that didn't match any pattern (skip known preamble)
    if (items.length > 0) {
      unparsedLines.push(line);
    }
  }

  return { items, unparsedLines };
}

function cleanTitle(t) {
  return t
    .replace(/[;.:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Validation ---

function validateParsed(items, session, unparsedLines) {
  const warnings = [];

  if (items.length === 0) {
    warnings.push("CRITICAL: No items parsed at all");
    return warnings;
  }

  // Check item numbers are sequential (with possible gaps for removed items)
  const nums = items.filter((i) => i.sub_item === null).map((i) => i.item_number);
  if (nums[0] !== 1) {
    warnings.push(`First item number is ${nums[0]}, expected 1`);
  }

  // Check for large gaps in numbering (>5 consecutive missing)
  for (let i = 1; i < nums.length; i++) {
    const gap = nums[i] - nums[i - 1];
    if (gap > 5) {
      warnings.push(`Large gap in item numbers: ${nums[i - 1]} → ${nums[i]}`);
    }
  }

  // Check for duplicate item+sub combinations
  const seen = new Set();
  for (const item of items) {
    const key = `${item.item_number}-${item.sub_item}`;
    if (seen.has(key)) {
      warnings.push(`Duplicate: item ${item.item_number}(${item.sub_item})`);
    }
    seen.add(key);
  }

  // Check for suspiciously few items (sessions typically have 50+)
  if (items.length < 30) {
    warnings.push(`Only ${items.length} items parsed (expected 50+)`);
  }

  // Report unparsed lines
  if (unparsedLines.length > 0) {
    warnings.push(
      `${unparsedLines.length} unparsed lines, e.g.: "${unparsedLines[0].substring(0, 80)}"`
    );
  }

  return warnings;
}

// --- CLI args ---
const args = process.argv.slice(2);
const startSession = parseInt(args[args.indexOf("--start") + 1]) || 1;
const endSession = parseInt(args[args.indexOf("--end") + 1]) || 80;
const parseOnly = args.includes("--parse-only");

// --- Fetch ---
if (!parseOnly) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let session = startSession; session <= endSession; session++) {
    const symbol = `A/${session}/251`;
    const outFile = rawPath(session);

    if (existsSync(outFile)) {
      console.log(`[${symbol}] Already fetched, skipping`);
      continue;
    }

    console.log(`[${symbol}] Fetching...`);

    try {
      const [doc, meta] = await Promise.allSettled([
        fetchUNDocument(symbol),
        fetchDocumentMetadata(symbol),
      ]);

      const entry = { symbol, session };

      if (doc.status === "fulfilled") {
        entry.lines = doc.value.lines;
        entry.lineCount = doc.value.lineCount;
        entry.format = doc.value.format;
      } else {
        entry.error = doc.reason?.message || "Failed to fetch document";
        console.warn(`  ⚠ Doc fetch failed: ${entry.error}`);
      }

      if (meta.status === "fulfilled") {
        entry.date = meta.value.date;
        entry.year = meta.value.year;
      }

      writeFileSync(outFile, JSON.stringify(entry, null, 2));
      console.log(
        `  → ${entry.lineCount || 0} lines (${entry.format || "n/a"})`
      );
    } catch (err) {
      console.error(`  ✗ Error: ${err.message}`);
      writeFileSync(
        outFile,
        JSON.stringify({ symbol, session, error: err.message }, null, 2)
      );
    }

    await delay(1500);
  }
}

// --- Parse all raw files into flat items ---
console.log("\n--- Parsing ---");
const allItems = [];
const diagnostics = [];

const rawFiles = readdirSync(DL_DIR)
  .filter((f) => f.match(/^session_\d+\.json$/))
  .sort();

for (const file of rawFiles) {
  const entry = JSON.parse(readFileSync(join(DL_DIR, file), "utf-8"));
  if (!entry.lines) {
    diagnostics.push({ session: entry.session, warnings: ["No lines (fetch failed)"] });
    continue;
  }

  const { items, unparsedLines } = parseAgendaLines(
    entry.lines,
    entry.session,
    entry.symbol,
    entry.year,
  );

  const warnings = validateParsed(items, entry.session, unparsedLines);

  if (warnings.length > 0) {
    diagnostics.push({ session: entry.session, warnings });
    console.log(`[Session ${entry.session}] ${items.length} items, ${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  } else {
    console.log(`[Session ${entry.session}] ${items.length} items ✓`);
  }

  allItems.push(...items);
}

// Sort by session, then item_number, then sub_item
allItems.sort((a, b) => {
  if (a.session !== b.session) return a.session - b.session;
  if (a.item_number !== b.item_number) return a.item_number - b.item_number;
  if (a.sub_item === null) return -1;
  if (b.sub_item === null) return 1;
  return a.sub_item.localeCompare(b.sub_item);
});

writeFileSync(PARSED_FILE, JSON.stringify(allItems, null, 2));

// --- Summary ---
const sessions = new Set(allItems.map((i) => i.session));
console.log(`\n--- Summary ---`);
console.log(`${allItems.length} items across ${sessions.size} sessions → ${PARSED_FILE}`);
if (diagnostics.length > 0) {
  console.log(`\n⚠ ${diagnostics.length} session(s) with warnings:`);
  for (const d of diagnostics) {
    console.log(`  Session ${d.session}: ${d.warnings.join("; ")}`);
  }
}
