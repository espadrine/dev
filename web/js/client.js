/* client.js: manages the client-side of the collaborative editor
 * Copyright (c) 2011 Jan Keromnes. All rights reserved.
 * */

(function() {
 
  window.client = {
    user: "dom",
    rev: 0,
    lastcopy: "<!doctype html>\n<title><\/title>\n\n<body>\n  <canvas id=tutorial width=150 height=150><\/canvas>\n\n  <script>\n    var canvas = document.getElementById('tutorial');\n    var context = canvas.getContext('2d');\n\n    context.fillStyle = 'rgb(250,0,0)';\n    context.fillRect(10, 10, 55, 50);\n\n    context.fillStyle = 'rgba(0, 0, 250, 0.5)';\n    context.fillRect(30, 30, 55, 50);\n  <\/script>\n<\/body>",
    delta: [],
    timeout: 500
  };
  
  window.editor = new CodeMirror(document.body, {
    content: window.client.lastcopy,
    height: "100%",
    width: "50%",
    parserfile: ["parsexml.js", "parsecss.js", "tokenizejavascript.js", "parsejavascript.js", "parsehtmlmixed.js"],
    stylesheet: ["css/xmlcolors.css", "css/jscolors.css", "css/csscolors.css"],
    path: "js/"
  });
  
  window.extenditor = {
    applydelta : function(delta, editor) {
      var car = 0;
  	var line = editor.firstLine();
  	for(var i = 0 ; i < delta.length ; i++ ) {
  	  while(delta[i][2] > (car + editor.lineContent(line).length)) {
  	    car += editor.lineContent(line).length;
  		line = editor.nextLine(line);
  	  }
  	  if(delta[i][0] == 1) {
            console.log('received [insert '+JSON.stringify(delta[i])+']');
            editor.insertIntoLine(line, delta[i][2] - car, delta[i][1]);
  	  }
  	  else {
            console.log('received [remove '+JSON.stringify(delta[i])+']');
            editor.removeFromLine(line, delta[i][2] - car, delta[i][1]);
        }
  	}
    }
  };
  
  setInterval(Scout.send(function(xhr, params){
  
    var bufcopy = window.editor.getCode();
    var dmp = new diff_match_patch();
    client.delta = Diff.delta(dmp.diff_main(client.lastcopy, window.editor.getCode()));
  
    if(client.delta.length > 0) {
      var disp = 'send ';
      for (var i in client.delta) {
        disp += (client.delta[i][0] === 1 ? '[insert ' : '[remove ')+JSON.stringify(client.delta[i])+'] ';
      }
      console.log(disp);
    }

    params.data = {
  	usr: client.usr,
  	rev: client.rev,
  	delta: client.delta
    };
    
    params.error = function(xhr, status) {
  	// TODO
    };
    
    params.open.url = '/_/change';
    
    params.resp = function(xhr, resp) {

        client.rev = resp.rev;
        client.delta = [];

        if(resp.delta.length > 0) {  	
  	  
          var code = editor.getCode(); // note : window.editor.getCode() does not work here
  	  var dmp = new diff_match_patch();
  	  client.delta = Diff.solve(Diff.delta(dmp.diff_main(bufcopy, code)), resp.delta);
  	
  	  extenditor.applydelta(resp.delta, editor);
  	  client.lastcopy = editor.getCode();
  	  extenditor.applydelta(client.delta, editor);

  	}
    };
    
  }), client.timeout);

})();

setInterval((function() {
  preview = document.getElementById('preview');
  return function() { preview.contentDocument.open(); preview.contentDocument.write(editor.getCode()); preview.contentDocument.close(); } // editor.getCode() or window.editor.getCode() ?? seems random
})(), 500);
