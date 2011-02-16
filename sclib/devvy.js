/* devvy.js: nodejs config file.
 * Copyright (c) Thaddee Tyl. All rights reserved. */

INITREV = 0;
COPY = '';
ID = 0;

server = (function () {

  var rev = INITREV;
  var copy = COPY;
  var deltas = [];

  /* Dom. */

  var para = document.getElementById('main');

  return function (theirrev, delta, callback) {
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

        callback(rev+1, senddelta);

      } else {
        /* There were no changes since. */
        callback(rev+1, []);
      }

      deltas[rev++] = delta;
      copy = Diff.applydelta(delta, copy);
      para.textContent = copy;

    } else {
      /* He did not change his copy. */
      callback(rev, senddelta);
    }

  };

})();


/* Lauching the server. */

var Camp = require('./camp.js');

Camp.Camp('change', function (query) {
	return {hello: 'world'};
});
	
Camp.Camp.start();
