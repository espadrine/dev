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


/* solve (delta1 = [[0,12,5], [1,"hello",5]], delta2 = [[1,"ps",0],[1,".",2]])
 * returns an updated version of delta with solved conflicts.
 * Here, [[0,12,8], [1,"hello",8]].
 * Note: this code is non-trivial. Please tread carefully when browsing through.
 */
var solve = function (delta1, delta2) {
  var newdelta1 = [], newdelta2 = [];

  var nd, dl;
  var become = [];  // Couple of a list of delta11 to integrate.
  for (var i = 0; i < delta1.length; i++) {
    /* Solve each new modification in order. */
    for (var j = 0; j < delta2.length; j++) {
      dl = delta1[i];
      nd = delta2[j];
      if (nd === undefined || dl === undefined) { break; }

      /* What is each of those? */
      /* 4 cases: ins/ins, ins/del, del/ins, del/del. */
      if (nd[0] === 1 && dl[0] === 1) {
        become = insins (dl, nd);
      } else if (nd[0] === 1 && dl[0] === 0) {
        become = insdel (nd, dl);
      } else if (nd[0] === 0 && dl[0] === 1) {
        become = insdel (dl, nd);
      } else if (nd[0] === 0 && dl[0] === 0) {
        become = deldel (dl, nd);
      }

      /* Update. */
      newdelta1.concat (become[0]);
      newdelta2.concat (become[1]);
      /*
      integrate (delta1, become[0], [i]);
      integrate (delta2, become[1], [j]);
      */
    }
  }

  return delta1;

};


// helper functions (read-only values)

var modifstart = function (modif) {
  return modif[2];
};

var modifspan = function (modif) {
  return (modif[0] === 0? modif[1]: modif[1].length);
};

var integrate = function (delta, become, i) {
  // become is a list of deltas to integrate, eg, [[1,'hello',4]].
  // i is actually a singleton contaning i, to make it a reference.
  var b = become.slice (0);  // Make a copy
  delta.splice (i[0], 1);
  while (b.length > 0) {
    delta.splice (i[0], 0, b.pop ());
  }
  i[0] += (become.length - 1);
};

/* Two insertions happened simultaneously. */
var insins = function (insa, insb) {
  var become = [[insa], [insb]];

  if (insa[2] < insb[2]) {     // if startindex (insa) < startindex (insb)
    /* Happens before... */
    insb[2] += insa[1].length; // then: add span (insa) to startindex (insb)
  } else {
    insa[2] += insb[1].length; // else: add span (insb) to startindex (insa)
  }

  return become;
};

/* An insertion, a deletion. */
var insdel = function (ins, del) {
  var become = [[ins], [del]];

  if (ins[2] <= del[2]) {     // if startindex (ins) <= startindex (del)
    /* Insertion on the left. */

    del[2] += ins[1].length;
    /*
    var toenddel = del[1] - (ins[2] + ins[1].length - del[2]);
    if (toenddel < 0) { toenddel = 0; }
    del[2] -= ins[1].length;  // The del occurs before insertion.
    del[1] -= toenddel;       // It ends where insertion ends.
    var seconddel = [0, toenddel, del[2] + del[1] + ins[1].length];
    become[1].push (seconddel);  // Another deletion happens after ins.

    ins[2] -= del[1];  // The insertion is shifted by the deletion before.
    */

  } else {
    /* Deletion on the left. */

    // toenddel = endindex (del) - startindex (ins)
    var toenddel = (del[2] + del[1]) - ins[2];
    if (toenddel >= 0) {
      // Deletion is cut in half by insertion.
      del[1] -= toenddel;
      var seconddel = [0, toenddel, del[2] + del[1] + ins[1].length];
      become[1].push (seconddel);  // Next half of the deletion.
    } else {
      toenddel = 0;
    }

    // remove span (del) - toenddel to startindex (ins)
    ins[2] -= del[1] - toenddel;
  }

  return become;
};

/* Two deletions. */
var deldel = function (dela, delb) {
  var become = [[dela], [delb]];

  var del1 = dela[2] < delb[2]? dela: delb;  // First deletion to occur.
  var del2 = dela[2] < delb[2]? delb: dela;  // Second deletion to occur.

  //  --------   End of first del - Start of second del.
  var toenddel = (del1[2] + del1[1] - 1) - del2[2];

  if (toenddel > 0) {
    /* Overlapping deletions. */
    del1[1] -= toenddel;  // Don't delete the overlapping part,
    del2[1] -= toenddel;  // -- it was already deleted.
    del2[2] = del1[2];    // Re-shift the second deletion at start of del1.

  } else {
    del2[2] -= del1[1];   // Shift the second del by the amount of the first.
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

window.Diff = {};
window.Diff.delta = delta;
window.Diff.applydelta = applydelta;
window.Diff.solve = solve;

})();
