const enigma = require('enigma.js');
const WebSocket = require('ws');
const fs = require('fs');
const util = require('util')
var qrsInteract = require('qrs-interact');
var request = require('request');
var restify = require('restify');
var winston = require('winston');
var config = require('config');

const corsMiddleware = require('restify-cors-middleware')
var errors = require('restify-errors');

var appVersion = require('./package.json').version;


// Set up Winston logger, logging both to console and different disk files
var logger = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)({
            name: 'console_log',
            'timestamp': true,
            'colorize': true
        }),
        new (winston.transports.File)({
            name: 'file_info',
            filename: config.get('logDirectory') + '/info.log',
            level: 'info'
        }),
        new (winston.transports.File)({
            name: 'file_verbose',
            filename: config.get('logDirectory') + '/verbose.log',
            level: 'verbose'
        }),
        new (winston.transports.File)({
            name: 'file_error',
            filename: config.get('logDirectory') + '/error.log',
            level: 'error'
        })
    ]
});

// Set default log level
logger.transports.console_log.level = config.get('defaultLogLevel');

logger.log('info', 'Starting Qlik Sense template app duplicator.');


// Read certificates
const client = fs.readFileSync(config.get('clientCertPath'));
const client_key = fs.readFileSync(config.get('clientCertKeyPath'));

// Read load script from wherever it is stored (Github etc)
const loadScriptURL = config.get('loadScriptURL');

// Set up enigma.js configuration
const qixSchema = require('enigma.js/schemas/' + config.get('engineVersion') + '.json');

// Sense Enterprise hostname:
const engineHost = config.get('host');

// Make sure the port below is accessible from the machine where this example
// is executed. If you changed the QIX Engine port in your installation, change this:
const enginePort = 4747;

// Set up Sense repository service configuration
var configQRS = {
    hostname: config.get('host'),
    certificates: {
        certFile: config.get('clientCertPath'),
        keyFile: config.get('clientCertKeyPath'),
    }
}

var restServer = restify.createServer({
    name: 'Qlik Sense app duplicator',
    version: appVersion,
    certificate: fs.readFileSync(config.get('sslCertPath')),
    key: fs.readFileSync(config.get('sslCertKeyPath'))
});


// Enable parsing of http parameters
restServer.use(restify.plugins.queryParser());


// Set up CORS handling
const cors = corsMiddleware({
  preflightMaxAge: 5, //Optional
  origins: ['*']
})

restServer.pre(cors.preflight)
restServer.use(cors.actual)


// Set up endpoints for REST server
restServer.get('/duplicateNewScript', respondDuplicateNewScript);
restServer.get('/duplicateKeepScript', respondDuplicateKeepScript);
restServer.get('/getTemplateList', respondGetTemplateList);


// Start the server
restServer.listen(config.get('restAPIPort'), function () {
    console.log('%s listening at %s', restServer.name, restServer.url);
});



// Handler for REST endpoint /getTemplateList
// URL parameters
//   -- None --
function respondGetTemplateList(req, res, next) {
    configQRS.headers = { 'X-Qlik-User': 'UserDirectory=Internal; UserId=sa_repository' };
    logger.log('verbose', configQRS);

    var qrsInteractInstance = new qrsInteract(configQRS);

    var appList = [];

    qrsInteractInstance.Get("app/full?filter=@AppIsTemplate eq 'Yes'")
        .then(result => {
            logger.log('debug', 'result=' + result);

            result.body.forEach(function (element) {
                appList.push({
                    name: element.name,
                    id: element.id,
                    description: element.description
                });

                logger.log('verbose', 'Element name: ' + element.name);
                logger.log('verbose', 'App list JSON: ' + JSON.stringify(appList));
            }, this);

            logger.log('info', 'Done getting list of template apps');

            res.send(appList);

        })
        .catch(err => {
            // Return error msg
            logger.log('error', 'Get templates: ' + err);
            res.send(err);
        })

    next();
}





