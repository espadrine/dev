/* devvy.js: nodejs config file.
 * Copyright (c) Thaddee Tyl. All rights reserved. */

INITREV = 0;
COPY = '';
ID = 0;

var Diff = require ('./diff.js');

var server = (function () {

  var rev = INITREV;
  var copy = COPY;
  var deltas = [];


  return function (theirrev, delta) {
    /* Change in the copy. */

    var senddelta = [];
    for (var i=theirrev; i<rev; i++) {
      for (var j=0; j<deltas[i].length; j++) {
        senddelta.push(deltas[i][j]);
      }
    }

    if (delta && delta.length !== 0) {
      /* He brings a change. */

      if (theirrev <= rev) {
        /* There were other changes since. */

        /* Solve conflicts with previous revisions. */
        Diff.solve(senddelta, delta);

        json = {rev:rev+1, delta:senddelta};

      } else {
        /* There were no changes since. */
        json = {rev:rev+1, delta:[]};
      }

      deltas[rev++] = delta;
      copy = Diff.applydelta(delta, copy);

    } else {
      /* He did not change his copy. */
      json = {rev:rev, delta:senddelta};
    }

    return json;

  };

})();



/* Lauching the server. */

var Camp = require ('./camp.js');


Camp.add ('content', function (query) {
  return {text: COPY};
});

// Buffer of modifications.
var TimeoutBetweenDispatches = 50000;  // 50 sec.
var userbuffer = {};
var usertimeouts = {};
Camp.Server.on ('modif', function registermodif (resp) {
  for (bufeduser in userbuffer) {
    // Note: bufeduser is a string representation of the user id.
    if (bufeduser != resp.user) {
      console.log ('--caching',resp,'for user',bufeduser);
      userbuffer[bufeduser].push (resp);
    }
  }
});



// We get information on the 'new' channel.

Camp.add ('new', function (query) {
  console.log ('--receiving from', query.user, JSON.stringify (query.delta));///
  Camp.Server.emit ('modif', query);
  server (query.rev, query.delta);
  return {};
});

// We send information on the 'dispatch' channel.

Camp.add ('dispatch', function (query) {
  console.log ('--connect dispatch [' + query.user + ']');
  if (userbuffer[query.user] !== undefined) {
    if (userbuffer[query.user].length > 0) {
      return userbuffer[query.user].shift();  // Don't wait, give the stuff.
    } else {
      delete userbuffer[query.user];
    }
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

      // This dispatch will close, but we need to remember this user
      // for the small timelapse before he reconnects.
      userbuffer[query.user] = [];      // Stuff that query.user needs to get.

      if (usertimeouts[query.user]) { clearTimeout (usertimeouts[query.user]); }
      usertimeouts[query.user] = setTimeout (function activatebuffer () {
        delete userbuffer[query.user];  // Forget about this guy. Not worth it.
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
