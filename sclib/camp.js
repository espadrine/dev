

exports.Camp = (function () {
  var camp = function (action, callback) {
  	exports.Camp.Actions[action] = callback;
  };
  camp.Actions = {};
  
  return camp;
})();

exports.Camp.start = function (port) {
  port = port || 80;
  
  var http = require('http'),
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
        var resp = JSON.stringify (exports.Camp.Actions[action] (query));
        res.write(resp);
        res.end();
      
      } else	{
        console.log(path);
        var src = fs.readFileSync(realpath).toString();	    	
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.write(src);
        res.end();
      }
    	
    }
    catch(e) {
      res.writeHead(404);
      res.write('404: thou hast finished me!');
      res.write(e.toString());
      res.end();
    }
  
  }).listen(port);
};


