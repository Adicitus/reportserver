//auth.js

"use strict"

const { DateTime } = require('luxon')
const jwt = require('jsonwebtoken')
const {v4: uuidv4} = require('uuid')

const secret = uuidv4()

// Temporary hard-coded list of supported authentication types.
const authTypes = {
    password: require('./authProviders/password/module')
}

// Temporary list of users, this should be moved into a DB and the password should be stored as a salted hash.
var identities = [
    {
        name: 'admin',
        auth: {
            type: 'password',
            password: 'Pa$$w0rd',
            salt: 'fcbca933-7021-432b-836d-c1142b1f310d',
            hash: '5a59750c5ae9eec93736464df0aabc3ff21c576078cd6fa378f0067589a715997e188a06ce98e2e4c4d01749d754b281032910e261dce397bf6b574cbc2b5345'
        },
        functions: ['auth', 'api']
    }
]

/*
identity: The user to generate a token for.
options: An object defining options for the token. Currently only 'duration' is supported and should be luxon duration.
*/
/**
 * Used to generate a token for the provided identity.
 * 
 * Options:
 *  - duration: A luxon duration to to define how long the token should be valid.
 * 
 * @param {object} identity - Identity details.
 * @param {object} options  - Options to modify the way that the token is generated
 */
function newToken(identity, options) {
    var now = DateTime.now()
    var payload = {
        name: identity.name,
        iat: Math.round(now.toSeconds()),
        exp: Math.round(now.plus({minutes: 30}).toSeconds())
    }

    if (options) {
        if (options.duration) {
            payload.exp = Math.round(now.plus(options.duration).toSeconds())
        }
    }

    if (identity.functions) {
        payload.functions = identity.functions
    }

    var t = jwt.sign(payload, secret)

    return t
}

/**
 * Attempts to validate the provided token. Returns the payload as an object if the token is valid.
 * 
 * @param {string} token - Token to validate.
 */
function verifyToken(token) {
    try {
        jwt.verify(token, secret)
        return jwt.decode(token, secret)
    } catch {
        return null
    }
}

/**
 * Verifies a set of identity details versus the expected format and returns a sanitized record if successful.
 * 
 * By default the only compulsory detail is 'name', since this is currently
 * used as the primary key for identities.
 * 
 * 3 fields will be validated: 'name', 'auth' and 'functions'.
 * 
 * The name field should be a string matching the regex '[A-z0-9_\-.]+'.
 * 
 * The auth field will be validated by the authenticaton type provider.
 * 
 * The functions field should be an array of strings, but can be omitted altogether.
 * 
 * if calidation is successful, a sanitized record generated from the provided details
 * will be provided in the 'cleanRecord' field on the returned object.
 * 
 * Options:
 *  - newIdentity: When set to true, changes the approach. Verifies that the name IS NOT in use and requires authentication details to be specified.
 *  - validFunctions: A list of functions names to validate the function names in details against.
 * 
 * @param {object} details - Details to be verified.
 * @param {object} options - Options to modify how the functions validates the details.
 */
function validateIdentitySpec(details, options) {

    const nameRegex     = /[A-z0-9_\-.]+/
    const functionRegex = /[A-z0-9_\-.]+/

    var cleanRecord = {}
    var authType = null

    if (!options) {
        options = {}
    }

    /* ===== Start: Validate name ===== */
    if (!details.name) {
        return {state: 'requestError', reason: 'No user specified.'}
    }

    if (!details.name || !details.name.match(nameRegex)) {
        return {state: 'requestError', reason: `Invalid name format (should match regex ${nameRegex}).`}
    }

    let i = identities.findIndex((o) => o.name == details.name )

    if (options.newIdentity) {
        if (i != -1) {
            return {state: 'requestError', reason: 'Identity name already in use.'}
        }
    } else {
        if (i == -1) {
            return {state: 'requestError', reason: 'No such user.'}
        }
    }
    cleanRecord.name = details.name
    /* ====== End: Validate name ====== */

    
    /* ===== Start: Validate authentication ===== */
    if (options.newIdentity && !details.auth) {
        return { state: 'requestError', reason: 'No athentication details specified for new identity.' }
    }

    if (details.auth) {
        let auth = details.auth

        if (!auth.type) {
            return { state: 'requestError', reason: 'No authentication type specified.' }
        }

        authType = authTypes[auth.type]

        if (!authType) {
            return { state: 'serverConfigurationError', reason: `Invalid authentication type specified for user: ${auth.type}` }
        }

        if (!authType.validate) {
            return { state: 'serverConfigurationError', reason: `No validation function specified for authentication type: ${auth.type}` }
        }

        if (!authType.commit) {
            return { state: 'serverConfigurationError', reason: `No commit function specified for authentication type: ${auth.type}` }
        }

        let r = authType.validate(auth)

        if (r.state !== 'success') {
            return r
        } else {
            cleanRecord.auth = r.cleanRecord
        }
    }
    /* ====== End: Validate authentication ====== */

    if (details.functions) {
        /* ===== Start: Validate functions list ===== */
        let functions = details.functions

        if (!Array.isArray(functions)) {
            return {state: 'requestError', reason: `Functions not specified as an array.`}
        }

        let incorrectFormat = []
        for (let f in details.functions) {
            if (typeof f !== 'string' || !f.match(functionRegex)) {
                incorrectFormat.push(f)
            }
        }

        if (incorrectFormat.length > 0) {
            return {state: 'requestError', reason: `Incorrectly formatted function names (should match regex ${functionRegex}): ${incorrectFormat.join(', ')}`}
        }

        if (options.validFunctions) {
            
            let invalidFunctions = []

            for(let f in details.functions) {
                if (!options.validFunctions.includes(f)) {
                    invalidFunctions.push(f)
                }
            }

            if (invalidFunctions.length > 0) {
                return {state: 'requestError', reason: `Invalid functions named: ${invalidFunctions.join(', ')}`}
            }
        }
        cleanRecord.functions = details.functions
        /* ====== End: Validate functions list ====== */
    }

    if (!cleanRecord.functions) {
        cleanRecord.functions = []
    }

    return {state: 'success', pass: true, cleanRecord: cleanRecord, authType: authType }
}

