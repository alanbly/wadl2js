/**
 * Copyright (c) 2013 All Rights Reserved, Polycom, Inc.
 *
 *  6001 America Center Drive
 *  San Jose, CA 95002
 *  USA
 *  http://www.polycom.com
 *  
 *  No part of this software (source code) may be reproduced or transmitted
 *  in any form or by any means, electronic or mechanical, for any purpose,
 *  without the express written permission of Polycom, Inc. Under the law,
 *  reproducing includes translating into another programming language or
 *  format.
 *  
 *  Polycom, Inc., retains title to and ownership of all proprietary rights
 *  with respect to this software. This software is protected by United States
 *  copyright laws and international treaty provisions. Therefore, you must
 *  treat this software like any other copyrighted material (e.g., a book or
 *  sound recording).
 *
 */

var fs = require('fs'),
    mkdirp = require('mkdirp'),
    xml2js = require('xml2js'),
    typeLib = require('./types.js');

var parseString = xml2js.parseString;
var Type = typeLib.Type;
var Method = typeLib.Method;

var parseFileAndRun = function(file, parser)
{
  var path = file.replace(/(^.*\/)[^\/.*]*.*/, "$1").slice(apiRoot.length);
  var xml = fs.readFileSync(file, 'utf8');

  parseString(xml, function (err, result) {
    if(err)
    {
      console.log("Failed to parse file "+file+": "+err);
      return;
    }
    parser(result, path);
  });
};

var parseWadl = function(file, wadls, callback)
{
  var typeName = file.replace(/^.*\/([^\/.*]*).wadl/,"$1");
  parseFileAndRun(file, function (result, path) {
    Type.fromWadl(file, types, result);

    wadls[typeName] = result;
    
    callback(file + "\t --> "+typeName);
  });
};

var parseXsd = function(file, types, callback)
{
  var typeName = file.replace(/^.*\/([^\/.*]*).xsd/,"$1");
  parseFileAndRun(file, function (result, path) {
    var newTypes = Type.fromXsd(result, typeName);
    
    var typeNames = [];
    for(var dex in newTypes)
    {
      var type = newTypes[dex];
      type.path = path;
      types[type.typeName] = type;
      typeNames.push(type.typeName);
    }
    
    callback(file + "\t --> "+typeNames.join(", "));
  });
};

var ensureDir = function(base, dir)
{
  var subdirs = dir.split("/");
  dir = base;
  for(dex in subdirs)
  {
    dir = dir + "/" + subdirs[dex];
    if (!fs.existsSync(dir))
    {
      fs.mkdirSync(dir);
    }
  }
  return dir;
}

var writeFiles = function(types, wadls)
{

  console.log("server-side types will be written to: " + serverJsFolder);
  console.log("client-side types will be written to: " + clientJsFolder);
  // Now write constructors for all the types
  var importsCode = [];
  var written = {};
  for(var typeName in types)
  {
    var type = types[typeName];
    var dir = ensureDir(serverJsFolder, type.path);

    if(written[type.typeName] === undefined)
    {
      var fileName = dir + "/" +type.typeName+".js";
      written[type.typeName] = fileName;

      console.log("  Writing Constructor for "+type.typeName);
      if (type.writeConstructor(types, fileName, true))
      {
        importsCode.push("module.exports."+type.getRequire());
      }
    }
  }

  // Now write an index file
  var importCode = importsCode.join("\n")+"\n\n";
  console.log("  Writing Index File");
  fs.writeFileSync(serverJsFolder+"/index.js", importCode);

  types = Type.reduceCollections(types);

  for(var typeName in types)
  {
    var type = types[typeName];
    var dir = ensureDir(clientJsFolder, type.path);
    console.log("  Writing Model for "+type.typeName);
    if (type.isEnumeration)
    {
      type.writeConstructor(types, dir + "/" + type.typeName + "-enum.js", false);
    }
    else
    {
      type.writeModel(types, dir + "/" + type.typeName + "-model.js");
    }
  }
};

var clientJsFolder = "models";
var serverJsFolder = "wadltypegen";
var apiRoot = "wadl";
if (5 === process.argv.length)
{
  console.log("Running with apiRoot, clientJsFolder, and serverJsFolder as specified on the command line.");
  apiRoot = process.argv[2];
  clientJsFolder = process.argv[3];
  serverJsFolder = process.argv[4];
}
else
{
  console.log("Running with default apiRoot, clientJsFolder, and serverJsFolder.");
}

var err = false;
if (!fs.existsSync(clientJsFolder))
{
  mkdirp.sync(clientJsFolder);
  if (!fs.existsSync(clientJsFolder))
  {
    console.log("clientJsFolder \"" + clientJsFolder + "\" does not exist.");
    err = true;
  }
}
if (!fs.existsSync(serverJsFolder))
{
  mkdirp.sync(serverJsFolder);
  if (!fs.existsSync(serverJsFolder))
  {
    console.log("serverJsFolder \"" + serverJsFolder + "\" does not exist.");
    err = true;
  }
}
if (!fs.existsSync(apiRoot))
{
  console.log("apiRoot \"" + apiRoot + "\" does not exist.");
  err = true;
}
if (err)
{
  console.log("Existing folders for apiRoot, clientJsFolder and serverJsFolder not found.");
  return;
}

var wadlInputs = [];
var xsdInputs = [];

var readApiInputs = function(parent)
{
  var files = fs.readdirSync(parent);
  for (var i in files)
  {
    var f = parent + "/" + files[i];
    if (f.match(/.xsd$/))
    {
      xsdInputs.push(f);
    }
    else if (f.match(/.wadl$/))
    {
      wadlInputs.push(f);
    }
    else if (fs.lstatSync(f).isDirectory())
    {
      readApiInputs(f);
    }
  }
}

readApiInputs(apiRoot);

console.log("Found "+wadlInputs.length+" wadl files and " + xsdInputs.length + " xsd files, parsing...");

var processed = 0;

var generate = function()
{
  if(processed != total)
  {
    return;
  }

  console.log("Processed " + total + " wadl and xsd files.  Building code...");
  
  writeFiles(types, wadls);
};

var callback = function(typeName)
{
  ++processed;
  console.log(processed+"/"+total + " completed \t"+typeName);
  generate();
};


var wadls = {};
var types = {};
var total = xsdInputs.length + wadlInputs.length;
for(var dex in xsdInputs)
{
  var file = xsdInputs[dex];
  parseXsd(file, types, callback);
}

for(var dex in wadlInputs)
{
  var file = wadlInputs[dex];
  parseWadl(file, wadls, callback);
}

