/* camp.js: server-side Ajax handler that wraps around node.js.
 * Copyright (c) 2011 Thaddee Tyl. All rights reserved.
 */

// Register ajax action.

exports.Camp = (function () {
  var camp = function (action, callback) {
  	exports.Camp.Actions[action] = callback;
  };
  camp.Actions = {};
  
  return camp;
})();


exports.Camp.mime = {
  'txt': 'text/plain',
  'html': 'text/html',
  'xhtml': 'text/html',
  'htm': 'text/html',
  'xml': 'text/xml',
  'css': 'text/css',
  'csv': 'text/csv',
  'dtd': 'application/xml-dtd',

  'js': 'application/javascript',
  'json': 'application/json',

  'pdf': 'application/pdf',
  'ps': 'application/postscript',
  'odt': 'application/vnd.oasis.opendocument.text',
  'ods': 'application/vnd.oasis.opendocument.spreadsheet',
  'odp': 'application/vnd.oasis.opendocument.presentation',
  'xls': 'application/vnd.ms-excel',
  'doc': 'application/vnd.msword',
  'ppt': 'application/vnd.ms-powerpoint',
  'xul': 'application/vnd.mozilla.xul+xml',
  'kml': 'application/vnd.google-earth.kml+xml',
  'dvi': 'application/x-dvi',
  'tex': 'application/x-latex',
  'ttf': 'application/x-font-ttf',
  'swf': 'application/x-shockwave-flash',
  'rar': 'application/x-rar-compressed',
  'zip': 'application/zip',
  'tar': 'application/x-tar',
  'gz': 'application/x-gzip',

  'ogg': 'audio/ogg',
  'mp3': 'audio/mpeg',
  'mpeg': 'audio/mpeg',
  'wav': 'audio/vnd.wave',
  'wma': 'audio/x-ms-wma',
  'gif': 'image/gif',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'svg': 'image/svg+xml',
  'tiff': 'image/tiff',
  'ico': 'image/vnd.microsoft.icon',
  'mp4': 'video/mp4',
  'ogv': 'video/ogg',
  'mov': 'video/quicktime',
  'webm': 'video/webm',
  'wmv': 'video/x-ms-wmv'
};

// Start function.

exports.Camp.start = function (port, debug) {
  port = port || 80;
  
  var http = require('http'),
  p = require('path'),
  fs = require('fs'),
  url = require('url'),
  qs = require('querystring');
  
  http.createServer(function(req,res){
    var uri = url.parse (req.url, true);
    var path = uri.pathname;
    var query = uri.query;
    
    try {
      console.log(path);
      if (path.match (/\/$/)) {
        path = path + 'index.html';
      }
      var realpath = '.' + path;
      
      if (/^\/_\//.test (path)) {
        var action = path.slice (3);
        
        res.writeHead(200, {'Content-Type': 'application/json'});
        req.on ('data', function (chunk) {

          /* Parse the chunk (it is an object literal). */
          query = qs.parse (unescape(chunk));
          for (var el in query) {
            try {
              query[el] = JSON.parse (unescape(query[el]));
            } catch (e) {
              console.log ('query[el]: ' + query[el] + ' ' + e);
            }
          }

          /* Launch the defined action. */
          if (exports.Camp.Actions[action]) {
            var resp = JSON.stringify (exports.Camp.Actions[action] (query));
            res.write (resp);
            res.end ();
          } else {
            res.write ('404');
            res.end ();
          }

        });
      
      } else	{
        if (debug) { console.log(path); }
        var src = fs.readFileSync(realpath).toString();	    	
        
        /* What extension is it? */
        var ext = p.extname (realpath).slice (1);
        res.writeHead(200, {'Content-Type': exports.Camp.mime[ext]});
        res.write(src);
        res.end();
      }
    	
    }
    catch(e) {
      res.writeHead(404);
      res.write('404: thou hast finished me!\n');
      if (debug) { res.write(e.toString()); }
      res.end();
    }
  
  }).listen(port);
};
