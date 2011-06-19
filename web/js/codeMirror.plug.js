/* plugger.js: allows plugs to have an api into the nifty collaboration engine.
 * Copyright (c) 2011 Thaddee Tyl & Jan Keromnes. All rights reserved.
 * */
 
function () {

client.notmychange = false;


// Information we keep on code mirror.
window.editor = new CodeMirror (document.body, {
  value: window.client.lastcopy,
  height: "100%",
  width: "50%",
  mode: "text/html",
  tabMode: "indent",
  onChange: function () {
    if (client.notmychange) {
      client.notmychange = false;
    } else {
      // Here, we consider the differences between current text
      // and the text we had last time we pushed changes.
      
      plugger.newcontent (content);
    }
  },
});


window.extenditor = {
  applydiff : function(change, editor) {
    
    for ( var i = 0, from = {'line':0,'ch':0}, to = {'line':0,'ch':0} ;
        i < change.length ; i++ ) {
      if ( change[i][0] == 1 ) {
        editor.replaceRange(change[i][1],from);
      }
      // find the changed range
      to.ch += change[i][1].length;
      var rest = change[i][1].length - editor.getRange(from,to).length;
      while ( rest > 0 ) {
        to.line++;
        to.ch = rest-1;
        rest = change[i][1].length - editor.getRange(from,to).length;
      }
      if ( change[i][0] == -1 ) {
        editor.replaceRange('',from,to);
        to.line = from.line;
        to.ch = from.ch;
      } else {
        from.line = to.line;
        from.ch = to.ch;
      }
    }
  }
}


var plugger = getPlug (function onnewcontent (content) {
  client.notmychange = true;
  editor.setValue (resp.data);     // Put the data in the editor.
  return editor.getValue ();
}, function onnewdiff (diff) {
  client.notmychange = true;
  extenditor.applydiff (diff, editor);
  return editor.getValue ();
});



}) ();
