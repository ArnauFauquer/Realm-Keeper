/**
 * Script to generate PWA icons from SVG
 * Run: node scripts/generate-icons.js
 * 
 * Requires: npm install sharp
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateIcons() {
  const iconsDir = path.join(__dirname, '../public/icons');
  const svgPath = path.join(iconsDir, 'icon.svg');
  const svgBuffer = fs.readFileSync(svgPath);

  const sizes = [192, 512];

  for (const size of sizes) {
    // Regular icon
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(iconsDir, `icon-${size}.png`));
    
    console.log(`Generated icon-${size}.png`);

    // Maskable icon (with padding for safe area)
    const padding = Math.round(size * 0.1); // 10% padding
    const innerSize = size - (padding * 2);
    
    await sharp(svgBuffer)
      .resize(innerSize, innerSize)
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 12, g: 13, b: 29, alpha: 1 } // #0c0d1d
      })
      .png()
      .toFile(path.join(iconsDir, `icon-maskable-${size}.png`));
    
    console.log(`Generated icon-maskable-${size}.png`);
  }

  console.log('All icons generated successfully!');
}

generateIcons().catch(console.error);
