const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ICON_SIZE = 1024; // Android requires 1024x1024 for source icons

async function processIcon(inputPath, outputPath, type = 'icon') {
  try {
    const metadata = await sharp(inputPath).metadata();
    console.log(`${path.basename(inputPath)}: ${metadata.width}x${metadata.height}`);
    
    // Check if already correct size
    if (metadata.width === ICON_SIZE && metadata.height === ICON_SIZE) {
      console.log(`✓ ${path.basename(inputPath)} is already ${ICON_SIZE}x${ICON_SIZE}`);
      return;
    }
    
    // Create temp file first if output is same as input
    const tempPath = outputPath === inputPath 
      ? outputPath + '.tmp'
      : outputPath;
    
    // Resize and format - for adaptive icon, use 'contain' to preserve safe zone
    // For regular icon, we can use 'cover' if you want it to fill, or 'contain' to preserve aspect
    const fitMode = type === 'adaptive' ? 'contain' : 'contain';
    
    await sharp(inputPath)
      .resize(ICON_SIZE, ICON_SIZE, {
        fit: fitMode,
        background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background
      })
      .png()
      .toFile(tempPath);
    
    // Replace original if temp was used
    if (tempPath !== outputPath) {
      fs.renameSync(tempPath, outputPath);
    } else {
      // Move temp over original
      fs.unlinkSync(inputPath);
      fs.renameSync(tempPath, outputPath);
    }
    
    console.log(`✓ Resized ${path.basename(inputPath)} to ${ICON_SIZE}x${ICON_SIZE} → ${path.basename(outputPath)}`);
  } catch (error) {
    console.error(`Error processing ${inputPath}:`, error.message);
    throw error;
  }
}

async function main() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  const iconPath = path.join(assetsDir, 'icon.png');
  const adaptiveIconPath = path.join(assetsDir, 'adaptive-icon.png');
  
  // Check if files exist
  if (!fs.existsSync(iconPath)) {
    console.error(`Error: ${iconPath} not found`);
    process.exit(1);
  }
  
  if (!fs.existsSync(adaptiveIconPath)) {
    console.error(`Error: ${adaptiveIconPath} not found`);
    process.exit(1);
  }
  
  console.log('Processing Android icons...\n');
  
  // Process regular icon
  await processIcon(iconPath, iconPath, 'icon');
  
  // Process adaptive icon (foreground should be centered, content in safe zone)
  await processIcon(adaptiveIconPath, adaptiveIconPath, 'adaptive');
  
  console.log('\n✓ All icons processed successfully!');
  console.log('\nAndroid icon requirements:');
  console.log('- icon.png: 1024x1024 pixels (square)');
  console.log('- adaptive-icon.png: 1024x1024 pixels (square, content should be in center safe zone)');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

