const enigma = require('enigma.js');
const WebSocket = require('ws');
const fs = require('fs');
const util = require('util')
var qrsInteract = require('qrs-interact');
var request = require('request');
var restify = require('restify');
const winston = require('winston');
require('winston-daily-rotate-file');
const config = require('config');
const path = require('path');


const corsMiddleware = require('restify-cors-middleware')
var errors = require('restify-errors');



// Get app version from package.json file
var appVersion = require('./package.json').version;


// Set up logger with timestamps and colors, and optional logging to disk file
const logTransports = [];

logTransports.push(
    new winston.transports.Console({
        name: 'console',
        level: config.get('logLevel'),
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.colorize(),
            winston.format.simple(),
            winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
        )
    })
);


if (config.get('fileLogging')) {
    logTransports.push(
        new(winston.transports.DailyRotateFile)({
            // dirname: path.join(__dirname, config.get('logDirectory')),
            dirname: path.join(__dirname, 'log'),
            filename: 'butler-app-duplicator.%DATE%.log',
            level: config.get('logLevel'),
            datePattern: 'YYYY-MM-DD',
            maxFiles: '30d'
        })
    );
}


logger = winston.createLogger({
    transports: logTransports,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
    )
});


// Function to get current logging level
getLoggingLevel = () => {
    return logTransports.find(transport => {
        return transport.name == 'console';
    }).level;
}


logger.info(`Starting Qlik Sense template app duplicator.`);

// Variable to hold ID of custom property that identify an app as being created from a template
let customProperyCreatedFromTemplateId = '';


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
const configQRS = {
    hostname: config.get('host'),
    certificates: {
        certFile: config.get('clientCertPath'),
        keyFile: config.get('clientCertKeyPath'),
    }
}

let restServer;
if (config.get('httpsEnable')) {
    restServer = restify.createServer({
        name: 'Qlik Sense app duplicator',
        version: appVersion,
        certificate: fs.readFileSync(config.get('sslCertPath')),
        key: fs.readFileSync(config.get('sslCertKeyPath'))
    });
} else {
    restServer = restify.createServer({
        name: 'Qlik Sense app duplicator',
        version: appVersion
    });
}



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
    logger.info(`${restServer.name} listening at ${restServer.url}`);
});



// Set up Docker healthcheck server
// Create restServer object
var restServerDockerHealth = restify.createServer({
    name: 'Docker healthcheck for Butler-SOS',
    version: appVersion
});

// Enable parsing of http parameters
restServerDockerHealth.use(restify.plugins.queryParser());

restServerDockerHealth.get({
    path: '/',
    flags: 'i'
}, (req, res, next) => {
    logger.verbose(`Docker healthcheck API endpoint called.`);

    res.send(0);
    next();
});

// Start Docker healthcheck REST server on port 12398
restServerDockerHealth.listen(12398, function () {
    logger.info(`Docker healthcheck server now listening on ${restServerDockerHealth.url}`);
});



// Create custom property (unless it already exists) used to identify that an app was created from a template
let qrsInstanceCustomPropertyCheck = new qrsInteract(configQRS);


qrsInstanceCustomPropertyCheck.Get('custompropertydefinition')
    .then(result => {
        let customProperyCreatedFromTemplateExists = false;
        result.body.forEach(item => {
            logger.debug(`Custom property found in repository: ${item.name}`);

            if (item.name == config.get('customPropertyCreatedFromTemplate')) {
                customProperyCreatedFromTemplateExists = true;
                customProperyCreatedFromTemplateId = item.id;
                logger.debug(`ID of app-is-created-from-template custom property: ${item.id}`);
            }
        })

        return customProperyCreatedFromTemplateExists;
    })
    .then(customPropertyExists => {
        if (customPropertyExists == false) {
            // The needed custom property does not exist. Create it.
            logger.verbose(`Creating new custom property: ${config.get('customPropertyCreatedFromTemplate')}`);
            qrsInstanceCustomPropertyCheck.Post(
                    'custompropertydefinition', {
                        name: config.get('customPropertyCreatedFromTemplate'),
                        choiceValues: ["Yes"],
                        description: "When set to yes, the associated app was created from a template app",
                        objectTypes: ["App"],
                        valueType: "Text",
                        privileges: null
                    },
                    'json')
                .then(result => {
                    if (result.statusCode == 201) {
                        logger.verbose(`Success - new custom property created: ${config.get('customPropertyCreatedFromTemplate')}`);

                        customProperyCreatedFromTemplateId = result.body.id;
                        logger.debug(`ID of app-is-created-from-template custom property: ${result.body.id}`);
                    }
                })
        } else {
            logger.verbose(`Needed custom property already exsits: ${config.get('customPropertyCreatedFromTemplate')}`);
        }
    });

