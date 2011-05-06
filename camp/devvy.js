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


// We get information on the 'out' channel.

Camp.add ('new', function (query) {
  console.log ('-- receiving from', query.user, JSON.stringify (query.delta));
  Camp.Server.emit ('modif', query, query.user);
  server (query.rev, query.delta);
  return {};
});



// We send information on the 'in' channel.

Camp.add ('dispatch', function (query, resp, user) {
  // "A wise sufi monk once said,
  // If what you have to say is not as pleasant as silence, do not talk."
  // We wait till we have something to say.
  if (user !== query.user) {
    console.log ('-- sending to', query.user, JSON.stringify (resp.delta));
    return resp;
  } else return undefined;    // The user mustn't receive its own modification.
}, 'modif');



// Time to serve the meal!
Camp.Server.start (80, true);

//debugging request
http = require('http');
resh = function(e){ 
  return function(res){
    res.on('data',function(chunk){console.log(':received',chunk.toString());});
    console.log(':client',e,'got a response');
  }
};

req1 = http.request({path:'/$dispatch',method:'POST'},resh('1'));
req1.end(escape('user=0'));
req2 = http.request({path:'/$dispatch',method:'POST'},resh('2'));
req2.end(escape('user=1'));

req3 = http.request({path:'/$new',method:'POST'},resh('3'));
req3.end(escape('rev=0&user=0&delta=[[1,"1",1]]'));
req4 = http.request({path:'/$new',method:'POST'},resh('4'));
req4.end(escape('rev=0&user=1&delta=[[1,"1",1]]'));

//require('repl').start().context.g = global;
