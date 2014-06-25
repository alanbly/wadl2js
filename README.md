wadl2js
=======

A node.js utility for transforming WADL and XSD files to Javascript Classes and Backbone Models


# Usage #

 * To run the utility: `node wadl2js.js [wadlFolder modelFolder typeFolder]`
 ** By default the script will assume that you have WADL and XSD files in a folder called "wadl" and will output simple types to a folder called "wadltypegen" and Backbone models to a folder called "models"
 ** The directories and behavior can be customized by specifying all three on the command line. 

