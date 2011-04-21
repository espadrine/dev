/* client.js: manages the client-side of the collaborative editor
 * Copyright (c) 2011 Thaddee Tyl. All rights reserved.
 * Copyright (c) 2011 Jan Keromnes. All rights reserved.
 * */
 
(function () {


// Information we keep on the state of the content of the editor.
window.client = {
  user: "dom",
  rev: 0,
  lastcopy: "<!doctype html>\n<title><\/title>\n\n<body>\n  <canvas id=tutorial width=150 height=150><\/canvas>\n\n  <script>\n    var canvas = document.getElementById('tutorial');\n    var context = canvas.getContext('2d');\n\n    context.fillStyle = 'rgb(250,0,0)';\n    context.fillRect(10, 10, 55, 50);\n\n    context.fillStyle = 'rgba(0, 0, 250, 0.5)';\n    context.fillRect(30, 30, 55, 50);\n  <\/script>\n<\/body>",
  delta: [],
  timeout: 3000 // DEBUG
};

// Information we keep on code mirror.
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




// -- HERE BE AJAX SPACE.


//1. This place is specifically designed to receive information from the server.

// Whenever we load the page, we shall send nothing to
// the "in" action of the server.
function getmodif (xhr, params) {

  params.open.url = '/_/in';
  
  params.resp = function (xhr, resp) {
    // We received new information from a collaborator!
    // (this can be fired a long time after the enclosing function.)

    console.log ('received rev : ' + resp.rev + 
                 ', delta : ' + JSON.stringify(resp.delta));
    
    
    client.rev = resp.rev;
    client.delta = [];
    
    var diff = (new diff_match_patch ()).diff_main (bufcopy, editor.getCode ());
    client.delta = Diff.solve (Diff.delta (diff), resp.delta);
    
    extenditor.applydelta (resp.delta, editor);
    client.lastcopy = editor.getCode ();
    extenditor.applydelta (client.delta, editor);

    setInterval (Scout.send (getmodif)) ();   // We relaunch the connection.
  };

  params.error = function (xhr, status) {
    // TODO
  };

}

// Let's begin the connection when the page loads.
Scout ('body').on ('load', getmdofif);



//2. This place is specifically designed to send information to the server.


if (!window.CodeMirrorConfig)  { window.CodeMirrorConfig = {}; }

// We want to listen to the event of code modification.
window.CodeMirrorConfig.onChange = Scout.send (function (xhr, params) {

  var bufcopy = editor.getCode();
  var dmp = new diff_match_patch();
  client.delta = Diff.delta(dmp.diff_main(client.lastcopy, editor.getCode()));

  params.data = {
    usr: client.usr,
    rev: client.rev,
    delta: client.delta
  };

  params.open.url = '/_/out';
  
  // DEBUG
  console.log ('sending rev : ' + params.data.rev +
               ', delta : ' + JSON.stringify (params.data.delta));
  
  params.error = function (xhr, status) {
    // TODO
  };

});


// The end.
})();
