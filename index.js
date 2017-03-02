const qsocks = require('qsocks');
const fs = require('fs');
const util = require('util')
var qrsInteract = require('qrs-interact');
var request = require('request');
var restify = require('restify');
var winston = require('winston');
var config = require('config');



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

// Set up Sense engine configuration 
const configEngine = {
    host: config.get('host'),
    port: 4747, // Standard Engine port
    isSecure: config.get('isSecure'),
    headers: {
        'X-Qlik-User': 'UserDirectory=Internal;UserId=sa_repository' // Passing a user to QIX to authenticate as
    },
    key: client_key,
    cert: client,
    rejectUnauthorized: false // Don't reject self-signed certs
};

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
    version: '1.1.0',
    certificate: fs.readFileSync(config.get('sslCertPath')),
    key: fs.readFileSync(config.get('sslCertKeyPath'))
});


// Enable parsing of http parameters
restServer.use(restify.queryParser());

// Set up CORS handling
restServer.use(restify.CORS({ origins: ['*'] }));

// Set up endpoints for REST server
restServer.get('/duplicateNewScript', respondDuplicateNewScript);
restServer.get('/duplicateKeepScript', respondDuplicateKeepScript);
restServer.get('/getTemplateList', respondGetTemplateList);


// Start the server
restServer.listen(8001, function () {
    console.log('%s listening at %s', restServer.name, restServer.url);
});



// Handler for REST endpoint /getTemplateList
// URL parameters
//   -- None --
function respondGetTemplateList(req, res, next) {
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

                logger.log('debug', 'Element name: ' + element.name);
                logger.log('debug', 'App list JSON: ' + JSON.stringify(appList));
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
    configQRS.headers = { 'X-Qlik-User': 'UserDirectory=' + config.get('senseUserDirectory') + '; UserId=' + req.params.ownerUserId };
    logger.log('verbose', configQRS);

    var qrsInteractInstance = new qrsInteract(configQRS);

    // Load script from git
    request.get(loadScriptURL, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            logger.log('verbose', 'Retrieved load script');

            var loadScript = body;
            logger.log('debug', 'Load script: ' + loadScript);

            var newAppId = '';
            var globalEngine = '';

            var newOwnerId, newOwnerUserDirectory, newOwnerName;
            var newOwnerUserId = req.params.ownerUserId;


            // Make sure the app to be duplicated really is a template
            qrsInteractInstance.Get('app/' + req.params.templateAppId)
                .then(result => {
                    logger.log('verbose', 'Testing if specifiec template app really is a template');

                    var appIsTemplate = false;
                    result.body.customProperties.forEach(function (item) {
                        logger.log('debug', 'Item: ' + item);

                        if (item.definition.name == 'AppIsTemplate' && item.value == 'Yes') {
                            appIsTemplate = true;
                        }
                    })

                    logger.log('verbose', 'App is template: ' + appIsTemplate);

                    if (!appIsTemplate) {
                        logger.log('warn', 'The provided app ID does not belong to a template app');
                        next(new restify.InvalidArgumentError("The provided app ID does not belong to a template app."));
                    }

                    return appIsTemplate;
                })
                .then(result => {
                    // result == true if the provided app ID belongs to a template app
                    if (result) {

                        qrsInteractInstance.Post('app/' + req.params.templateAppId + '/copy?name=' + req.params.appName, {}, 'json')
                            .then(result => {
                                logger.log('info', 'App created with ID %s, using %s as a template ', result.body.id, req.params.templateAppId);

                                newAppId = result.body.id;

                                return;
                            })
                            .then(() => {
                                // Connect to engine
                                logger.log('verbose', 'Connecting to engine...');
                                return qsocks.Connect(configEngine);
                            })
                            .then(global => {
                                // Connected. Open the newly created app
                                logger.log('verbose', 'Opening app...');
                                globalEngine = global;
                                return global.openDoc(newAppId)
                            })
                            .then(app => {
                                // Give the new app a new load script
                                logger.log('verbose', 'Setting load script...');
                                app.setScript(loadScript);
                                return app;
                            })
                            .then(app => {
                                // Load the data
                                logger.log('verbose', 'Reload app...');
                                app.doReload();
                                return app
                            })
                            .then(app => {
                                // Save our data. Will persist to disk.
                                logger.log('verbose', 'Save app to disk...');
                                app.doSave();
                                return;
                            })
                            .then(() => {
                                // Close our connection.
                                logger.log('verbose', 'Close connection to engine...');
                                return globalEngine.connection.close();
                            })
                            .then(() => {
                                logger.log('info', 'Done duplicating, new app id=' + newAppId);
                                var jsonResult = { result: "Done duplicating app", newAppId: newAppId }
                                res.send(jsonResult);
                                next();
                            })
                            .catch(err => {
                                // Failed to create app. In Desktop application names are unique.
                                logger.log('error', 'Duplication error: ' + err);
                                res.send(err);
                                next(new restify.BadRequestError("Error occurred when test app template status 2."));;

                            })
                    }


                })
                .catch(err => {
                    // Return error msg
                    logger.log('error', 'Duplication error: ' + err);
                    // res.send(err);
                    next(new restify.BadRequestError("Error occurred when test app template status."));;
                    return;
                })


        }
    });
}


