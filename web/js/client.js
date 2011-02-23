/* client.js: manages the client-side of the collaborative editor
 * Copyright (c) 2011 Jan Keromnes. All rights reserved.
 * */
 
 client = {
  user: "dom",
  rev: 0,
  copy: "<!doctype html>\n<title><\/title>\n\n<body>\n  <canvas id=tutorial width=150 height=150><\/canvas>\n\n  <script>\n    var canvas = document.getElementById('tutorial');\n    var context = canvas.getContext('2d');\n\n    context.fillStyle = 'rgb(250,0,0)';\n    context.fillRect(10, 10, 55, 50);\n\n    context.fillStyle = 'rgba(0, 0, 250, 0.5)';\n    context.fillRect(30, 30, 55, 50);\n  <\/script>\n<\/body>",
  timeout: 500
}

var editor = new CodeMirror(document.body, {
  content: window.client.copy,
  height: "100%",
  width: "50%",
  parserfile: ["parsexml.js", "parsecss.js", "tokenizejavascript.js", "parsejavascript.js", "parsehtmlmixed.js"],
  stylesheet: ["css/xmlcolors.css", "css/jscolors.css", "css/csscolors.css"],
  path: "js/"
});

setInterval(Scout.send(function(xhr, params){

  var dmp = new diff_match_patch();
  var bufcopy = editor.getCode();

  params.data = {
	usr: client.usr,
	rev: client.rev,
	delta: Diff.delta(dmp.diff_main(client.copy, editor.editor.getCode()))
  };
  
  params.error = function(xhr, status) {
	// TODO
  };
  
  params.open.url = '/_/change';
  
  params.resp = function(xhr, resp) {
	client.rev = resp.rev;
	client.delta = [];
	var pos = editor.cursorPosition(true);
	var text = editor.getCode();
	
	var dmp = new diff_match_patch();
	client.delta = Diff.solve(Diff.delta(dmp.diff_main(bufcopy, text)), resp.delta);
	text = Diff.applydelta(resp.delta, text);
	client.copy = text;
	
	//editor.setCode(Diff.applydelta(client.delta, text));
	//[[1,'trolo',15]]
	var compte = 0;
	var line = editor.firstLine();
	for(var i = 0 ; i < client.delta.length ; i++ ) {
	  while(client.delta[i][2] > (compte + editor.lineContent(line).length)) {
	    compte += editor.lineContent(line).length;
		line = editor.nextLine(line);
	  }
	  if(client.delta[i][0] == 1) {
		editor.insertIntoLine(line, client.delta[i][2] - compte, client.delta[i][1]);
	  }
	  else {
	    editor.removeFromLine(line, client.delta[i][2] - compte, client.delta[i][1]);
      }
	}
	
	// this doesn't actually select lines, it places the cursor to the old position
	editor.selectLines(pos.line, pos.character);
  };
  
}), client.timeout);

setInterval((function() {
  preview = document.getElementById('preview');
  return function() { preview.contentDocument.open(); preview.contentDocument.write(editor.getCode()); preview.contentDocument.close(); }
})(), 500);
