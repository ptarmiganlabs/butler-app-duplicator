# Change log

## 3.0.1

Minor update.

* Sort app templates alphabetically. This makes it easier to find the correct template when there are many templates to choose from.

## 3.0.0

This version is both about updating the tool to work with latest Sense versions, as well as adding several new features:

* Dockerization. Provide everything needed to run the app duplicator as a Docker container, including image files in Docker Hub.
* When run using Docker, the app duplicator will bring up its own web server (based on nginx). No more reliance on external web servers thus.
* Make filelogging optional. The log level used for file logging follows the overall log level that has been configured in the YAML config file.
* https for the app duplicator REST API can be enabled/disabled in the config file. While https is important, it is not always relevant (for example when running behind reverse proxies).
* User configurable name of custom property that will be set for apps created using this tool. This makes it easy to later see what apps were created using the app duplicator, and which were not.
* User configurable name of the custom property used to identify apps as being templates. If the property does not exist, it will be created.

## 2.2

* Switched to using latest Enigma.js (v2). Added Mocha/Supertest test cases.

## 2.1

* Changed to YAML config file, updated module dependencies to latest version, added new config options for port and engine version.
