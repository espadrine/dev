window.INITREV = 0;
window.COPY = '';


/* Send the data to the server. Hold the state. */
window.client = {
  rev: INITREV,
  copy: COPY,
  delta: []
};

Scout('#t0but').on('click', function (xhr, ev, params) {
  var text = document.getElementById('t0');

  var dmp = new diff_match_patch();
  var bufcopy = text.value;

  params.data = {
  usr: client.usr,
  rev: client.rev,
  delta: Diff.delta(dmp.diff_main(client.copy, text.value))
  };

  if(params.data.delta !== undefined) { alert("send "+JSON.stringify(params.delta)); }
  
  params.error = function(xhr, status) {
  // TODO
  };    

  params.open.url = '/_/change';

  params.resp = function(xhr, resp) {
    client.rev = resp.rev;

    client.delta = [];
    var dmp = new diff_match_patch();
    var delt = Diff.delta(dmp.diff_main(bufcopy, text.value));
    client.delta = Diff.solve(delt, resp.delta);
    text.value = Diff.applydelta(resp.delta, text.value);
    lastcopy = text.value;
    text.value = Diff.applydelta(client.delta, text.value);
  };
});

