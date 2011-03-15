/* client.js: manages the client-side of the collaborative editor
 * Copyright (c) 2011 Jan Keromnes. All rights reserved.
 * */
 
window.client = {
  user: "dom",
  rev: 0,
  lastcopy: "<!doctype html>\n<title><\/title>\n\n<body>\n  <canvas id=tutorial width=150 height=150><\/canvas>\n\n  <script>\n    var canvas = document.getElementById('tutorial');\n    var context = canvas.getContext('2d');\n\n    context.fillStyle = 'rgb(250,0,0)';\n    context.fillRect(10, 10, 55, 50);\n\n    context.fillStyle = 'rgba(0, 0, 250, 0.5)';\n    context.fillRect(30, 30, 55, 50);\n  <\/script>\n<\/body>",
  delta: [],
  waiting: false,
  timeout: 3000 // DEBUG
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
    var max = editor.getCode().length;
    var line = editor.firstLine();
    for(var i = 0 ; i < delta.length ; i++ ) {
      while(delta[i][2] > (car + editor.lineContent(line).length)) {
        car += editor.lineContent(line).length + 1;
      line = editor.nextLine(line);
      }
      var pos = (delta[i][2] - car < max ? delta[i][2] - car : "end" );
      if(delta[i][0] == 1) {
        editor.insertIntoLine(line, pos, delta[i][1]);
      }
      else {
        editor.removeFromLine(line, pos, delta[i][1]);
      }
    }
  }
};

setInterval(Scout.send(function(xhr, params){

  if(!client.waiting){

    client.waiting = true;
    var bufcopy = editor.getCode();
    var dmp = new diff_match_patch();
    client.delta = Diff.delta(dmp.diff_main(client.lastcopy, editor.getCode()));

    params.data = {
      usr: client.usr,
      rev: client.rev,
      delta: client.delta
    };
    
    // DEBUG
    console.log('sending rev : '+params.data.rev+', delta : '+JSON.stringify(params.data.delta));
    
    params.error = function(xhr, status) {
      // TODO
    };
    
    params.open.url = '/_/change';
    
    params.resp = function(xhr, resp) {
      // DEBUG
      console.log('recieved rev : '+resp.rev+', delta : '+JSON.stringify(resp.delta));
      
      client.rev = resp.rev;
      client.delta = [];
      
      if (resp.delta.length != 0) {
        var dmp = new diff_match_patch();
        client.delta = Diff.solve(Diff.delta(dmp.diff_main(bufcopy, editor.getCode())), resp.delta);
        
        extenditor.applydelta(resp.delta, editor);
        Diff.applydelta(resp.delta, client.lastcopy);
        extenditor.applydelta(client.delta, editor);
      }
      
      client.waiting = false;
    
    };
  }
}), client.timeout);

setInterval((function() {
  preview = document.getElementById('preview');
  return function() { preview.contentDocument.open(); preview.contentDocument.write(editor.getCode()); preview.contentDocument.close(); }
})(), 500);