// Handler for REST endpoint /duplicateNewScript
// URL parameters
//   templateAppId: ID of app to use as template
//   appName: Name of the new app that is created
//   ownerUserId: User ID that should be set as owner of the created app
function respondDuplicateNewScript(req, res, next) {

    // Add owner of new app as header in call to QRS. That way this user will automatically be owner of the newly created app.
    configQRS.headers = { 'X-Qlik-User': 'UserDirectory=' + config.get('senseUserDirectory') + '; UserId=' + req.query.ownerUserId };
    logger.log('debug', configQRS);

    var qrsInteractInstance = new qrsInteract(configQRS);

    // Load script from git
    request.get(loadScriptURL, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            logger.log('verbose', 'Retrieved load script');

            var loadScript = body;
            logger.log('debug', 'Load script: ' + loadScript);

            var newAppId = '';

            var newOwnerId, newOwnerUserDirectory, newOwnerName;
            var newOwnerUserId = req.query.ownerUserId;

            // Get config data on whether to reload the new app or not
            var reloadNewApp = config.get('reloadNewApp'); 

            // Make sure the app to be duplicated really is a template
            qrsInteractInstance.Get('app/' + req.query.templateAppId).then(result => {
                logger.log('verbose', req.query.templateAppId + 'Testing if specified template app really is a template');

                var appIsTemplate = false;
                result.body.customProperties.forEach(function (item) {
                    logger.log('debug', 'Item: ' + item);

                    if (item.definition.name == 'AppIsTemplate' && item.value == 'Yes') {
                        appIsTemplate = true;
                    }
                })

                logger.log('verbose', req.query.templateAppId + 'App is template: ' + appIsTemplate);

                if (!appIsTemplate) {
                    logger.log('warn', 'The provided app ID does not belong to a template app');
                    next(new restify.InvalidArgumentError("The provided app ID does not belong to a template app."));
                }

                return appIsTemplate;
            })
            .then(result => {
                // result == true if the provided app ID belongs to a template app
                if (result) {
                    qrsInteractInstance.Post('app/' + req.query.templateAppId + '/copy?name=' + req.query.appName, {}, 'json').then(result => {
                        logger.log('info', 'App created with ID %s, using %s as a template ', result.body.id, req.query.templateAppId);
                        newAppId = result.body.id;

                        // Open new app and reload it
                        const configEnigma = {
                            schema: qixSchema,
                            url: `wss://${engineHost}:${enginePort}/app/${newAppId}`,
                            createSocket: url => new WebSocket(url, {
                                key: client_key,
                                cert: client,
                                headers: {
                                'X-Qlik-User': 'UserDirectory=Internal;UserId=sa_repository',
                                },
                                rejectUnauthorized: false
                            }),
                        };
                        
                        enigma.create(configEnigma).open().then((global) => {
                            const g = qix.global;

                            // Connect to engine
                            logger.log('verbose', req.query.appName + ': Connecting to engine...');

                            g.openDoc(newAppId).then((app) => {
                                logger.log('verbose', 'Setting load script...');
                                app.setScript(loadScript).then((app) => {

                                    // Do a reload of the new app?
                                    if (reloadNewApp) {
                                        logger.log('verbose', req.query.appName + ': Reload app...');
                                        app.doReload();
                                    } else {
                                        logger.log('verbose', req.query.appName + ': App reloading disabled - skipping.');
                                    }

                                    // Close our connection.
                                    logger.log('verbose', req.query.appName + ': Close connection to engine...');
                                    g.session.close().then(() => {
                                        logger.log('info', req.query.appName + ': Done duplicating, new app id=' + newAppId);
                                        var jsonResult = { result: "Done duplicating app", newAppId: newAppId }
                                        res.send(jsonResult);
                                        next();
                                    })
                                    .catch(err => {
                                        // Return error msg
                                        logger.log('error', 'Duplication error 1: ' + err);
                                        next(new restify.BadRequestError("Error occurred when closing newly created app."));
                                        return;
                                    })
                                    logger.log('verbose', req.query.appName + ': Connection closed...');
                                })
                                .catch(err => {
                                    // Return error msg
                                    logger.log('error', 'Duplication error 2: ' + err);
                                    next(new restify.BadRequestError("Error occurred when replacing script of newly created app."));
                                    return;
                                });
                            })
                            .catch(err => {
                                // Return error msg
                                logger.log('error', 'Duplication error 3: ' + err);
                                next(new restify.BadRequestError("Error occurred when opening newly created app."));
                                return;
                            });
                        })
                        .catch(err => {
                            // Return error msg
                            logger.log('error', 'Duplication error 4: ' + err);
                            next(new restify.BadRequestError("Error occurred when creating Enigma object."));
                            return;
                        });

                    })
                    .catch(err => {
                        // Return error msg
                        logger.log('error', 'Duplication error 5: ' + err);
                        next(new restify.BadRequestError("Error occurred when creating new app from template."));
                        return;
                    });
                }
            })
            .catch(err => {
                // Return error msg
                logger.log('error', 'Duplication error 6: ' + err);
                next(new restify.BadRequestError("Error occurred when test app template status."));
                return;
            });
        }
    })
}