/**
 * Adds a new identity to the authentication system.
 * 
 * The Following details should be provided:
 *  - name: The name of the identity, this is currently the primary key for identities.
 *  - auth: Authentication details. This should be an object with a field called 'type'
 *      indicating which authentication method to use, along with any details required
 *      to authenticate using that method.
 *  - functions: An array of function names that the user should have access to.
 *      This can be omitted to create an identity with no rights.
 *          
 * 
 * @param {object} details - Details of the identity to add.
 */
function addIdentity(details){

    let r = validateIdentitySpec(details, { newIdentity: true })

    if (r.pass) {

        let record = r.cleanRecord
        record.id = uuidv4()

        try {
            r = r.authType.commit(record.auth)
            if (r.state !== 'success') {
                return r
            }
            record.auth = r.commitRecord
        } catch (e) {
            console.log(`Error occured while committing authentication details:`)
            console.log(e)
            return { state: 'serverAuthCommitFailed', reason: 'An exception occured while commiting authentication details.' }
        }

        identities.push(record)
        return { state: 'success', identity: record }
    } else {
        return r
    }
}

function setIdentity(details) {
    
    let r = validateIdentitySpec(details)

    if (!r.pass) {
        return r
    }

    var record = r.cleanRecord

    let i = identities.findIndex((o) => o.name == name )
    let identity = identities[i]

    let identityFields = Object.keys(identity)
    let updateFields = Object.keys(record)

    for (var uf in updateFields) {
        switch(uf) {
            case 'auth': {
                let authType = authTypes[record.auth.type]
                let commitRecord = authType.commit(record.auth)
                identity.auth = commitRecord
            }

            default: {
                if (identityFields.includes(uf)) {
                    identity[uf] = r.cleanRecord[uf]
                }
            }
        }
    }

    return { state: 'success', identity: identity }
}

function removeIdentity(name){

    let r = validateIdentitySpec({name: name})

    if (!r.pass) {
        return r
    }

    let i = identities.findIndex((o) => o.name == name )

    identities.splice(i, 1)
    return { state: 'success' }
}

function authenticate(details) {

    let r = validateIdentitySpec(details)

    if (!r.pass) {
        return r
    }

    var i = identities.findIndex((o) =>
        details.name == o.name
    )
 
    let identity = identities[i]
    
    let authType = authTypes[identity.auth.type]

    r = authType.authenticate(identity.auth, details)

    if (r.state !== 'success') {
        return r
    }

    var t = newToken(identity)
    r.token = t

    return r
}

/* ====== Export definitions: ===== */

module.exports.addIdentity = addIdentity
module.exports.setIdentity = setIdentity
module.exports.removeIdentity = removeIdentity
module.exports.validateIdentitySpec = validateIdentitySpec
module.exports.verifyToken = verifyToken

/**
 * Used to set up authentication endpoints.
 * 
 * Endpoints:
 *  - ${path}: Used to authenticate
 *  - ${path}/clientToken
 * @param {string} path - Base path to set up the authentication endpoints under.
 * @param {object} app - Express application to set up the authentication endpoints on.
 */
module.exports.setup = (path, app) => {
    
    /**
     * Authentication endpoint.
     */
    app.post(path, (req, res) => {
        
        var r = authenticate(req.body)
    
        if (r.token) {
            res.status(200)
            res.send(JSON.stringify(r))
        } else {
            switch (r.state) {
                case 'requestError': {
                    res.status(400)
                    break
                }
    
                case 'serverError': {
                    res.status(500)
                    break
                }
    
                case 'failed': {
                    res.status(403)
                    break
                }
            }
            res.send(JSON.stringify(r))
        }
    })

    app.use(path, (req, res, next) => {

        if (!req.authenticated) {
            res.status(403)
            res.end()
            return
        }

        let fs = req.authenticated.functions

        if (!fs || !fs.includes('auth')) {
            res.status(403)
            res.end()
            return
        }

        next()
    })

    /**
     * Add user endpoint.
     */
    app.post(`${path}/user`, (req, res) => {
        
        if (!req.body) {
            res.status(400)
            res.end(JSON.stringify({status: 'requestError', reason: 'No user details provided.'}))
            return
        }

        let details = req.body

        let r = addIdentity(details)

        if (r.state === 'success') {
            res.status(201)
            res.end()
            return
        }

        if (r.state.match(/^request/)) {
            res.status(400)
        } else {
            res.status(500)
        }
        
        res.send(JSON.stringify(r))
    })

    /**
     * Remove user endpoint
     */
    app.delete(`${path}/user/:identityId`, (req, res) => {
        let r = removeIdentity(req.params.identityId)

        if (r.state === 'success') {
            res.status(200)
        } else {
            res.status(400)
        }

        res.send(JSON.stringify(r))
    })
}

// Middleware to verify the authorization header.
// Adds req.authenticated with user details if authorization is validated.
module.exports.mw_verify = (req, res, next) => {
    var auth = req.headers.authorization

    if (auth) {
        var m = auth.match(/^(?<type>bearer) (?<token>.+)/)

        if (m) {
            var p = verifyToken(m.groups.token)
            
            if (p) {
                req.authenticated = p
            }
        }
    }
    
    next()

}