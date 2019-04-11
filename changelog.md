# Change log

## v3.0.0

This version is both about updating the tool to work with latest Sense versions, as well as adding some new features:

* Dockerize the tool. Provide everything needed to run the app duplicator as a Docker container, including image files in Docker Hub.
* When run using Docker, the app duplicator will bring up its own web server (based on nginx). No more reliance on external web servers thus.
* Make filelogging optional. The log level used for file logging follows the overall log level that has been configured in the YAML config file.
* https for the app duplicator REST API can be enabled/disabled in the config file. While https is important, it is not always relevant (for example when running behind reverse proxies).
* A custom property (with user configurable name) is set on all apps created using the app duplicator. This makes it easy to later see what apps were created using the app duplicator, and which were not.
