/* client.js: manages the client-side of the collaborative editor
 * Copyright (c) 2011 Jan Keromnes. All rights reserved.
 * */
 
 window.client = {
  user: "dom",
  rev: 0,
  lastcopy: "<!doctype html>\n<title><\/title>\n\n<body>\n  <canvas id=tutorial width=150 height=150><\/canvas>\n\n  <script>\n    var canvas = document.getElementById('tutorial');\n    var context = canvas.getContext('2d');\n\n    context.fillStyle = 'rgb(250,0,0)';\n    context.fillRect(10, 10, 55, 50);\n\n    context.fillStyle = 'rgba(0, 0, 250, 0.5)';\n    context.fillRect(30, 30, 55, 50);\n  <\/script>\n<\/body>",
  delta: [],
  timeout: 500
}

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
	  while(delta[i][2] > (compte + editor.lineContent(line).length)) {
	    compte += editor.lineContent(line).length;
		line = editor.nextLine(line);
	  }
	  if(delta[i][0] == 1) {
	    //alert("insert "+JSON.stringify(delta[i]));
		editor.insertIntoLine(line, resp.delta[i][2] - compte, delta[i][1]);
	  }
	  else {
	    //alert("remove "+JSON.stringify(delta[i]));
	    editor.removeFromLine(line, resp.delta[i][2] - compte, delta[i][1]);
      }
	}
  }
};

setInterval(Scout.send(function(xhr, params){

  var bufcopy = editor.getCode();
  var dmp = new diff_match_patch();
  client.delta = Diff.delta(dmp.diff_main(client.lastcopy, editor.getCode()));

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
	
	var code = editor.getCode();
	var dmp = new diff_match_patch();
	client.delta = Diff.solve(Diff.delta(dmp.diff_main(bufcopy, code)), resp.delta);
	
	extenditor.applydelta(resp.delta, editor);
	client.lastcopy = editor.getCode();
	extenditor.applydelta(client.delta, editor);
	
  };
  
}), client.timeout);

setInterval((function() {
  preview = document.getElementById('preview');
  return function() { preview.contentDocument.open(); preview.contentDocument.write(editor.getCode()); preview.contentDocument.close(); }
})(), 500);
