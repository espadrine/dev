/* client.js: manages the client-side of the collaborative editor
 * Copyright (c) 2011 Thaddee Tyl. All rights reserved.
 * Copyright (c) 2011 Jan Keromnes. All rights reserved.
 * */
 
(function () {


// Information we keep on the state of the content of the editor.
window.client = {
  user: +(new Date()),
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
  path: "js/",
  onChange: Scout.send (sending) ///FIXME: Is there no better way?
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

var dmp = new diff_match_patch ();
// We need this instance of scout to avoid conflicts.
var Scout2 = Scout.maker ();


//1. This place is specifically designed to receive information from the server.

// Whenever we load the page, we shall send nothing to
// the "in" action of the server.
function getmodif (xhr, params) {

  params.open.url = '/$dispatch';
  params.data.user = client.user;
  console.log ('dispatched');
  
  params.resp = function receiving (xhr, resp) {
    // We received new information from a collaborator!
    // (this can be fired a long time after the enclosing function.)

    console.log ('received rev : ' + resp.rev + 
                 ', delta : ' + JSON.stringify(resp.delta));
    if (resp.rev === undefined) {
      Scout2.send (getmodif) ();
      return;
    }
    
    
    // Let's see what modifications we made to our copy.
    var diff = dmp.diff_main (client.lastcopy, editor.getCode ());
    var mydelta = Diff.delta (diff);

    if (mydelta.length > 0) {
      // We did have a couple modifications.

      Scout.send (sending) ();   // Commit the new revision.

      client.rev = resp.rev;    // There need be a new revision.

      client.delta = Diff.solve (mydelta, resp.delta);

      extenditor.applydelta (resp.delta, editor);
      //client.lastcopy = editor.getCode ();
      //extenditor.applydelta (client.delta, editor);

    } else {
      client.rev = resp.rev;
      extenditor.applydelta (resp.delta, editor);
    }

    client.lastcopy = editor.getCode ();  // Those modifs were not made by us.
    
    Scout2.send (getmodif) ();   // We relaunch the connection.
  };

  params.error = function receiveerror(xhr, status) {
    // TODO
  };

}

// Let's start the connection when the page loads.
if (!window.addEventListener) {
  window.addEventListener = function ael (e,f) { window.attachEvent('on'+e,f); }
}
window.addEventListener ('load', Scout2.send (getmodif), false);



//2. This place is specifically designed to send information to the server.


// We want to listen to the event of code modification.
function sending (xhr, params) {

  // Here, we consider the differences between current text
  // and the text we had last time we pushed changes.
  var bufcopy = editor.getCode();
  client.delta = Diff.delta(dmp.diff_main(client.lastcopy, bufcopy));
  client.lastcopy = bufcopy;

  // If there was no modification, we do not do anything.
  if (client.delta.length === 0) { return; }

  params.data = {
    rev: client.rev++,      // Newly sent delta begets new revision.
    user: client.user,
    delta: client.delta
  };

  params.open.url = '/$new';
  
  // DEBUG
  console.log ('sending rev : ' + params.data.rev +
               ', delta : ' + JSON.stringify (params.data.delta));
  params.resp = function () {
    console.log ('sent');
  };
  
  params.error = function senderror (xhr, status) {
    // TODO
  };

}


// The end.
})();