logger.debug(`Done checking custom property`);



// Handler for REST endpoint /getTemplateList
// URL parameters
//   -- None --
function respondGetTemplateList(req, res, next) {
    configQRS.headers = {
        'X-Qlik-User': 'UserDirectory=Internal; UserId=sa_repository'
    };
    logger.log('verbose', configQRS);

    var qrsInteractInstance = new qrsInteract(configQRS);

    var appList = [];

    qrsInteractInstance.Get(`app/full?filter=@${config.get('customPropertyName')} eq 'Yes'`)
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
    configQRS.headers = {
        'X-Qlik-User': 'UserDirectory=' + config.get('senseUserDirectory') + '; UserId=' + req.query.ownerUserId
    };

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
            qrsInteractInstance.Get('app/' + req.query.templateAppId)
                .then(result => {
                    logger.verbose(`${req.query.templateAppId}: Testing if specified template app really is a template`);

                    var appIsTemplate = false;
                    result.body.customProperties.forEach(function (item) {
                        logger.debug('Item: ' + JSON.stringify(item, null, 2));

                        if (item.definition.name == config.get('customPropertyName') && item.value == 'Yes') {
                            appIsTemplate = true;
                        }
                    })

                    logger.verbose(req.query.templateAppId + ': App is template: ' + appIsTemplate);

                    if (!appIsTemplate) {
                        logger.warn('The provided app ID does not belong to a template app');
                        next(new errors.InvalidArgumentError("The provided app ID does not belong to a template app."));
                    }

                    return appIsTemplate;
                })
                .then(result => {
                    // result == true if the provided app ID belongs to a template app
                    if (result) {
                        qrsInteractInstance.Post(
                                'app/' + req.query.templateAppId + '/copy?name=' + req.query.appName, {},
                                'json')
                            .then(result => {
                                logger.info(`App created with ID ${result.body.id}, using ${req.query.templateAppId} as a template`);
                                newAppId = result.body.id;

                                // result.body contains a full App object. Use it to set the created-from-app-template custom property for the newly created app
                                let newAppBody = result.body;
                                newAppBody.customProperties = [{
                                    value: "Yes",
                                    definition: {
                                        id: customProperyCreatedFromTemplateId
                                    }
                                }];

                                // Set custom property of the new app
                                qrsInteractInstance.Put(
                                        `app/${newAppId}`,
                                        newAppBody
                                    )
                                    .then(result => {

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

                                        enigma.create(configEnigma).open()
                                            .then((global) => {
                                                const g = global;

                                                // Connect to engine
                                                logger.log('verbose', req.query.appName + ': Connecting to engine...');

                                                g.openDoc(newAppId)
                                                    .then((a) => {
                                                        const app = a;

                                                        logger.log('verbose', 'Setting load script...');
                                                        app.setScript(loadScript)
                                                            .then((result) => {
                                                                // Do a reload of the new app?
                                                                if (reloadNewApp) {
                                                                    logger.log('verbose', req.query.appName + ': Reloading app (might take a while, depending on the app)...');
                                                                    app.doReload()
                                                                        .then((result) => {
                                                                            logger.log('verbose', req.query.appName + ': App reloaded.');

                                                                            app.doSave()
                                                                                .then((result) => {
                                                                                    // Close our connection.
                                                                                    logger.log('verbose', req.query.appName + ': Close connection to engine...');
                                                                                    g.session.close()
                                                                                        .then(() => {
                                                                                            logger.log('verbose', req.query.appName + ': Connection closed...');
                                                                                            logger.log('info', req.query.appName + ': Done duplicating, new app id=' + newAppId);
                                                                                            var jsonResult = {
                                                                                                result: "Done duplicating app (new app was reloaded)",
                                                                                                newAppId: newAppId
                                                                                            }
                                                                                            res.send(jsonResult);
                                                                                            next();
                                                                                        })
                                                                                        .catch(err => {
                                                                                            // Return error msg
                                                                                            logger.log('error', 'Duplication error 1: ' + err);
                                                                                            next(new errors.BadRequestError("Error occurred when closing newly created app."));
                                                                                            return;
                                                                                        })
                                                                                })
                                                                                .catch(err => {
                                                                                    // Return error msg
                                                                                    logger.error('Save error: ' + err);
                                                                                    next(new errors.BadRequestError("Error occurred when saving newly created app."));
                                                                                    return;
                                                                                })
                                                                        })
                                                                        .catch(err => {
                                                                            // Return error msg
                                                                            logger.log('error', 'Duplication error (during reload): ' + err);
                                                                            next(new errors.BadRequestError("Error occurred when reloading newly created app."));
                                                                            return;
                                                                        })
                                                                } else {
                                                                    logger.log('verbose', req.query.appName + ': App reloading disabled - skipping.');
                                                                    app.doSave()
                                                                        .then((result) => {
                                                                            // Close our connection.
                                                                            logger.log('verbose', req.query.appName + ': Close connection to engine...');
                                                                            g.session.close()
                                                                                .then(() => {
                                                                                    logger.log('verbose', req.query.appName + ': Connection closed...');
                                                                                    logger.log('info', req.query.appName + ': Done duplicating, new app id=' + newAppId);
                                                                                    var jsonResult = {
                                                                                        result: "Done duplicating app (new app was not reloaded)",
                                                                                        newAppId: newAppId
                                                                                    }
                                                                                    res.send(jsonResult);
                                                                                    next();
                                                                                })
                                                                                .catch(err => {
                                                                                    // Return error msg
                                                                                    logger.log('error', 'Duplication error 1: ' + err);
                                                                                    next(new errors.BadRequestError("Error occurred when closing newly created app."));
                                                                                    return;
                                                                                })
                                                                        })
                                                                        .catch(err => {
                                                                            // Return error msg
                                                                            logger.error('Save error: ' + err);
                                                                            next(new errors.BadRequestError("Error occurred when saving newly created app."));
                                                                            return;
                                                                        })
                                                                }

                                                            })
                                                            .catch(err => {
                                                                // Return error msg
                                                                logger.log('error', 'Duplication error 2: ' + err);
                                                                next(new errors.BadRequestError("Error occurred when replacing script of newly created app."));
                                                                return;
                                                            });
                                                    })
                                                    .catch(err => {
                                                        // Return error msg
                                                        logger.log('error', 'Duplication error 3: ' + err);
                                                        next(new errors.BadRequestError("Error occurred when opening newly created app."));
                                                        return;
                                                    });
                                            })
                                            .catch(err => {
                                                // Return error msg
                                                logger.log('error', 'Duplication error 4: ' + err);
                                                next(new errors.BadRequestError("Error occurred when creating Enigma object."));
                                                return;
                                            });
                                    })
                                    .catch(err => {
                                        // Return error msg
                                        logger.error('Duplication error 5: ' + err);
                                        next(new errors.BadRequestError("Error occurred when setting custom property."));
                                        return;
                                    });
                            })
                            .catch(err => {
                                // Return error msg
                                logger.log('error', 'Duplication error 6: ' + err);
                                next(new errors.BadRequestError("Error occurred when creating new app from template."));
                                return;
                            });
                    }
                })
                .catch(err => {
                    // Return error msg
                    logger.log('error', 'Duplication error 7: ' + err);
                    next(new errors.BadRequestError("Error occurred when test app template status."));
                    return;
                });
        } else {
            logger.log('error', 'Duplication error 8: Failed retrieving script from Git');
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
    configQRS.headers = {
        'X-Qlik-User': 'UserDirectory=' + config.get('senseUserDirectory') + '; UserId=' + req.query.ownerUserId
    };

    var qrsInteractInstance = new qrsInteract(configQRS);

    var newAppId = '';

    var newOwnerId, newOwnerUserDirectory, newOwnerName;
    var newOwnerUserId = req.query.ownerUserId;

    // Get config data on whether to reload the new app or not
    var reloadNewApp = config.get('reloadNewApp');

    // Make sure the app to be duplicated really is a template
    qrsInteractInstance.Get('app/' + req.query.templateAppId)
        .then(result => {
            logger.verbose(`${req.query.templateAppId}: Making sure the specified template app really is a template`);

            var appIsTemplate = false;
            result.body.customProperties.forEach(function (item) {
                logger.debug('Item: ' + JSON.stringify(item, null, 2));

                if (item.definition.name == config.get('customPropertyName') && item.value == 'Yes') {
                    appIsTemplate = true;
                }
            })

            logger.verbose(req.query.templateAppId + 'App is template: ' + appIsTemplate);

            if (!appIsTemplate) {
                logger.warn('The provided app ID does not belong to a template app');
                next(new errors.InvalidArgumentError("The provided app ID does not belong to a template app."));
            }

            return appIsTemplate;
        })
        .then(result => {
            // result == true if the provided app ID belongs to a template app
            if (result) {
                logger.debug('custom property id: ' + customProperyCreatedFromTemplateId);
                qrsInteractInstance.Post(
                        `app/${req.query.templateAppId}/copy?name=${req.query.appName}`, {},
                        'json')
                    .then(result => {
                        logger.info(`App created with ID ${result.body.id}, using ${req.query.templateAppId} as a template`);
                        newAppId = result.body.id;

                        // result.body contains a full App object. Use it to set the created-from-app-template custom property for the newly created app
                        let newAppBody = result.body;
                        newAppBody.customProperties = [{
                            value: "Yes",
                            definition: {
                                id: customProperyCreatedFromTemplateId
                            }
                        }];

                        // Set custom property of the new app
                        qrsInteractInstance.Put(
                                `app/${newAppId}`,
                                newAppBody
                            )
                            .then(result => {

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

                                enigma.create(configEnigma).open()
                                    .then((global) => {
                                        const g = global;

                                        // Connect to engine
                                        logger.log('verbose', req.query.appName + ': Connecting to engine...');

                                        g.openDoc(newAppId)
                                            .then((app) => {
                                                // Do a reload of the new app?
                                                if (reloadNewApp) {
                                                    logger.log('verbose', req.query.appName + ': Reloading app (might take a while, depending on the app)...');
                                                    app.doReload()
                                                        .then((result) => {
                                                            logger.log('verbose', req.query.appName + ': App reloaded.');

                                                            app.doSave()
                                                                .then((result) => {
                                                                    // Close our connection.
                                                                    logger.log('verbose', req.query.appName + ': Close connection to engine...');
                                                                    g.session.close()
                                                                        .then(() => {
                                                                            logger.log('verbose', req.query.appName + ': Connection closed...');
                                                                            logger.log('info', req.query.appName + ': Done duplicating, new app id=' + newAppId);
                                                                            var jsonResult = {
                                                                                result: "Done duplicating app (new app was reloaded)",
                                                                                newAppId: newAppId
                                                                            }
                                                                            res.send(jsonResult);
                                                                            next();
                                                                        })
                                                                        .catch(err => {
                                                                            // Return error msg
                                                                            logger.log('error', 'Duplication error 1: ' + err);
                                                                            next(new errors.BadRequestError("Error occurred when closing newly created app."));
                                                                            return;
                                                                        })
                                                                })
                                                        })
                                                        .catch(err => {
                                                            // Return error msg
                                                            logger.log('error', 'Duplication error (during reload): ' + err);
                                                            next(new errors.BadRequestError("Error occurred when reloading newly created app."));
                                                            return;
                                                        })
                                                } else {
                                                    logger.log('verbose', req.query.appName + ': App reloading disabled - skipping.');
                                                    var jsonResult = {
                                                        result: "Done duplicating app (new app was not reloaded)",
                                                        newAppId: newAppId
                                                    }
                                                    res.send(jsonResult);
                                                    next();
                                                }
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
                                logger.error('Duplication error 4: ' + err);
                                next(new errors.BadRequestError("Error occurred when setting custom property."));
                                return;
                            });
                    })
                    .catch(err => {
                        // Return error msg
                        logger.log('error', 'Duplication error 5: ' + err);
                        next(new restify.BadRequestError("Error occurred when creating new app from template."));
                        return;
                    })
            }
        })
        .catch(err => {
            // Return error msg
            logger.log('error', 'Duplication error 6: ' + err);
            // res.send(err);
            next(new restify.BadRequestError("Error occurred when test app template status."));
            return;
        })

}