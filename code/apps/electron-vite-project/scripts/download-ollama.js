/**
 * Download Ollama Binaries Script
 * Downloads official Ollama binaries for Windows/macOS/Linux
 * Run before build to bundle Ollama with the installer
 */

const fs = require('fs')
const path = require('path')
const https = require('https')
const { execSync } = require('child_process')

const OLLAMA_VERSION = '0.1.20' // Update as needed
const RESOURCES_DIR = path.join(__dirname, '..', 'resources', 'ollama')

const DOWNLOADS = {
  win: {
    url: 'https://github.com/ollama/ollama/releases/download/v0.1.20/ollama-windows-amd64.zip',
    outputDir: path.join(RESOURCES_DIR, 'win'),
    filename: 'ollama.exe'
  },
  darwin: {
    url: 'https://github.com/ollama/ollama/releases/download/v0.1.20/Ollama-darwin.zip',
    outputDir: path.join(RESOURCES_DIR, 'darwin'),
    filename: 'ollama'
  },
  linux: {
    url: 'https://github.com/ollama/ollama/releases/download/v0.1.20/ollama-linux-amd64',
    outputDir: path.join(RESOURCES_DIR, 'linux'),
    filename: 'ollama'
  }
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading: ${url}`)
    console.log(`Destination: ${dest}`)
    
    const file = fs.createWriteStream(dest)
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        https.get(response.headers.location, (redirectResponse) => {
          redirectResponse.pipe(file)
          file.on('finish', () => {
            file.close()
            console.log(`Downloaded: ${dest}`)
            resolve()
          })
        }).on('error', (err) => {
          fs.unlink(dest, () => {})
          reject(err)
        })
      } else {
        response.pipe(file)
        file.on('finish', () => {
          file.close()
          console.log(`Downloaded: ${dest}`)
          resolve()
        })
      }
    }).on('error', (err) => {
      fs.unlink(dest, () => {})
      reject(err)
    })
  })
}

async function extractZip(zipPath, extractDir) {
  console.log(`Extracting: ${zipPath} to ${extractDir}`)
  
  // Use different tools based on platform
  if (process.platform === 'win32') {
    // Windows: Use PowerShell Expand-Archive
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`)
  } else {
    // macOS/Linux: Use unzip
    execSync(`unzip -o "${zipPath}" -d "${extractDir}"`)
  }
  
  console.log(`Extracted successfully`)
}

async function downloadAndPrepareOllama(platform) {
  const config = DOWNLOADS[platform]
  if (!config) {
    console.warn(`No download config for platform: ${platform}`)
    return
  }
  
  console.log(`\n=== Preparing Ollama for ${platform} ===`)
  
  // Create output directory
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true })
  }
  
  // Check if already exists
  const finalPath = path.join(config.outputDir, config.filename)
  if (fs.existsSync(finalPath)) {
    console.log(`Ollama binary already exists: ${finalPath}`)
    return
  }
  
  try {
    const isZip = config.url.endsWith('.zip')
    const downloadPath = isZip 
      ? path.join(config.outputDir, 'ollama.zip')
      : finalPath
    
    // Download
    await downloadFile(config.url, downloadPath)
    
    // Extract if ZIP
    if (isZip) {
      await extractZip(downloadPath, config.outputDir)
      
      // Find and rename binary
      const files = fs.readdirSync(config.outputDir)
      const binaryFile = files.find(f => 
        f.toLowerCase().includes('ollama') && 
        !f.endsWith('.zip') &&
        (platform === 'win' ? f.endsWith('.exe') : !f.includes('.'))
      )
      
      if (binaryFile && binaryFile !== config.filename) {
        const oldPath = path.join(config.outputDir, binaryFile)
        fs.renameSync(oldPath, finalPath)
      }
      
      // Clean up zip
      fs.unlinkSync(downloadPath)
    }
    
    // Make executable on Unix systems
    if (platform !== 'win') {
      fs.chmodSync(finalPath, 0o755)
    }
    
    console.log(`✓ Ollama prepared for ${platform}`)
  } catch (error) {
    console.error(`✗ Failed to prepare Ollama for ${platform}:`, error.message)
    throw error
  }
}

async function main() {
  console.log('===========================================')
  console.log('  Downloading Ollama Binaries')
  console.log('===========================================\n')
  
  // Create base resources directory
  if (!fs.existsSync(RESOURCES_DIR)) {
    fs.mkdirSync(RESOURCES_DIR, { recursive: true })
  }
  
  // Determine which platforms to download
  const targetPlatform = process.env.BUILD_PLATFORM || process.platform
  
  if (targetPlatform === 'all') {
    // Download for all platforms
    for (const platform of Object.keys(DOWNLOADS)) {
      await downloadAndPrepareOllama(platform)
    }
  } else {
    // Download for current platform only
    const platform = targetPlatform === 'win32' ? 'win' : targetPlatform
    await downloadAndPrepareOllama(platform)
  }
  
  console.log('\n✓ Ollama binaries ready for bundling')
}

// Run
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}

module.exports = { downloadAndPrepareOllama }

