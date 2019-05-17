const { generateSWString, getModuleURL } = require('workbox-build')
const { readFile, writeFileSync } = require('fs')
const logger = require('@parcel/logger')
const path = require('path')
const uglifyJS = require('uglify-js')

module.exports = bundle => {
  bundle.on('buildEnd', async () => {
    if (process.env.NODE_ENV !== 'production') {
      logger.log('Production not enabled, skipping workbox')
      return
    }

    // output path
    let pathOut = bundle.options.outDir

    const DEFAULT_CONFIG = {
      // scripts to import into sw
      importScripts: [],
      // directory to include
      globDirectory: bundle.options.outDir,
      // file types to include
      globPatterns: [
        '**\/*.{css,html,js,gif,ico,jpg,png,svg,webp,woff,woff2,ttf,otf}'
      ]
    }

    let pkg,
      mainAsset =
        bundle.mainAsset ||
        bundle.mainBundle.entryAsset ||
        bundle.mainBundle.childBundles.values().next().value.entryAsset

    pkg = typeof mainAsset.getPackage === 'function' ?
      await mainAsset.getPackage() : mainAsset.package

    let config = Object.assign({}, DEFAULT_CONFIG)
    if (pkg.workbox) {
      if (pkg.workbox.importScripts && Array.isArray(pkg.workbox.importScripts)) {
        config.importScripts = pkg.workbox.importScripts
      }
      if (pkg.workbox.importScripts && !Array.isArray(pkg.workbox.importScripts)) {
        config.importScripts = [pkg.workbox.importScripts]
      }
      if (pkg.workbox.globDirectory) {
        config.globDirectory = pkg.workbox.globDirectory
      }
      config.globDirectory = path.resolve(config.globDirectory)
      if (pkg.workbox.globPatterns && Array.isArray(pkg.workbox.globParrents)) {
        config.globPatterns = pkg.workbox.globPatterns
      }
      if (pkg.workbox.globPatterns && !Array.isArray(pkg.workbox.globParrents)) {
        config.globPatterns = [pkg.workbox.globPatterns]
      }
      if (pkg.workbox.pathOut) {
        pathOut = pkg.workbox.pathOut
      }
    }
    const dest = path.resolve(pathOut)

    logger.log('🛠️  Workbox')

    if (!config.importScripts.length) {
      logger.warn('No scripts set using workbox.importScripts')
    }

    config.importScripts.forEach(s => {
      readFile(path.resolve(s), (err, data) => {
        if (err) throw err
        if (bundle.options.minify) {
          try {
            const minified = uglifyJS.minify(data)
            if (!minified || minified.error) {
              logger.warn(minified.error || 'Failed to minify importScripts')
            } else {
              data = minified.code
            }
          } catch (e) {
            logger.warn(e)
          }
        }
        const impDest = path.resolve(pathOut, /[^\/]+$/.exec(s)[0])
        writeFileSync(impDest, data)
        logger.success(`Imported ${s} to ${impDest}`)
      })
    })

    config.importScripts = config.importScripts.map(s => {
      return /[^\/]+$/.exec(s)[0]
    })
    config.importScripts.push(getModuleURL('workbox-sw'))

    generateSWString(config).then(swString => {

      let generatedString = swString.swString
      logger.success('Service worker generated')
      if (bundle.options.minify) {
        try {
          const minified = uglifyJS.minify(generatedString)

          if (!minified || minified.error) {
            logger.warn(minified.error || 'Failed to minify worker')
          } else {
            logger.success('Service worker minified')
            generatedString = minified.code
          }
        } catch (e) {
          logger.warn(e)
        }
      }
      writeFileSync(path.join(dest, 'sw.js'), generatedString, { encoding: 'utf8' })
      logger.success(`Service worker written to ${dest}/sw.js`)
    }).catch(err => {
      logger.error(err)
    })

    const entry = path.resolve(pathOut, 'index.html')
    readFile(entry, 'utf8', (err, data) => {
      if (err) logger.error(err)
      if (!data.includes('serviceWorker.register')) {
        let swTag = `
        if ('serviceWorker' in navigator) {
          window.addEventListener('load', function() {
            navigator.serviceWorker.register('/sw.js');
          });
        }
      `
        if (bundle.options.minify) {
          swTag = uglifyJS.minify(swTag)
          swTag = `<script>${swTag.code}</script></body>`
        } else {
          swTag = `
        <script>
        ${swTag}
        </script>
      </body>`
        }
        data = data.replace('</body>', swTag)
        writeFileSync(entry, data)
        logger.success(`Service worker injected into ${dest}/index.html`)
      }
    })
  })
}