// Handler for REST endpoint /duplicateKeepScript
// URL parameters
//   templateAppId: ID of app to use as template
//   appName: Name of the new app that is created
//   ownerUserId: User ID that should be set as owner of the created app
function respondDuplicateKeepScript(req, res, next) {

    // Add owner of new app as header in call to QRS. That way this user will automatically be owner of the newly created app.
    configQRS.headers = { 'X-Qlik-User': 'UserDirectory=' + config.get('senseUserDirectory') + '; UserId=' + req.params.ownerUserId };
    logger.log('verbose', configQRS);

    var qrsInteractInstance = new qrsInteract(configQRS);

    var newAppId = '';
    var globalEngine = '';

    var newOwnerId, newOwnerUserDirectory, newOwnerName;
    var newOwnerUserId = req.params.ownerUserId;

    // Make sure the app to be duplicated really is a template
    qrsInteractInstance.Get('app/' + req.params.templateAppId)
        .then(result => {
            logger.log('verbose', 'Testing if specifiec template app really is a template');

            var appIsTemplate = false;
            result.body.customProperties.forEach(function (item) {
                logger.log('debug', 'Item: ' + item);

                if (item.definition.name == 'AppIsTemplate' && item.value == 'Yes') {
                    appIsTemplate = true;
                }
            })

            logger.log('verbose', 'App is template: ' + appIsTemplate);

            if (!appIsTemplate) {
                logger.log('warn', 'The provided app ID does not belong to a template app');
                next(new restify.InvalidArgumentError("The provided app ID does not belong to a template app."));
            }

            return appIsTemplate;
        })
        .then(result => {
            // result == true if the provided app ID belongs to a template app
            if (result) {

                qrsInteractInstance.Post('app/' + req.params.templateAppId + '/copy?name=' + req.params.appName, {}, 'json')
                    .then(result => {
                        logger.log('info', 'App created with ID %s, using %s as a template ', result.body.id, req.params.templateAppId);

                        newAppId = result.body.id;

                        return;
                    })
                    .then(() => {
                        // Connect to engine
                        logger.log('verbose', 'Connecting to engine...');
                        return qsocks.Connect(configEngine);
                    })
                    .then(global => {
                        // Connected. Open the newly created app
                        logger.log('verbose', 'Opening app...');
                        globalEngine = global;
                        return global.openDoc(newAppId)
                    })
                    .then(app => {
                        // Load the data
                        logger.log('verbose', 'Reload app...');
                        app.doReload();
                        return app
                    })
                    .then(app => {
                        // Save our data. Will persist to disk.
                        logger.log('verbose', 'Save app to disk...');
                        app.doSave();
                        return;
                    })
                    .then(() => {
                        // Close our connection.
                        logger.log('verbose', 'Close connection to engine...');
                        return globalEngine.connection.close();
                    })
                    .then(() => {
                        logger.log('info', 'Done duplicating, new app id=' + newAppId);
                        var jsonResult = { result: "Done duplicating app", newAppId: newAppId }
                        res.send(jsonResult);
                        next();
                    })
                    .catch(err => {
                        // Failed to create app. In Desktop application names are unique.
                        logger.log('error', 'Duplication error: ' + err);
                        res.send(err);
                        next(new restify.BadRequestError("Error occurred when test app template status 2."));;

                    })
            }


        })
        .catch(err => {
            // Return error msg
            logger.log('error', 'Duplication error: ' + err);
            // res.send(err);
            next(new restify.BadRequestError("Error occurred when test app template status."));;
            return;
        })


}