// Handler for REST endpoint /duplicateKeepScript
// URL parameters
//   templateAppId: ID of app to use as template
//   appName: Name of the new app that is created
//   ownerUserId: User ID that should be set as owner of the created app
function respondDuplicateKeepScript(req, res, next) {

    // Add owner of new app as header in call to QRS. That way this user will automatically be owner of the newly created app.
    configQRS.headers = { 'X-Qlik-User': 'UserDirectory=' + config.get('senseUserDirectory') + '; UserId=' + req.query.ownerUserId };
    logger.log('debug', configQRS);

    var qrsInteractInstance = new qrsInteract(configQRS);

    var newAppId = '';

    var newOwnerId, newOwnerUserDirectory, newOwnerName;
    var newOwnerUserId = req.query.ownerUserId;

    // Get config data on whether to reload the new app or not
    var reloadNewApp = config.get('reloadNewApp'); 

    // Make sure the app to be duplicated really is a template
    qrsInteractInstance.Get('app/' + req.query.templateAppId)
        .then(result => {
            logger.log('verbose', req.query.templateAppId + 'Testing if specifiec template app really is a template');

            var appIsTemplate = false;
            result.body.customProperties.forEach(function (item) {
                logger.log('debug', 'Item: ' + item);

                if (item.definition.name == 'AppIsTemplate' && item.value == 'Yes') {
                    appIsTemplate = true;
                }
            })

            logger.log('verbose', req.query.templateAppId + 'App is template: ' + appIsTemplate);

            if (!appIsTemplate) {
                logger.log('warn', 'The provided app ID does not belong to a template app');
                next(new restify.InvalidArgumentError("The provided app ID does not belong to a template app."));
            }

            return appIsTemplate;
        })
        .then(result => {
            // result == true if the provided app ID belongs to a template app
            if (result) {
                qrsInteractInstance.Post('app/' + req.query.templateAppId + '/copy?name=' + req.query.appName, {}, 'json').then(result => {
                    logger.log('info', 'App created with ID %s, using %s as a template ', result.body.id, req.query.templateAppId);
                    newAppId = result.body.id;

                    // Open new app and reload it
                    const configEnigma = {
                        schema: qixSchema,
                        url: `wss://${engineHost}:${enginePort}/app/${newAppId}`,
                        createSocket: url => new WebSocket(url, {
                            key: client_key,
                            cert: client,
                            headers: {
                              'X-Qlik-User': 'UserDirectory=Internal;UserId=sa_repository',
                            },
                            rejectUnauthorized: false
                        }),
                    }
                    
                    enigma.create(configEnigma).open().then((global) => {
                        const g = global;

                        // Connect to engine
                        logger.log('verbose', req.query.appName + ': Connecting to engine...');

                        g.openDoc(newAppId).then((app) => {
                            // Do a reload of the new app?
                            if (reloadNewApp) {
                                logger.log('verbose', req.query.appName + ': Reload app...');
                                app.doReload();
                            } else {
                                logger.log('verbose', req.query.appName + ': App reloading disabled - skipping.');
                            }

                            // Close our connection.
                            logger.log('verbose', req.query.appName + ': Close connection to engine...');
                            g.session.close().then(() => {
                                logger.log('info', req.query.appName + ': Done duplicating, new app id=' + newAppId);
                                var jsonResult = { result: "Done duplicating app", newAppId: newAppId }
                                res.send(jsonResult);
                                next();
                            })
                            .catch(err => {
                                // Return error msg
                                logger.log('error', 'Duplication error 1: ' + err);
                                next(new errors.BadRequestError("Error occurred when closing newly created app."));
                                return;
                            })
                            logger.log('verbose', req.query.appName + ': Connection closed...');
                        })
                        .catch(err => {
                            // Return error msg
                            logger.log('error', 'Duplication error 2: ' + err);
                            next(new errors.BadRequestError("Error occurred when opening newly created app."));
                            return;
                        });
                    })
                    .catch(err => {
                        // Return error msg
                        logger.log('error', 'Duplication error 3: ' + err);
                        next(new errors.BadRequestError("Error occurred when creating Enigma object."));
                        return;
                    })
                })
                .catch(err => {
                    // Return error msg
                    logger.log('error', 'Duplication error 4: ' + err);
                    next(new restify.BadRequestError("Error occurred when creating new app from template."));
                    return;
                })
            }
        })
        .catch(err => {
            // Return error msg
            logger.log('error', 'Duplication error 5: ' + err);
            // res.send(err);
            next(new restify.BadRequestError("Error occurred when test app template status."));
            return;
        })

}
