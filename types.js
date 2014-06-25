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
  _ = require('underscore');

var stripNs = function(type)
{
  return type.split(":").slice(-1)[0];
};

var camelCaseType = function(orig)
{
  return orig.replace(/-(.)/g,function(a,x){return x.toUpperCase();});
};

var capitalize = function(orig)
{
  return orig.replace(/^(.){1}/,function(a,x){return x.toUpperCase();});
};

function toDomain(url)
{
  return url !== null ? url.replace(/^((https?:\/\/)?[^\/]+)\/.*$/, "$1") : "";
}

function toRelPath(url)
{
  /*
   * toRelPath taken from shared.js.  We want to keep everything after the first single
   * slash, therefore the second replace call is removed:
   */
  // return url !== null ? url.replace(/^(https?:\/\/)?[^\/]+/, "").replace(/\/[^\/]+$/,"/") : "";
  var path = url !== null ? url.replace(/^(https?:\/\/)?[^\/]+/, "") : "";
  if (path.length != path.lastIndexOf('\/'))
  {
    path = path + "/";
  }
  return path;

}

function appendPaths(basePath, endPath)
{
  if (endPath === undefined || endPath == "/")
  {
    return basePath;
  }
  var p = basePath + endPath;
  return p.replace(/\/+/g,"/");
}


