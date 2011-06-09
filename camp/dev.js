/* devvy.js: nodejs config file.
 * Copyright (c) Thaddee Tyl. All rights reserved. */

var COPY = "<!doctype html>\n<title><\/title>\n\n<body>\n  <canvas id=tutorial width=150 height=150><\/canvas>\n\n  <script>\n    var canvas = document.getElementById('tutorial');\n    var context = canvas.getContext('2d');\n\n    context.fillStyle = 'rgb(250,0,0)';\n    context.fillRect(10, 10, 55, 50);\n\n    context.fillStyle = 'rgba(0, 0, 250, 0.5)';\n    context.fillRect(30, 30, 55, 50);\n  <\/script>\n<\/body>";

var DMP = require ('./diff.js');
var DIFF_EQUAL = DMP.DIFF_EQUAL;
var dmp = new DMP.diff_match_patch ();

// Each user is identified by a number (might be converted to a string),
// and has an associated lastcopy.
//   eg, users = {'1234': {lastcopy: 'foo bar...',
//                         bufferhim: false, // To see if we need to buffer.
//                         buffer: [],       // To be sent on dispatch.
//                         timeout: 0,       // Before we forget this user.
//                         lock: false},     // To forbid simultaneous edits.
//                lockcache: []}}            // To cache edits shadowed by lock.
var users = {};
users.lockcache = [];

// Update the copy corresponding to a user, because of user input.
//
function sync (client, delta, workingcopy, applylocally, send) {

  // Patch last copy.
  // Note: dmp.patch_apply returns the resulting text in the first element
  // of the array.
  var lastcopypatch = dmp.patch_make (client.lastcopy,
        dmp.diff_fromDelta (client.lastcopy, delta));
  client.lastcopy = dmp.patch_apply (lastcopypatch, client.lastcopy) [0];

  // Patch working copy.
  workingcopy = applylocally (delta);

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
    console.log ('--sync not equal');
    send (unescape (dmp.diff_toDelta (newdiff)));    // Send the new delta.
  }
}



/* Lauching the server. */

var Camp = require ('./camp.js');


// Buffer of modifications.
var TimeoutBetweenDispatches = 60 * 40000;  // 4 min.
var userbuffer = {};
var usertimeouts = {};


// First time someone connects, he sends a content action.

Camp.add ('data', function (query) {
  users[query.user] = {
    lastcopy: COPY,
    bufferhim: false,
    buffer: [],
    timeout: 0,
    lock: false
  };
  return {data: COPY? COPY: '\n'}; // If there is something to be sent, send it.
});


// We get information on the 'new' channel.
// query = { user: 12345, delta: "=42+ =12" }

Camp.add ('new', function addnewstuff (query) {
  console.log ('--receiving from', query.user, JSON.stringify (query.delta));///
  
  // Are you locked up?
  if (users[query.user].lock) {
    console.log ('--user [' + query.user + '] is locked up.');
    Camp.Server.once ('unlocked', function () {
      console.log ('--unlocking [' + query.user + ']');
      // We just got the right to integrate our changes.
      // We need to merge them with the change that blocked us first.
      // TODO: implement OT fusion.
      var lastquery = users.lockcache.shift ();
      sync (users[lastquery.user], lastquery.delta);
      // Now we can integrate the changes.
      addnewstuff (lastquery);
    });
    users.lockcache.push (query);
    return {};
  }
  // Lock every one else up: they must not do any 'new' action.
  for (var user in users) {
    users[user].lock = true;
  }

  // Does the user already exist?
  if (!users[query.user]) {
    console.log ('--nonexisting user [' + query.user + ']');
    return {};
  }
  
  // Caching for those in need.
  for (var user in users) {
    if (users[user].bufferhim && user != query.user) {
      console.log ('--caching',query.delta,'for user',user);
      users[user].buffer.push (query);
    }
  }
  // Change our copy.
  console.log ('--sync', query.delta);
  var newdelta = query.delta;
  sync (users[query.user], query.delta, COPY, function(delta) {
    var copypatch = dmp.patch_make (COPY, dmp.diff_fromDelta (COPY, delta));
    COPY = dmp.patch_apply (copypatch, COPY) [0];
    return COPY;
  }, function(delta) {
    newdelta = delta;
  });
  var newresp = {user: query.user, delta: newdelta};
  Camp.Server.emit ('modif', newresp);

  // Unlock everyone to allow input from them.
  for (var user in users) {
    users[user].lock = false;
  }
  Camp.Server.emit ('unlocked');
  return {};
});


// We send information on the 'dispatch' channel.

Camp.add ('dispatch', function (query) {
  console.log ('--connect dispatch [' + query.user + ']');

  // Return userbuffer if there was information to send while dispatch was off.
  var userbuffer = users[query.user].buffer;
  if (userbuffer.bufferhim && userbuffer.length > 0) {
    console.log ('--returning cached content to',query.user);
    return userbuffer.shift();      // Don't wait, give the stuff.
  } else {
    userbuffer.bufferhim = false;   // and now, userbuffer.buffer is [].
    clearTimeout (users[query.user].timeout);
  }

  // "A wise sufi monk once said,
  // If what you have to say is not as pleasant as silence, do not talk."
  // We wait till we have something to say.
  return function modif (resp) {
    var modifier = resp.user;  // The guy that did the modification.
    if (modifier !== query.user) {

      // The modification was not made by the one that sent it.
      console.log ('--sending to', query.user, JSON.stringify (resp.delta));///
      console.log ('--hence closing dispatch for', query.user);///

      // Since we send it, it will be synced.
      users[query.user].lastcopy = COPY;

      // Timeout adjustments.
      users[query.user].bufferhim = true;
      if (users[query.user].timeout > 0) {
        clearTimeout (users[query.user].timeout);
      }
      users[query.user].timeout = setTimeout (function activatebuffer () {
        delete users[query.user];  // Forget about this guy. Not worth it.
      }, TimeoutBetweenDispatches);

      return resp;             // Send the modification to the client.

    } else {
      return undefined;        // The user mustn't receive its own modification.
    }
  };
});


// Time to serve the meal!
Camp.Server.start (80, true);
console.log('dev is live! http://localhost/');
