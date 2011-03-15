/* diff.js: handles translation of the Google diff to the modification delta.
 * Copyright (c) 2011 Thaddée Tyl. All rights reserved.
 * Copyright (c) 2011 Jan Keromnes. All rights reserved.
 * */

(function () {


/* delta (d = [ [0, "Hi ! "], [-1, "hello, here!"], [1, "hello"] ])
 * returns the delta corresponding to the given diff.
 * Here, [ [0, 12, 5], [1, "hello", 5] ]. */
var delta = function (diff) {

  var r = [], charnum = 0;

  for (var i = 0; i < diff.length; i++) {
    var d = diff[i];
    switch (d[0]) {
      case -1:  /* Deletion. */
        r.push ([0, d[1].length, charnum]);
        break;
      case 0:  /* Same. */
        charnum += d[1].length;
        break;
      case 1:  /* Insertion. */
        r.push ([1, d[1], charnum]);
        charnum += d[1].length;
        break;
    }
  }

  return r;

};


/* applydelta (delta = [[0,12,5], [1,"hello",5]], copy = "Hi ! hello, here!")
 * returns an updated copy where the modifications in the delta are applied.
 * Here, "Hi ! hello". */
var applydelta = function (delta, copy) {

  var r = copy;

  for (var i = 0; i < delta.length; i++) {
    var d = delta[i];
    switch (d[0]) {
      case 0:
        r = r.slice (0, d[2]) + r.slice (d[2] + d[1]);
        break;
      case 1:
        r = r.slice (0, d[2]) + d[1] + r.slice (d[2]);
        break;
    }
  }

  return r;

};


/* solve (delta = [[0,12,5], [1,"hello",5]], newdelta = [[1,"ps",0],[1,".",2]])
 * returns an updated version of delta with solved conflicts.
 * Here, [[0,12,8], [1,"hello",8]].
 * Note: this code is non-trivial. Please tread carefully when browsing through.
 */
var solve = function (delta, newdelta) {

  var nd, dl;
  var become = [];  // Couple of a list of deltas to integrate.
  for (var i = 0; i < delta.length; i++) {
    /* Solve each new modification in order. */
    for (var j = 0; j < newdelta.length; j++) {
      dl = delta[i];
      nd = newdelta[j];
      if (nd === undefined || dt === undefined) { break; }

      /* What is each of those? */
      /* 4 cases: ins/ins, ins/del, del/ins, del/del. */
      if (nd[0] === 1 && dl[0] === 1) {
        become = insins (nd, dl, [i, j]);
      } else if (nd[0] === 1 && dl[0] === 0) {
        become = insdel (nd, dl, [i, j]);
      } else if (nd[0] === 0 && dl[0] === 1) {
        become = insdel (dl, nd, [j, i]);
      } else if (nd[0] === 0 && dl[0] === 0) {
        become = deldel (nd, dl, [i, j]);
      }

      /* Update. */
      integrate (delta, become[0], i);
      integrate (newdelta, become[1], j);
    }
  }

  return delta;

};

var integrate = function (delta, become, i) {
  // become is a list of deltas to integrate, eg, [[1,'hello',4]].
  var b = become.slice (0);  // Make a copy
  delta.splice (i, 1);
  while (b.length > 0) {
    delta.splice (i, 0, b.pop ());
  }
};

/* Two insertions happened simultaneously. */
var insins = function (insa, insb, ij) {
  var become = [[insa], [insb]];

  if (insa[2] < insb[2]) {
    /* Happens before... */
    insb[2] += insa[1].length;
  } else {
    insa[2] += insb[1].length;
  }

  return become;
};

/* An insertion, a deletion. */
var insdel = function (ins, del, ij) {
  var become = [[ins], [del]];

  if (ins[2] <= del[2]) {
    /* Insertion on the left. */
    var toenddel = del[1] - (ins[2] + ins[1].length - del[2]);
    if (toenddel < 0) { toenddel = 0; }
    del[2] -= ins[1].length;  // First del occurs before insertion.
    del[1] -= toenddel;  // It ends where insertion ends.
    var seconddel = [0, toenddel, del[2] + del[1] + ins[1].length];
    become[1].push (seconddel);  // Another deletion happens after ins.

    ins[2] -= del[1];  // The insertion is shifted by the deletion before.

  } else {
    /* Deletion on the left. */
    var toenddel = del[2] - ins[2];
    if (toenddel < 0) { toenddel = 0; }
    del[1] -= toenddel;  // Deletion is cut in half by insertion.
    var seconddel = [0, toenddel, del[2] + del[1] + ins[1].length];
    become[1].push (seconddel);  // Next half of the deletion.

    ins[2] -= del[1];  // Insertion before the deletion.
  }

  return become;
};

/* Two deletions. */
var deldel = function (dela, delb, ij) {
  var become = [[dela], [delb]];

  var del1 = dela[2] < delb[2]? dela: delb;  // First deletion to occur.
  var del2 = dela[2] < delb[2]? delb: dela;  // Second deletion to occur.

  //  --------   End of first del - Start of second del.
  var toenddel = (del1[2] + del1[1]) - del2[2];

  if (toenddel < 0) {
    /* Non-overlapping deletions. */

    become[0].push (delb);
    become[1].push (dela);

  } else {
    /* Overlapping deletions. */

    del1[1] += del2[1] - toenddel;
    del2[2] -= del2[2] - del1[2];
    del2[1] -= toenddel;

  }

  return become;
};

/* solveRightOfDel (delta, newdelta, ij):
 * newdelta is a deletion; delta is an operation that happens on the right
 * of the beginning of that deletion, without any promise about overlapping. */
var solveRightOfDel = function (delta, newdelta, ij) {
  var i = ij[0], j = ij[1];
  var nd = newdelta[i];
  var fromStartToEndDel = (nd[2] + nd[1]) - delta[j][2];

  if (nd[2] + nd[1] <= delta[j][2]) {
    delta[j][2] -= nd[1];
  } else {
    
    if (delta[j][0] === 1) {
      /* We inserted something on a spot that was deleted. */
      nd[1] += delta[j][1].length;  /* Delete it all first. */
      delta[j][2] = nd[2];  /* Then insert at first position. */
      ij[0]++; i++;
      newdelta.splice (i, 0, delta[j]);

    } else {
      /* We deleted something on a spot that was deleted. */
      var toend = delta[j][2] + delta[j][1] - (nd[2] + nd[1]);
      if (toend <= 0) {
        /* All that we deleted was already deleted. */
        nd[1] -= delta[j][1];
        delta.splice (j, 1);
        //ij[1]--;
      } else {
        nd[1] -= fromStartToEndDel;
        delta[j][2] = nd[2];
        delta[j][1] = toend;
      }
    }
  }
};


/* solveLeftOfDel (delta, newdelta, ij):
 * newdelta is a deletion, and delta is an operation that begins
 * before newdelta's beginning point, without certainty about overlapping. */
var solveLeftOfDel = function (delta, newdelta, ij) {
  var i = ij[0], j = ij[1];
  var nd = newdelta[i];
  var fromStartToEndDel = (nd[2] + nd[1]) - delta[j][2];

  switch (delta[j][0]) {

    case 0:  /* We deleted on the left of the deletion. */
      if (delta[j][2] + delta[j][1] <= nd[2]) {
        nd[2] -= delta[j][1];
      } else {
        /* We deleted past the start of their deletion. */

        var toend = nd[2] + nd[1] - (delta[j][2] + delta[j][1])
        if (toend <= 0) {
          /* All that they deleted, we already deleted. */
          delta[j][1] -= nd[1];
          newdelta.splice (i, 1);
          //ij[0]--;

        } else {
          nd[1] -= -fromStartToEndDel;
          nd[2] = delta[j][2];
          nd[1] = toend;
        }
      }
      break;

    case 1:  /* We inserted on the left. */
      nd[2] += delta[j][1].length;
      break;
  }
};


/* Export. */

exports.delta = delta;
exports.applydelta = applydelta;
exports.solve = solve;

})();
