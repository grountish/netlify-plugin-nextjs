const { Server } = require('http')
const path = require('path')

const { Bridge } = require('@vercel/node/dist/bridge')

const makeHandler =
  () =>
  // We return a function and then call `toString()` on it to serialise it as the launcher function
  (conf, app) => {
    // This is just so nft knows about the page entrypoints
    try {
      // eslint-disable-next-line node/no-missing-require
      require.resolve('./pages.js')
    } catch {}

    let NextServer
    try {
      // next >= 11.0.1. Yay breaking changes in patch releases!
      NextServer = require('next/dist/server/next-server').default
    } catch (error) {
      if (!error.message.includes("Cannot find module 'next/dist/server/next-server'")) {
        // A different error, so rethrow it
        throw error
      }
      // Probably an old version of next
    }

    if (!NextServer) {
      try {
        // next < 11.0.1
        // eslint-disable-next-line node/no-missing-require, import/no-unresolved
        NextServer = require('next/dist/next-server/server/next-server').default
      } catch (error) {
        if (!error.message.includes("Cannot find module 'next/dist/next-server/server/next-server'")) {
          throw error
        }
        throw new Error('Could not find Next.js server')
      }
    }

    const nextServer = new NextServer({
      conf,
      dir: path.resolve(__dirname, app),
      customServer: false,
    })
    const requestHandler = nextServer.getRequestHandler()
    const server = new Server(async (req, res) => {
      try {
        await requestHandler(req, res)
      } catch (error) {
        console.error(error)
        throw new Error('server function error')
      }
    })
    const bridge = new Bridge(server)
    bridge.listen()

    return async (event, context) => {
      // Next expects to be able to parse the query from the URL
      const query = new URLSearchParams(event.queryStringParameters).toString()
      event.path = query ? `${event.path}?${query}` : event.path

      const { headers, ...result } = await bridge.launcher(event, context)
      /** @type import("@netlify/functions").HandlerResponse */

      // Convert all headers to multiValueHeaders
      const multiValueHeaders = {}
      for (const key of Object.keys(headers)) {
        if (Array.isArray(headers[key])) {
          multiValueHeaders[key] = headers[key]
        } else {
          multiValueHeaders[key] = [headers[key]]
        }
      }

      if (multiValueHeaders['set-cookie']?.[0]?.includes('__prerender_bypass')) {
        delete multiValueHeaders.etag
        multiValueHeaders['cache-control'] = ['no-cache']
      }

      return {
        ...result,
        multiValueHeaders,
        isBase64Encoded: result.encoding === 'base64',
      }
    }
  }

const getHandler = ({ isODB = false, publishDir = '../../../.next', appDir = '../../..' }) => `
const { Server } = require("http");
// We copy the file here rather than requiring from the node module
const { Bridge } = require("./bridge");
const { builder } = require("@netlify/functions");
const { config }  = require("${publishDir}/required-server-files.json")
const path = require("path");
exports.handler = ${
  isODB
    ? `builder((${makeHandler().toString()})(config, "${appDir}"));`
    : `(${makeHandler().toString()})(config, "${appDir}");`
}
`

module.exports = getHandler
