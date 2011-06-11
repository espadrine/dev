/* client.js: manages the client-side of the collaborative editor
 * Copyright (c) 2011 Thaddee Tyl. All rights reserved.
 * Copyright (c) 2011 Jan Keromnes. All rights reserved.
 * */
 
(function () {

// IE doesn't have a console, but we avoid a crash thanks to this.
window.console = console? console: {
  log: function(){
    for (var arg in arguments)
      console.data = (console.data?console.data:'') + arg + ' ';
    console.data += '\n';
  }
} 

// We need all the power of diff, match and patch.
var dmp = new diff_match_patch ();

// Information we keep on the state of the content of the editor.
window.client = {
  user: +(new Date()),
  rev: 0,
  lastcopy: "<!doctype html>\n<title><\/title>\n\n<body>\n  <canvas id=tutorial width=150 height=150><\/canvas>\n\n  <script>\n    var canvas = document.getElementById('tutorial');\n    var context = canvas.getContext('2d');\n\n    context.fillStyle = 'rgb(250,0,0)';\n    context.fillRect(10, 10, 55, 50);\n\n    context.fillStyle = 'rgba(0, 0, 250, 0.5)';\n    context.fillRect(30, 30, 55, 50);\n  <\/script>\n<\/body>",
  delta: [],
  notmychange: false           // true when a program modifies the content.
};

// Information we keep on code mirror.
window.editor = new CodeMirror (document.body, {
  content: window.client.lastcopy,
  height: "100%",
  width: "50%",
  parserfile: ["parsexml.js", "parsecss.js", "tokenizejavascript.js", "parsejavascript.js", "parsehtmlmixed.js"],
  stylesheet: ["css/xmlcolors.css", "css/jscolors.css", "css/csscolors.css"],
  path: "js/",
  onChange: function () {
    if (client.notmychange) {
      client.notmychange = false;
    } else {
      // Here, we consider the differences between current text
      // and the text we had last time we pushed changes.

      // Create the patch that we want to send to the wire.
      var newdiff = dmp.diff_main (client.lastcopy, editor.getCode());
      if (newdiff.length > 2) {
        dmp.diff_cleanupSemantic (newdiff);
        dmp.diff_cleanupEfficiency (newdiff);
      }

      // Send back the new diff if there is something to it.
      if (newdiff.length !== 1 || newdiff[0][0] !== DIFF_EQUAL) {

        // Update the last copy.
        client.lastcopy = editor.getCode ();

        // Send the new diff.
        Scout.send (sending (unescape(dmp.diff_toDelta (newdiff)))) ();
      }
    }
  },
  onLoad: function () {

    // Get the data.
    Scout.send (function (xhr, params) {
      params.open.url = '/$data';
      params.data.user = client.user;
      params.resp = function (xhr, resp) {
        console.log ('got content');

        client.notmychange = true;
        editor.setCode (resp.data);     // Put the data in the editor.

        Scout2.send (getmodif) ();      // Make the first dispatch link.
      };
    }) ();
  }
});

// When we leave, tell them.
window.onunload = function () {
  Scout.send (function (xhr, params) {
    params.open.url = '/$kill';
    params.data.user = client.user;
  }) ();
};


window.extenditor = {
  applypatch : function(patch, editor) {
    var content = editor.getCode ();
    // Get what our content should look like after this function runs.
    var futurecontent = dmp.patch_apply (patch, content) [0];
    // Figure out the difference w.r.t our working copy.
    var change = dmp.diff_main (content, futurecontent);
    var delta = Diff.delta (change);

    // Apply changes to the content.
    var car = 0;
    var max = content.length;
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

// We need this instance of scout to avoid conflicts.
var Scout2 = Scout.maker ();


//1. This place is specifically designed to receive information from the server.

function sync (client, delta, workingcopy, applylocally, send) {

  // Patch last copy.
  // Note: dmp.patch_apply returns the resulting text in the first element
  // of the array.
  var lastcopydiff = dmp.diff_fromDelta (client.lastcopy, delta);
  var lastcopypatch = dmp.patch_make (client.lastcopy, lastcopydiff);
  client.lastcopy = dmp.patch_apply (lastcopypatch, client.lastcopy) [0];

  // Patch working copy.
  workingcopy = applylocally (lastcopypatch);

  // Create the patch that we want to send to the wire.
  var newdiff = dmp.diff_main (client.lastcopy, workingcopy);
  if (newdiff.length > 2) {
    dmp.diff_cleanupSemantic (newdiff);
    dmp.diff_cleanupEfficiency (newdiff);
  }

  // Update the last copy.
  client.lastcopy = workingcopy;
  
  // Send back the new diff if there is something to it.
  if (newdiff.length !== 1 || newdiff[0][0] !== DIFF_EQUAL) {
    send (unescape (dmp.diff_toDelta (newdiff)));    // Send the new delta.
  }
}

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
    
    // We sync it to our copy.
    sync (client, resp.delta, editor.getCode (), function applylocally(patch) {
      // Modifying the content.
      client.notmychange = true;
      extenditor.applypatch (patch, editor);
      return editor.getCode ();
    }, function sendnewdelta (delta) {
      Scout.send (sending (delta)) ();
    });
    
    Scout2.send (getmodif) ();   // We relaunch the connection.
  };

  params.error = function receiveerror(xhr, status) {
    console.log('getmodif xhr error: status',status);
    var now = +new Date ();
    if (status === 0 && now - lastnetworkissue > 5000) {
      // Network issues are not too frequent.
      lastnetworkissue = now;
      Scout2 = Scout.maker();
      Scout2.send (getmodif) ();   // We relaunch the connection.
    } else {
      console.log ('connection lost.');
    }
  };
}
var lastnetworkissue = 0;


//2. This place is specifically designed to send information to the server.


// We want to listen to the event of code modification.
function sending (delta) {
  return function (xhr, params) {

    // If there was no modification, we do not do anything.
    if (delta.length === 0) { return; }

    params.data = {
      rev: client.rev++,      // Newly sent delta begets new revision.
      user: client.user,
      delta: delta
    };

    params.open.url = '/$new';
    
    // DEBUG
    console.log ('sending rev : ' + params.data.rev +
                 ', delta : ' + JSON.stringify (params.data.delta));
    params.resp = function () {
      console.log ('sent');
    };
    
    params.error = function senderror (xhr, status) {
      console.log('send error: status',JSON.stringify(status));
    };

  };
}


// The end.
})();
