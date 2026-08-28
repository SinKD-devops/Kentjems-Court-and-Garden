#!/usr/bin/env node
/**
 * Generates the app icons from SVG, so the artwork stays editable in the repo
 * rather than being binary blobs nobody can change.
 *
 *   npm run icons
 *
 * The mark is a court seen from above — centre circle, halfway line, and the
 * key at each end. It stays readable at 48px on a home screen, which a
 * wordmark would not.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const GREEN = "#12724D";
const OUT = join(process.cwd(), "public");

/** @param {number} pad fraction of the canvas left empty around the mark */
function courtSvg(pad) {
  const size = 512;
  const inset = size * pad;
  const w = size - inset * 2;
  const h = w * 0.62;
  const top = (size - h) / 2;
  const stroke = size * 0.028;
  const keyW = w * 0.17;
  const keyH = h * 0.44;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${GREEN}"/>
  <g fill="none" stroke="#ffffff" stroke-width="${stroke}" stroke-linejoin="round" opacity="0.95">
    <rect x="${inset}" y="${top}" width="${w}" height="${h}" rx="${size * 0.02}"/>
    <line x1="${size / 2}" y1="${top}" x2="${size / 2}" y2="${top + h}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${h * 0.17}"/>
    <rect x="${inset}" y="${top + (h - keyH) / 2}" width="${keyW}" height="${keyH}"/>
    <rect x="${inset + w - keyW}" y="${top + (h - keyH) / 2}" width="${keyW}" height="${keyH}"/>
  </g>
</svg>`;
}

// A maskable icon is cropped to whatever shape the launcher wants — a circle
// on many Android phones. The mark needs to sit inside the safe zone or the
// corners get sliced off.
const STANDARD = courtSvg(0.13);
const MASKABLE = courtSvg(0.24);

const targets = [
  ["icon-192.png", STANDARD, 192],
  ["icon-512.png", STANDARD, 512],
  ["icon-maskable-512.png", MASKABLE, 512],
  // iOS ignores the manifest and looks for this. It also has no transparency
  // handling on the home screen, so it is rendered on the solid green.
  ["apple-touch-icon.png", STANDARD, 180],
];

await mkdir(OUT, { recursive: true });

for (const [name, svg, size] of targets) {
  const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  await writeFile(join(OUT, name), png);
  console.log(`  ${name.padEnd(24)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}

await writeFile(join(OUT, "icon.svg"), STANDARD);
console.log("  icon.svg                 source");
