
const fs = require('fs')

/**
 * 
 * @param app Express app to register endpoints on.
 * @param uriRoot The root path that provider endpoints should be registered under.
 * @param providersDir The path to the directory containing provider definitions.
 * @param environment Core environment
 * @param providers Prepopulated providers. Can be safely omitted.
 */
module.exports.setup = (app, uriRoot, providersDir, environment, providers) => {

    // Handlers should be defined as modules and loaded from the 'providers' directory.
    // Provider modules should export a 'version' string and a 'messages' object. Each key on the 'messages' object should
    // define a handler that can accept the message object received from the server, a connection object and a 'record'
    // object containing metadata about the connection (including the clientId of the client associated with the connection).

    const log = environment.log

    if (!providers) {
        providers = {}
    }


    let providerNames = fs.readdirSync(providersDir)
    for (var i in providerNames) {
        let name = providerNames[i]
        let providerModulePath = `${providersDir}/${name}/module.js`
        if (fs.existsSync(providerModulePath)) {
            try {
                let provider = require(providerModulePath)
                providers[name] = provider
            } catch(e) {
                log(`Failed to read provider module '${providerModulePath}': ${e}`)
            }
        }
    }

    for (const p in providers) {
        let provider = providers[p]
        if (provider.setup) {
            provider.setup(environment)
        }
    }

    for (var namespace in providers) {
        let endpoints = providers[namespace].endpoints
        if (endpoints && Array.isArray(endpoints)) {
            for (var i in endpoints) {
                let endpoint = endpoints[i]

                if (!endpoint.route || typeof(endpoint.route) !== 'string' || !endpoint.route.match(/\/([^/]+(\/[^/]+)*)?/) ) {
                    log(`Invalid endpoint route specified: ${endpoint.route}`)
                    continue
                }

                if (!endpoint.method || typeof(endpoint.method) !== 'string' || !['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'].includes(endpoint.method)) {
                    log(`Invalid endpoint method specified: ${endpoint.method}`)
                    continue
                }

                if (!endpoint.handler || typeof(endpoint.handler) !== 'function') {
                    log(`Invalid endpoint handler specified: ${endpoint.handler}`)
                    continue
                }

                let route = `${uriRoot}/${namespace}${endpoint.route}`

                log(`Adding handler for '${endpoint.method.toUpperCase()} ${route}'`)

                app[endpoint.method](route, endpoint.handler)
            }
        }
    }

    return providers
}