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

Camp.add ('change', function (query) {
  return server (query.rev, query.delta);
});


var gotamodif = new EventEmitter();

// We get information on the 'out' channel.

Camp.add ('out', function (query) {
  Camp.Server.emit ('modif', server (query.rev, query.delta), query.user);
});



// We send information on the 'in' channel.

Camp.add ('in', function (query, resp, user) {
  // "A wise sufi monk once said,
  // If what you have to say is not as pleasant as silence, do not talk."
  // We wait till we have something to say.
  if (user !== query.user) {
    return resp;
  } else return undefined;    // The user mustn't receive its own modification.
}, 'modif');



// Time to start working!
Camp.Server.start();