var Type = function(typeName, namespace, isEnumeration, baseType, members, docs)
{
  this.typeName = typeName;
  this.namespace = namespace;
  this.isEnumeration = isEnumeration;
  this.baseType = baseType;
  this.members = members || {};
  this.docs = docs || {};

  this.getFullName = function() {
    return namespace+":"+typeName;
  };
  
  this.getNewCall = function(types, value, indent, prefix)
  {
    if(prefix == undefined)
    {
      prefix = "";
    }
  
    if(this.isEnumeration)
    {
      var val = prefix+this.typeName;
      
      if(value != undefined && this.members[value])
      {
        val = val + "." + value;
      }
      
      return val;
    }
    
    indent = indent ? indent + "  " : "  ";
    var code = "new "+prefix+this.typeName+"(\n"+indent;
    
    var memberList = [];
    for(var memberName in this.members)
    {
      var type = this.members[memberName];
      type = stripNs(type);
      
      if(types[type] == undefined || types[type].typeName != this.typeName)
      {
        memberList.push(
          (types[type] == undefined ? "undefined" :
            types[type].getNewCall(types, undefined, indent, prefix)) + 
          " /* "+memberName+": "+type+" */" );
      }
      else
      {
        memberList.push("new "+prefix+this.typeName+"() /* "+memberName+": "+type+" */");
      }
    }
    
    code = code + memberList.join(", \n"+indent) + "\n"+indent.slice(0,-2)+")";
    
    return code;
  };
  
  this.getRequire = function(subPath)
  {
    if(subPath == undefined)
    {
      subPath = "./";
    }
    subPath = subPath + "/" + this.path;
    subPath = subPath.replace(/([\/]+)/g,"/");
    
    var camelType = this.camelCaseType();
    return camelType+" = require('"+subPath+this.typeName+"')."+camelType+";";
  };
  
  this.camelCaseType = function()
  {
    return camelCaseType(this.typeName);
  };

  this.writeConstructor = function(types, fileName, isServer) {
    if(fileName == undefined)
    {
      fileName = this.typeName+".js";
    }

    var code = this.generateConstructor(types, isServer);
    if (!code)
    {
      console.log("    "+this.typeName + " has no members; skipping constructor.");
      return;
    }
    console.log("    Writing constructor for "+this.typeName+" to "+fileName);

    // There's a limit on how many files we can open at once,
    // make write synchronous to avoid issues. Might be worth
    // setting up an async task queue later
    fs.writeFileSync(fileName, code);
    return fileName;
  };

  this.generateConstructor = function(types, isServer)
  {
    //console.log("  Writing "+this.typeName+" to "+fileName);

    var camelType = this.camelCaseType();
    var camelBase = this.baseType ? camelCaseType(stripNs(this.baseType)) : undefined;

    var typesToRequire = {};

    var memberNames = Object.keys(this.members);
    if (0 === memberNames.length)
    {
      return undefined;
    }

    var code = "";
    if (isServer)
    {
      code = "module = module || {exports: {}};\n";
    }
    code = code + "var " + camelType;

    if(this.isEnumeration)
    {
      var memberDefs = [];
      for(var dex in memberNames)
      {
        var memberName = camelCaseType(memberNames[dex]);
        var keyName = memberName.replace(/[\. \/]/g, '_').replace();
        if (keyName.match(/^\d.*/))
        {
          keyName = "_" + keyName;  //Keys that begin with digits are not allowed, prefix with _
        }
        memberDefs.push(keyName+' : "'+memberName+'"');
      }

      code = code + " = {\n  " + memberDefs.join(",\n  ") + "\n};\n\n";
    }
    else
    {
      var memberNameParams = {};
      var memberParams = [];
      for(var dex in memberNames)
      {
        var param = camelCaseType(memberNames[dex])+"Param";
        memberNameParams[memberNames[dex]] = param;
        memberParams.push(param);
      }

      code = code + " = function("+memberParams.join(", ")+")\n{\n";

      if(camelBase)
      {
        code = code + "  " + camelBase + ".call(this);\n\n";
      }

      for(var memberName in this.members)
      {
        var type = this.members[memberName];
        var param = memberNameParams[memberName];
        var typeObj = types[type];
        var primitive = type.match(/^xs:/);
        type = stripNs(type);

        if(!primitive && typesToRequire[type] == undefined && typeObj != undefined)
        {
          //console.log("    Requires "+type);
          typesToRequire[type] = typeObj;
        }

        code = code + "  this['"+memberName+"'] = "+param;

        code = code +"; // "+type;
        code = code + (this.docs[memberName] ? " " + this.docs[memberName].replace(/\n.*/g, "") : "") + "\n";
      }
      code = code + "};\n";

      if(this.baseType && this.baseType !== "xs:list")
      {
        var baseName = stripNs(this.baseType);

        if(types[baseName])
        {
          code = "var "+types[baseName].getRequire()+"\n\n"+
            code + this.typeName + ".prototype = new " + camelBase + "();\n"+
            this.typeName + ".prototype.constructor = "+camelType+";\n\n";
        }
      }
    }

    if (isServer)
    {
      // This must precede the types required below to prevent circular dependency issues
      code = code + "module.exports."+camelType+" = "+camelType+";\n\n";

      var typeRequires = [];
      var emptyTypeRequires = [];

      for(type in typesToRequire)
      {
        if(0 < Object.keys(typesToRequire[type].members))
        {
          typeRequires.push("var "+typesToRequire[type].getRequire());
        }
        else
        {
          emptyTypeRequires.push("//var "+typesToRequire[type].getRequire() + " TODO enhance typegen to create useful type");
        }
      }
      code = code+typeRequires.join("\n");
      if (0 < emptyTypeRequires.length)
      {
        code = code + "//TODO:  enhance type generation to make these types useful.  They currently\n";
        code = code + "//       have no members and are therefore no source is generated for them.\n";
        code = code + emptyTypeRequires.join("\n");
      }
      code = code+"\n\n";
    }


    return code;
  };

  this.writeModel = function(types, fileName)
  {
    if(this.isEnumeration)
    {
      //Client-side enum types should be written via writeConstructor(type, typeName-enum.js, true)
      return;
    }

    if(fileName == undefined)
    {
      fileName = this.typeName+"-model.js";
    }

    var camelType = this.camelCaseType();
    //begin generated comment block:
    var code = "/*\n * Client code generated by " + process.argv[1].replace(/^.*[\\\/]/,'') + ".\n";
    var forReference = "";
    for (var path in this.paths)
    {
      forReference = forReference + " *   " + path + " supports methods: " + this.paths[path].join(", ") + "\n";
    }
    if ("" !== forReference)
    {
      code = code + " * The paths and methods for the type \"" + camelType + "\" are:\n";
      code = code + forReference;
    }
    else
    {
      code = code + " * There are no HTTP paths or methods for the type \"" + camelType + "\"\n";
    }
    code = code + " */\n";
    //end generated comment block

    code = code + this.generateConstructor(types, false);

    var memberNameParams = {};
    var memberParams = [];
    var memberNames = Object.keys(this.members);
    for(var dex in memberNames)
    {
      var param = camelCaseType(memberNames[dex])+"Param";
      memberNameParams[memberNames[dex]] = param;
      memberParams.push(param);
    }
    var path = this.getShortestPath();
    if (path)
    {
      var methodCounts = {};
      methodCounts.post = this.methodCount("POST");
      methodCounts.put = this.methodCount("PUT");
      methodCounts.get = this.methodCount("GET");
      /*
       * TODO:  fix issue where we don't count DELETE.  Without representation on wadl we don't
       * have a type to map that URL to.  So far this affects only the comments at the top of
       * each model.js file.  For this reason we cannot distinguish PlcmReadOnlyModel.  It seems to
       * be generally unreliable to have the client limit what methods are available, so Jenny
       * is commenting this all out for now.
       */
      // methodCounts.del = this.methodCount("DELETE");  //delete will almost always be zero because there is no type representation
      code = code + "var " + camelType + "Model = function(attributes, options)\n{\n";
      var modelSuperclass = "PlcmModel";
      // if (0 < methodCounts.post && 0 === methodCounts.put && 0 === methodCounts.get)
      // {
        // modelSuperclass = "PlcmControlModel";
      // }
      // else if (0 === methodCounts.post && 0 === methodCounts.put && 0 < methodCounts.get)
      // {
        // modelSuperclass = "PlcmReadOnlyModel";
      // }
      // else if (0 === methodCounts.post && 0 < methodCounts.put && 0 < methodCounts.get)
      // {
        // modelSuperclass = "PlcmConfigModel";
      // }

      code = code + "  _.extend(this, new " + modelSuperclass + "());\n";
      code = code + "  attributes = attributes ? _.clone(attributes) : {};\n";
      code = code + "  options = options ? _.clone(options) : {};\n";
      code = code + "  this.url = \"" + path + "\";\n";
      code = code + "  this.returnType = \"" + this.typeName + "\";\n";
      code = code + "  this.payloadType = " + camelType + ";\n";
      code = code + "  this.setData = function("+memberParams.join(", ")+")\n";
      code = code + "  {\n";
      code = code + "    var obj = {};\n";
      code = code + "    this.payloadType.apply(obj, arguments);\n";
      code = code + "    this.set(obj);\n";
      code = code + "  };\n";

      var attrNamesCode = "";
      var settersCode = "";
      var gettersCode = "";
      for (var memberName in this.members)
      {
        var getterName = camelCaseType("get-" + memberName);
        var setterName = camelCaseType("set-" + memberName);
        var attrName = camelCaseType(memberName) + "AttrName";

        attrNamesCode = attrNamesCode + "  this."+attrName+" = \"" + memberName + "\";\n";
        gettersCode = gettersCode + "  this." + getterName + " = function() { return this.get(this."+attrName+"); };\n";
        settersCode = settersCode + "  this." + setterName + " = function(val) { this.set(this."+ attrName + ", val); };\n";
      }

      code = code + "\n" + attrNamesCode + "\n" + settersCode + "\n" + gettersCode + "\n";

      code = code + "  this.set(this.parse(attributes, options), options);\n";

      code = code + "};\n\n";
    }

    if(this.baseType && this.baseType !== "xs:list")
    {
      var baseName = stripNs(this.baseType);

      if(types[baseName])
      {
        code = "var "+types[baseName].getRequire()+"\n\n"+
          code + this.typeName + ".prototype = new " + camelBase + "();\n"+
          this.typeName + ".prototype.constructor = "+camelType+";\n\n";
      }
    }

    if (this.collection)
    {
      var pathMap = this.collection.getUniquePathMap();
      for (var dex in pathMap)
      {
        code = code + "var " + camelType + dex+ "Collection = function(attributes, options)\n{\n";
        code = code + "  _.extend(this, new PlcmCollection());\n";
        code = code + "  this.url = \"" + pathMap[dex] + "\";\n";
        code = code + "  this.returnType = \"" + this.collection.typeName + "\";\n";
        code = code + "  this.model = " + camelType + "Model;\n";
        code = code + "  attributes = attributes ? _.clone(attributes) : {};\n";
        code = code + "  options = options ? _.clone(options) : {};\n";
        code = code + "  this.set(this.parse(attributes, options), options);\n";
        code = code + "};\n";
      }
    }

    code = code + "\n";

    console.log("    Writing model for "+this.typeName+" to "+fileName);

    // There's a limit on how many files we can open at once,
    // make write synchronous to avoid issues. Might be worth
    // setting up an async task queue later
    fs.writeFileSync(fileName, code);
  };

  this.addMethod = function(methodName, path)
  {
    this.paths = this.paths || {};
    var methods = this.paths[path] || [];
    var found = false;
    for (var idx in methods)
    {
      if (methodName == methods[idx])
      {
        var found = true;
      }
    }
    if (!found)
    {
      methods.push(methodName);
    }
    this.paths[path] = methods;
  }

  /**
   * @param methodName
   * @returns {boolean} true if the type contains only methods with the given methodName
   */
  this.hasOnlyMethodName = function(methodName)
  {
    return 1 === this.methodCount(methodName);
  }

  /**
   * @param methodName
   * @returns {Integer} number of occurrences of the specified method name on the type's paths
   */
  this.methodCount = function(methodName)
  {
    var count = 0;
    var methodNames;
    for(var p in this.paths)
    {
      methodNames = this.paths[p];
      if (methodNames == undefined)
      {
        continue;
      }
      for (var q = 0; q < methodNames.length; q++)
      {
        if (methodName === methodNames[q])
        {
          count ++;
        }
      }
    }
    return count;
  }

  this.hasMemberType = function(memberTypeName)
  {
    return undefined !== this.members[memberTypeName];
  }

  /**
   *
   * @param types containing types inferred from xsd and wadl definitions with collections
   * represented as a type just like everything else.
   *
   * @returns types with collections organized as an attribute of the type it collects.
   */
  Type.reduceCollections = function(types)
  {
    var collectedTypes = {};
    var memberTypeName;
    var memberType;
    var type;

    for(var typeName in types)
    {
      type = types[typeName];
      //plcm-site-link-list-v2 --> plcm-site-link-v2
      //plcm-user-list --> plcm-user
      memberTypeName = typeName.split("-list").join("").trim();
      memberType = types[memberTypeName];
      // console.log("is " + typeName + " a collection of " + memberTypeName + "?")
      if (memberType && memberType !== type)
      {
        // console.log("we have a type with paths: " + JSON.stringify(type.paths));
        if (memberType.paths && 0 < type.methodCount("GET") && type.hasMemberType(memberTypeName))
        {
          // console.log("\tYES");
          memberType.collection = type;
          continue;
        }
      }
      //type is not a collection, add it back to the object we will return
      collectedTypes[typeName] = type;
    }

    return collectedTypes;
  }

  /*
   * The shortest path should be the one without any parameters on it.
   * We will deal with the parameterized paths later.
   */
  this.getShortestPath = function()
  {
    var shortestPath = undefined;
    for (var path in this.paths)
    {
      if (!shortestPath)
      {
        shortestPath = path;
      }
      else if (path.length < shortestPath.length)
      {
        shortestPath = path;
      }
    }
    return shortestPath;
  }

  this.getUniquePathMap = function()
  {
    var pathToName = {}, parts = [], i;
    for (var path in this.paths)
    {
      for (var j=0; j < this.paths[path].length; j++)
      {
        if ("GET" === this.paths[path][j])
        {
          parts.push(path.split(/\//));
          break;
        }
      }
    }

    if (0 == parts.length)
    {
      return {};
    }
    if (1 == parts.length)
    {
      pathToName[""] = path;
      return pathToName;
    }

    parts = _.sortBy(parts, "length");

    //Now, find the index at which the paths differ:
    var index = 0;
    var last = parts[0][index];
    var noMatch = false;
    while (undefined !== last)
    {
      for (i=0; i < parts.length; ++i)
      {
        if (index > parts[i].length || last !== parts[i][index])
        {
          noMatch = true;
          break;
        }
      }
      if (noMatch)
      {
        last = undefined;
        break;
      }
      index ++;
      last = parts[0].length > index ? parts[0][index] : undefined;
    }
    //Now construct the map for returning
    for (i=0; i < parts.length; ++i)
    {
      var q = "";
      if (i > 0)
      {
        q = _.reduce(parts[i].slice(index), function(memo, part)
        {
          return /^\{.*$/.test(part) ? memo : memo + camelCaseType(capitalize(part));
        }, "");
      }
      var p = parts[i].join("/");
      if (pathToName[q])
      {
        console.log("ERROR:  " + p + " already has " + q + ".  Cannot reduce paths for collection " + this.typeName + " to unique names.");
      }
      pathToName[q] = p;
    }
    console.log("    Multiple collections suffixes will be generated for " + this.typeName + ": " + JSON.stringify(pathToName));
    return pathToName;
  }
};



Type.fromWadl = function(file, types, wadl)
{
  // console.log("Processing WADL: " + file);
  var base = wadl["application"];

  var resources = base["resources"][0];

  var models = [];
  if (!resources)
  {
    console.log("No resources found for WADL: " + file);
    return models;
  }

  var urlBase = resources["$"]["base"];
  var basePath = toRelPath(urlBase);

  findResources(resources, basePath, types);

};

function extractAttr(element, attrName)
{
  // console.log("element " + JSON.stringify(element) + " has attr " + attrName);
  if (element === undefined || attrName === undefined)
  {
    return "";
  }
  var attrs = element["$"];
  if (undefined === attrs)
  {
    return "";
  }
  if (undefined === attrs[attrName])
  {
    return "";
  }
  return attrs[attrName];
}

function findResources(baseElement, basePath, types)
{
  var resourceElements = baseElement["resource"] !== undefined ? baseElement["resource"] : [];
  for (var dex in resourceElements)
  {
    var element = resourceElements[dex];
    var path = appendPaths(basePath, extractAttr(element, "path"));
    var methodElements = element.method;
    var methods = [];
    for (var i in methodElements)
    {
      var methodElement = methodElements[i];
      var methodName = extractAttr(methodElement, "name");
      var requestElements = methodElement.request;
      for (var j in requestElements)
      {
        addToType(requestElements[j], path, types, methodName);
      }
      var responseElements = methodElement.response;
      for (var j in responseElements)
      {
        if ("200" != extractAttr(responseElements[j],"status"))
        {
          continue;
        }
        addToType(responseElements[j], path, types, methodName);

      }
    }

    findResources(element, path, types);
  }

}


function addToType(requestOrResponse, path, types, methodName)
{
  var rep = requestOrResponse.representation;
  for (var k in rep)
  {
    var typeName = stripNs(extractAttr(rep[k], "element"));
    var t = types[typeName];
    if (t === undefined)
    {
      // console.log("Unable to find type for " + typeName);
      continue;
    }
    t.addMethod(methodName, path);
    // console.log("added " + methodName + " on " + path + " for type " + typeName );
  }
}


Type.fromXsd = function(xsd, baseTypeName)
{
  //console.log(xsd);
  
  var base = xsd["xs:schema"];

  var attributes = base["$"];
  /*
   * Any non-polycom type should have the source of the type as a prefix in order to
   * prevent conflicts with duplicately named types (like link).
   */
  baseTypeName = attributes["targetNamespace"].match(/.*polycom.*/) ? "" : baseTypeName + "-";
  
  if(!base["xs:element"])
  {
    // console.log(attributes.targetNamespace+" has no elements");
    return null;
  }
  
  var element = base["xs:element"][0];
  var elementTypeName = element["$"].name;
  var elementType = element["$"].type;

  var types = [];

  var subTypes = base["xs:simpleType"];

  for(var dex in subTypes)
  {
    var type = subTypes[dex];
    if(type["xs:restriction"]) // enum
    {
      var restriction = type["xs:restriction"][0];

      if (!restriction || !restriction["$"])
      {
        continue;
      }

      if(base["xs:complexType"])
      {
        elementTypeName = type["$"].name;
      }

      if(restriction["$"].base != "xs:string")
      {
        // console.log(attributes.targetNamespace+":"+elementTypeName+
          // " looks like an enum but inherits from "+restriction["$"].base);
        continue;
      }
      
      var memberList = restriction["xs:enumeration"];
      if (!memberList)
      {
        continue;
      }
      var members = {};
      for(var dex in memberList)
      {
        members[memberList[dex]["$"].value] = memberList[dex]["$"].value;
      }

      // console.log("Enum: "+attributes.targetNamespace+":"+elementTypeName+" - "+JSON.stringify(members));

      types.push(new Type(baseTypeName + elementTypeName, attributes.targetNamespace, true, undefined, members));

      continue;
    }
    // else assume a list
    
    //console.log("List: "+attributes.targetNamespace+":"+typeName+" - "+JSON.stringify(type));
    
    //var Type = function(typeName, namespace, isEnumeration, baseType, members)
    types.push(new Type(baseTypeName + elementTypeName, attributes.targetNamespace, false, "xs:list", []));
  }

  var typeList = [];

  var cleanupComplexType = function(name, complexType)
  {
    if (!complexType)
    {
      return;
    }
    if (!complexType["$"])
    {
      complexType["$"] = { name: name};
    }
    if (complexType["$"].name)
    {
      return complexType;
    }
    //otherwise this is not a complex type about which we care.
  };

  var findComplexTypes = function(object)
  {
    var ctList = object["xs:complexType"];
    if (ctList)
    {
      //console.log("hmm my ct: " + _.isObject(ctList) + ", array: " + _.isArray(hmm));
      //console.log("\t" + JSON.stringify(ctList));
      for( var dex in ctList)
      {
        var ct = cleanupComplexType(object["$"] ? object["$"].name : undefined, ctList[dex]);
        if (ct)
        {
          typeList.push(ct);
        }
      }

    }

    //Continue looking for any xs:complexType on any xs:element
    var el = object["xs:element"];
    for (var dex in el)
    {
      findComplexTypes(el[dex]);
    }
  };

  findComplexTypes(base);

  if (0 === typeList.length)
  {
    return types;
  }

  elementTypeName = element["$"].name;

  // console.log("Found " + typeList.length + " xs:complexType elements in schema for " + elementTypeName + ".");

  var typeMap = {};
  typeMap[elementType] = elementTypeName;
  for(var dex in subTypes)
  {
    var subType = subTypes[dex];
    if(subType["xs:restriction"])
    {
      // console.log(JSON.stringify(subType));
      var subTypeName = subType["$"].name;

      var restriction = subType["xs:restriction"][0];
      if(restriction["$"])
      {
        var baseType = restriction["$"].base;
        if (restriction["xs:enumeration"])
        {
          baseType = subTypeName + " {" + _.reduce(restriction["xs:enumeration"], function(memo, part)
          {
            return (memo ? memo + "," : "") + part["$"].value;
          }, undefined) + "}";
        }
        typeMap[subTypeName] = baseType;
        // console.log(subTypeName+" is really "+baseType);
      }
    }
  }

  subTypes = base["xs:element"];
  for(var dex in subTypes)
  {
    var subType = subTypes[dex];
    var subTypeName = subType["$"].name;
    var subTypeType = subType["$"].type;
    if (subTypeName && subTypeType)
    {
      typeMap[subTypeType] = subTypeName;
    }
  }
  
  // var typeList = base["xs:complexType"];

  for(var dex in typeList)
  {
    var type = typeList[dex];
    //console.log("Parsing "+JSON.stringify(type));
    
    var compTypeName = type["$"].name;
    if(typeMap[compTypeName])
    {
      compTypeName = typeMap[compTypeName];
    }
      
    var members = {};
    var docs = {};
    var attrList = type["xs:attribute"];
    if(attrList)
    {
      //console.log("Attributes: "+JSON.stringify(attrList));
      // <xs:attribute name="type" type="atom:atomMediaType"/>
      for(var dex in attrList)
      {

        var member = attrList[dex];
        
        var memberTypeName = member["$"].type ? member["$"].type : "xs:string";
        
        if(typeMap[memberTypeName])
        {
          memberTypeName = typeMap[memberTypeName];
        }
  
        //console.log(member["$"].name+" -> "+memberTypeName);
        members[member["$"].name] = memberTypeName;

      }
      
    }

    var elements = type["xs:sequence"];
    if(elements)
    {
      var memberList = elements[0]["xs:element"];
      //console.log("Elements: "+JSON.stringify(memberList));
      for(var dex in memberList)
      {
        var member = memberList[dex];

        if (member["xs:annotation"] && member["xs:annotation"][0] && member["xs:annotation"][0]["xs:documentation"] )
        {
          var s = member["xs:annotation"][0]["xs:documentation"].toString().trim();
          docs[member["$"].name] = (s !== "[object Object]" ? s : "");
          // console.log("a docs for " + member["$"].name + ": " + docs[member["$"].name]);
        }

        if(member["$"]["name"]) // simple object
        {
          var memberTypeName = member["$"].type;
          
          if(typeMap[memberTypeName])
          {
            memberTypeName = typeMap[memberTypeName];
          }
    
          // console.log(member["$"].name+" -> "+memberTypeName);
          members[member["$"].name] = memberTypeName;
        }
        else if(member["$"]["ref"]) // optional or list
        {
          //"$":{"ref":"plcm-participant:plcm-participant","minOccurs":"0","maxOccurs":"unbounded"
          var list = member["$"];
          var ref = list.ref;
          
          var minOccur = 1, maxOccur = 1;
          if(list["minOccurs"])
          {
            minOccur = list["minOccurs"];
          }
          if(list["maxOccurs"] && list["maxOccurs"] == "unbounded")
          {
            maxOccur = null;
          }
          
          var memberTypeName = ref;
          //"xs:annotation":[{"xs:appinfo":[{"jxb:property":[{"$":{"name":
          var memberName = ref.split(":")[1];
  
          //console.log(memberName+" -> "+memberTypeName);
          members[memberName] = memberTypeName;
        }
      }
    }
    
    
    // console.log("Class: "+attributes.targetNamespace+":"+compTypeName+" - "+JSON.stringify(members));
  
    //var Type = function(typeName, namespace, isEnumeration, baseType, members)

    types.push(new Type(baseTypeName + compTypeName, attributes.targetNamespace, false, undefined, members, docs));
  }
  return types;
}


var Method = function(methodName, inputType, outputType)
{
  this.methodName = methodName;
  this.inputType = inputType;
  this.outputType = outputType;
}

module.exports.Type = Type;
module.exports.Method = Method;
