/* devvy.js: nodejs config file.
 * Copyright (c) Thaddee Tyl. All rights reserved. */

INITREV = 0;
COPY = '';
ID = 0;

var Diff = require ('./diff.js');

server = (function () {

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

    if (delta.length !== 0) {
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

var Camp = require('./camp.js');

Camp.Camp('change', function (query) {
  for (var el in query) {
    query[el] = JSON.parse (query);
  }

  return server(query.rev, query.delta);
});
	
Camp.Camp.start();
